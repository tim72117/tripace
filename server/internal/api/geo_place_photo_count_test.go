package api

// geo_place_photo_count_test.go 測「記錄地點實際照片張數 + 全域最大張數」
// 如何限制補圖(2026-10)。
//
// 問題(用 mock 重現過):補圖判斷只看「上限範圍內每個索引有沒有新鮮的
// photo_assets」。地點實際照片數少於上限時,多出來的索引永遠沒有紀錄,
// 永遠被判成「缺」——補圖時 indexToFetch >= len(refs) 直接 return、什麼都
// 沒寫,於是之後每一次請求都再白打一次 places.get(實測:6 次請求打 6 次,
// 計費上 GetPlace 與請求數 1:1)。
//
// 解法:place_details_cache.photo_count 記下實際張數;有效上限取三個參數
// 的最小值:
//
//	min(點擊數決定的上限, 該點實際張數, 全域「照片最大張數」設定)
//
// 使用者的規則:到達這個值之後,不補照片(places.photoMedia)、也不重讀
// 地點資訊(places.get)。
//
// 測試結構(使用者明確要求「各個參數都先隔離測試,然後再合併測試」):
//
//	第一層 每個參數單獨測——另外兩個參數設成「不構成限制」的值,
//	       確認這個參數自己的行為正確
//	第二層 兩兩合併——確認「誰比較小就聽誰的」,而且兩個方向都測
//	第三層 三者合併——三個參數同時有意義時取最小值
//	第四層 情境——過期要換新、照片後來變多、執行中調整設定
//
// 純函式(effectivePhotoCap/decidePlacePhotoRefreshIndexWithCount)與
// 整合(handlePublicGeoPlaceDetailsAny)兩個層次各跑一次同樣的結構。
import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/photostorage"
)

func intPtr(n int) *int { return &n }

// 「不構成限制」的值,用在隔離測試裡把其他兩個參數擺到不會是最小值的位置。
const (
	unlimitedClicks = int64(100000) // 點擊上限 = 2 + 100000/100 = 1002
	unlimitedMax    = 1000          // 設定最大張數
)

// ===========================================================================
// 純函式 effectivePhotoCap(clickCount, photoCount, maxCount)
// ===========================================================================

// --- 第一層:單一參數(其餘兩個不構成限制)---

func TestEffectivePhotoCap_Isolated_ClickCountOnly(t *testing.T) {
	// 實際張數不知道(nil)、設定最大值很寬鬆 → 只剩點擊數決定上限。
	cases := []struct {
		clicks int64
		want   int
	}{
		{1, 1}, {9, 1}, // < 10 次:只補 1 張
		{10, 2}, {99, 2}, // 10~99:2 張
		{100, 3}, {199, 3}, // 100~199:3 張
		{200, 4}, {500, 7},
	}
	for _, tc := range cases {
		t.Run(fmt.Sprintf("點擊%d次", tc.clicks), func(t *testing.T) {
			if got := effectivePhotoCap(tc.clicks, nil, unlimitedMax); got != tc.want {
				t.Errorf("effectivePhotoCap(%d, nil, %d) = %d, want %d", tc.clicks, unlimitedMax, got, tc.want)
			}
		})
	}
}

func TestEffectivePhotoCap_Isolated_ActualCountOnly(t *testing.T) {
	// 點擊數很多、設定最大值很寬鬆 → 只剩該點實際張數決定上限。
	for _, n := range []int{0, 1, 2, 5, 9} {
		t.Run(fmt.Sprintf("實際%d張", n), func(t *testing.T) {
			if got := effectivePhotoCap(unlimitedClicks, intPtr(n), unlimitedMax); got != n {
				t.Errorf("實際 %d 張應限制到 %d,實際 %d", n, n, got)
			}
		})
	}
}

func TestEffectivePhotoCap_Isolated_ActualCountUnknownIsNotZero(t *testing.T) {
	// nil=還沒查過、不知道;不能被當成「沒有照片」,否則第一次請求就永遠補不了。
	if got := effectivePhotoCap(100, nil, unlimitedMax); got != 3 {
		t.Errorf("不知道實際張數時應交給點擊上限(3),實際 %d", got)
	}
}

func TestEffectivePhotoCap_Isolated_GlobalMaxOnly(t *testing.T) {
	// 點擊數很多、實際張數不知道 → 只剩設定的最大張數決定上限。
	for _, m := range []int{1, 2, 3, 5, 10} {
		t.Run(fmt.Sprintf("設定最大%d", m), func(t *testing.T) {
			if got := effectivePhotoCap(unlimitedClicks, nil, m); got != m {
				t.Errorf("設定最大 %d 應限制到 %d,實際 %d", m, m, got)
			}
		})
	}
}

// --- 第二層:兩兩合併(兩個方向都測,確認不是「永遠聽某一個」)---

func TestEffectivePhotoCap_Pair_ClickVsActual(t *testing.T) {
	// 設定最大值不構成限制,只比點擊上限與實際張數。
	cases := []struct {
		name   string
		clicks int64
		actual int
		want   int
	}{
		{"點擊上限 3 < 實際 5 → 聽點擊", 100, 5, 3},
		{"實際 1 < 點擊上限 3 → 聽實際", 100, 1, 1},
		{"兩者相等 3 = 3", 100, 3, 3},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := effectivePhotoCap(tc.clicks, intPtr(tc.actual), unlimitedMax); got != tc.want {
				t.Errorf("got %d, want %d", got, tc.want)
			}
		})
	}
}

func TestEffectivePhotoCap_Pair_ClickVsGlobalMax(t *testing.T) {
	// 實際張數不知道,只比點擊上限與設定最大值。
	cases := []struct {
		name   string
		clicks int64
		max    int
		want   int
	}{
		{"點擊上限 3 < 設定 10 → 聽點擊", 100, 10, 3},
		{"設定 2 < 點擊上限 7 → 聽設定", 500, 2, 2},
		{"兩者相等 3 = 3", 100, 3, 3},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := effectivePhotoCap(tc.clicks, nil, tc.max); got != tc.want {
				t.Errorf("got %d, want %d", got, tc.want)
			}
		})
	}
}

func TestEffectivePhotoCap_Pair_ActualVsGlobalMax(t *testing.T) {
	// 點擊數很多,只比實際張數與設定最大值。
	cases := []struct {
		name   string
		actual int
		max    int
		want   int
	}{
		{"實際 2 < 設定 5 → 聽實際", 2, 5, 2},
		{"設定 2 < 實際 5 → 聽設定", 5, 2, 2},
		{"兩者相等 4 = 4", 4, 4, 4},
		{"實際 0 < 設定 3 → 0(確認沒有照片)", 0, 3, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := effectivePhotoCap(unlimitedClicks, intPtr(tc.actual), tc.max); got != tc.want {
				t.Errorf("got %d, want %d", got, tc.want)
			}
		})
	}
}

// --- 第三層:三者合併 ---

func TestEffectivePhotoCap_AllThreeCombined_TakesMinimum(t *testing.T) {
	cases := []struct {
		name   string
		clicks int64
		actual *int
		max    int
		want   int
		binds  string
	}{
		{"點擊最小", 100, intPtr(5), 5, 3, "點擊"},
		{"實際最小", 500, intPtr(2), 5, 2, "實際"},
		{"設定最小", 500, intPtr(5), 2, 2, "設定"},
		{"三者相等", 100, intPtr(3), 3, 3, "全部"},
		{"實際 0 壓過一切", 500, intPtr(0), 5, 0, "實際"},
		{"點擊 1 壓過一切", 1, intPtr(9), 9, 1, "點擊"},
		{"不知道實際張數時退回兩者取小", 500, nil, 4, 4, "設定"},
	}
	for _, tc := range cases {
		t.Run(tc.name+"→"+tc.binds, func(t *testing.T) {
			if got := effectivePhotoCap(tc.clicks, tc.actual, tc.max); got != tc.want {
				t.Errorf("effectivePhotoCap(%d, %v, %d) = %d, want %d", tc.clicks, tc.actual, tc.max, got, tc.want)
			}
		})
	}
}

// ===========================================================================
// 純函式 decidePlacePhotoRefreshIndexWithCount(clicks, actual, max, fresh)
// ===========================================================================

type decideCase struct {
	name      string
	clicks    int64
	actual    *int
	max       int
	fresh     []bool
	wantFetch bool
	wantIndex int
}

func runDecideCases(t *testing.T, cases []decideCase) {
	t.Helper()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotFetch, gotIndex := decidePlacePhotoRefreshIndexWithCount(tc.clicks, tc.actual, tc.max, tc.fresh)
			if gotFetch != tc.wantFetch || gotIndex != tc.wantIndex {
				t.Errorf("got (%v, %d), want (%v, %d)", gotFetch, gotIndex, tc.wantFetch, tc.wantIndex)
			}
		})
	}
}

func TestDecideRefresh_Isolated_EachParameterAlone(t *testing.T) {
	runDecideCases(t, []decideCase{
		// 點擊上限單獨(上限 3)
		{"點擊:上限內有缺 → 補", 100, nil, unlimitedMax, []bool{true, true, false}, true, 2},
		{"點擊:上限內全新鮮 → 不補", 100, nil, unlimitedMax, []bool{true, true, true}, false, -1},
		// 實際張數單獨(實際 2):不追不存在的 index 2
		{"實際:到達實際張數且新鮮 → 不補", unlimitedClicks, intPtr(2), unlimitedMax, []bool{true, true}, false, -1},
		{"實際:實際範圍內過期 → 仍補", unlimitedClicks, intPtr(2), unlimitedMax, []bool{true, false}, true, 1},
		{"實際:確認沒有照片 → 不補", unlimitedClicks, intPtr(0), unlimitedMax, nil, false, -1},
		// 設定最大單獨(最大 2)
		{"設定:到達設定上限且新鮮 → 不補", unlimitedClicks, nil, 2, []bool{true, true, false}, false, -1},
		{"設定:設定範圍內缺 → 補", unlimitedClicks, nil, 2, []bool{true, false}, true, 1},
	})
}

func TestDecideRefresh_Combined(t *testing.T) {
	runDecideCases(t, []decideCase{
		{"點擊 3 / 實際 2 / 設定 5,前兩張新鮮 → 不追 index 2", 100, intPtr(2), 5, []bool{true, true, false}, false, -1},
		{"點擊 7 / 實際 5 / 設定 2,前兩張新鮮 → 不補", 500, intPtr(5), 2, []bool{true, true, false, false, false}, false, -1},
		{"點擊 7 / 實際 5 / 設定 2,index 1 缺 → 補 index 1", 500, intPtr(5), 2, []bool{true, false}, true, 1},
		{"點擊 1 / 實際 5 / 設定 5,index 0 新鮮 → 不補", 1, intPtr(5), 5, []bool{true}, false, -1},
	})
}

// 舊簽章保留給既有呼叫端與測試,語意必須不變(不知道張數、不設最大值)。
func TestDecidePlacePhotoRefreshIndex_LegacySignatureUnchanged(t *testing.T) {
	if fetch, idx := decidePlacePhotoRefreshIndex(1, []bool{false}); !fetch || idx != 0 {
		t.Errorf("舊簽章行為被改變: (%v, %d)", fetch, idx)
	}
	if fetch, _ := decidePlacePhotoRefreshIndex(1, []bool{true}); fetch {
		t.Error("舊簽章:cap=1 且 index 0 新鮮不該補")
	}
}

// ===========================================================================
// 整合:handlePublicGeoPlaceDetailsAny(已建檔 attraction 分支)
// ===========================================================================

// countingPlaceGateway 是帶鎖的假 gateway,記錄每個 endpoint 被呼叫幾次。
// 既有的 fakePlaceDetailsGateway 不是執行緒安全的(calls 切片在背景
// goroutine 裡被 append),補圖又在 go func() 裡跑,所以這裡另寫一個。
type countingPlaceGateway struct {
	mu          sync.Mutex
	detailsBody string
	counts      map[string]int
}

func (g *countingPlaceGateway) Do(ctx context.Context, req *http.Request, endpoint, caller, path string) (*http.Response, error) {
	g.mu.Lock()
	if g.counts == nil {
		g.counts = map[string]int{}
	}
	g.counts[endpoint]++
	body := g.detailsBody
	g.mu.Unlock()

	switch endpoint {
	case "places.get":
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewReader([]byte(body)))}, nil
	case "places.photoMedia":
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewReader([]byte("fake-jpeg-bytes")))}, nil
	default:
		panic("countingPlaceGateway 收到未預期的 endpoint: " + endpoint)
	}
}

func (g *countingPlaceGateway) count(endpoint string) int {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.counts[endpoint]
}

// waitBackgroundIdle 等背景補圖 goroutine 跑完:補圖沒有 WaitGroup 可以
// 等,只能輪詢「gateway 呼叫總數連續一段時間沒有變化」。
func (g *countingPlaceGateway) waitBackgroundIdle(t *testing.T) {
	t.Helper()
	total := func() int { return g.count("places.get") + g.count("places.photoMedia") }
	deadline := time.Now().Add(3 * time.Second)
	last, stable := total(), 0
	for time.Now().Before(deadline) {
		time.Sleep(25 * time.Millisecond)
		if cur := total(); cur != last {
			last, stable = cur, 0
			continue
		}
		stable++
		if stable >= 4 { // 連續 100ms 沒有新呼叫
			return
		}
	}
	t.Fatalf("背景補圖 3 秒內沒有靜止,gateway 呼叫總數仍在變動")
}

// newPhotoCountServer 建一個已建檔 attraction 的 Server。clicksBefore 是
// 第一次 HTTP 請求之前的點擊數;handler 自己會再 +1,所以:
//
//	clicksBefore=0   → 第一次請求 clickCount=1   → 點擊上限 1
//	clicksBefore=9   → clickCount=10             → 點擊上限 2
//	clicksBefore=99  → clickCount=100            → 點擊上限 3
//	clicksBefore=199 → clickCount=200            → 點擊上限 4
//	clicksBefore=499 → clickCount=500            → 點擊上限 7
func newPhotoCountServer(t *testing.T, gw *countingPlaceGateway, placeID string, clicksBefore int) *Server {
	t.Helper()
	geo.SetPhotosEnabled(true)
	t.Cleanup(func() { geo.SetPhotosEnabled(false) })

	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, &fakePlaceDetailsGateway{})
	factory := func(apiKey string) *geo.Client { return geo.NewWithGateway(apiKey, gw) }
	s.newGeoGeocodeClient = factory
	s.newPlaceDetailsClient = factory
	s.photoUploader = photostorage.NewForTest("test-bucket", photostorage.NewMemoryObjectStore())

	if _, err := s.store.CreateAttractionWithID(model.Attraction{
		ID: "lmk_photo_count_" + placeID, Name: "照片張數測試景點", CityName: "台南",
		Lat: 23.0, Lng: 120.2, Level: 2, PlaceID: &placeID,
	}); err != nil {
		t.Fatalf("seed attraction: %v", err)
	}
	if err := s.store.SetCachedPlaceDetails(placeID, "照片張數測試景點", "台南", 23.0, 120.2, 0, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails: %v", err)
	}
	for i := 0; i < clicksBefore; i++ {
		if _, err := s.store.IncrementPlaceClickCount(placeID); err != nil {
			t.Fatalf("IncrementPlaceClickCount: %v", err)
		}
	}
	return s
}

func hitPlaceDetailsAny(t *testing.T, s *Server, gw *countingPlaceGateway, placeID string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/public/geo/plan-ai/place-details-any?placeId="+placeID, nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetailsAny(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	gw.waitBackgroundIdle(t)
}

func mustPhotoCount(t *testing.T, s *Server, placeID string) *int {
	t.Helper()
	n, err := s.store.GetPlacePhotoCount(placeID)
	if err != nil {
		t.Fatalf("GetPlacePhotoCount: %v", err)
	}
	return n
}

// limitCase 描述一組整合測試的三個參數與預期結果。
type limitCase struct {
	name         string
	clicksBefore int // 第一次請求前的點擊數(決定點擊上限,見 newPhotoCountServer)
	googleHas    int // Google 上實際有幾張照片
	globalMax    int // 設定的照片最大張數
	want         int // 預期補了幾張 = min(點擊上限, 實際, 設定)
}

// runLimitCase 讓地點自然補到「到達」,並守住使用者的規則:
//
//  1. 補了 want 張(photoMedia == want)
//  2. 到達之後再請求多次,places.get(重讀地點資訊)與 places.photoMedia
//     (補照片)都不能再增加——兩個一起守,只守其中一個會漏掉「不補照片
//     但還在重讀資訊」這種浪費
//  3. 實際張數有被記下來
func runLimitCase(t *testing.T, tc limitCase) {
	t.Helper()
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("整合測試地點", tc.googleHas)}
	placeID := fmt.Sprintf("ChIJ_limit_%d_%d_%d", tc.clicksBefore, tc.googleHas, tc.globalMax)
	s := newPhotoCountServer(t, gw, placeID, tc.clicksBefore)
	s.SetPhotoMaxCount(tc.globalMax)

	// 請求次數刻意只比 want 多一點:每次請求都會讓點擊數 +1,請求太多會跨過
	// 點擊上限的門檻(10、100、200…次),上限升級後本來就該多補一張,那不是
	// 這個測試要驗證的事。補圖每次請求最多補一個索引,所以 want+2 次足夠
	// (多的一次用來學到實際張數)。
	for i := 0; i < tc.want+2; i++ {
		hitPlaceDetailsAny(t, s, gw, placeID)
	}
	if got := gw.count("places.photoMedia"); got != tc.want {
		t.Fatalf("應補 %d 張,實際 photoMedia=%d", tc.want, got)
	}
	getsAtReach, mediaAtReach := gw.count("places.get"), gw.count("places.photoMedia")

	for i := 0; i < 4; i++ { // 點擊數仍遠低於下一個門檻
		hitPlaceDetailsAny(t, s, gw, placeID)
	}
	if got := gw.count("places.get"); got != getsAtReach {
		t.Errorf("已到達上限,仍重讀了地點資訊:places.get %d → %d", getsAtReach, got)
	}
	if got := gw.count("places.photoMedia"); got != mediaAtReach {
		t.Errorf("已到達上限,仍在補照片:photoMedia %d → %d", mediaAtReach, got)
	}
	if n := mustPhotoCount(t, s, placeID); n == nil || *n != tc.googleHas {
		t.Errorf("應記下實際張數 %d,實際 %v", tc.googleHas, n)
	}
}

func runLimitCases(t *testing.T, cases []limitCase) {
	t.Helper()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) { runLimitCase(t, tc) })
	}
}

// --- 第一層:單一參數(其餘兩個不構成限制)---

func TestPhotoLimit_Isolated_ClickCountOnly(t *testing.T) {
	// Google 有 10 張、設定最大 20 → 只剩點擊數決定上限。
	runLimitCases(t, []limitCase{
		{"點擊上限1", 0, 10, 20, 1},
		{"點擊上限2", 9, 10, 20, 2},
		{"點擊上限3", 99, 10, 20, 3},
		{"點擊上限4", 199, 10, 20, 4},
		{"點擊上限7", 499, 10, 20, 7},
	})
}

func TestPhotoLimit_Isolated_ActualCountOnly(t *testing.T) {
	// 點擊上限 7、設定最大 20 → 只剩該點實際張數決定上限。
	runLimitCases(t, []limitCase{
		{"實際0張(確認沒有照片)", 499, 0, 20, 0},
		{"實際1張", 499, 1, 20, 1},
		{"實際2張", 499, 2, 20, 2},
		{"實際5張", 499, 5, 20, 5},
	})
}

func TestPhotoLimit_Isolated_GlobalMaxOnly(t *testing.T) {
	// 點擊上限 7、Google 有 10 張 → 只剩設定的最大張數決定上限。
	runLimitCases(t, []limitCase{
		{"設定最大1", 499, 10, 1, 1},
		{"設定最大2", 499, 10, 2, 2},
		{"設定最大3", 499, 10, 3, 3},
		{"設定最大5", 499, 10, 5, 5},
	})
}

// --- 第二層:兩兩合併(兩個方向都測)---

func TestPhotoLimit_Pair_ClickVsActual(t *testing.T) {
	// 設定最大 20 不構成限制。
	runLimitCases(t, []limitCase{
		{"點擊上限3 < 實際5 → 聽點擊", 99, 5, 20, 3},
		{"實際1 < 點擊上限3 → 聽實際", 99, 1, 20, 1},
		{"兩者相等 3=3", 99, 3, 20, 3},
	})
}

func TestPhotoLimit_Pair_ClickVsGlobalMax(t *testing.T) {
	// Google 有 10 張,不構成限制。
	runLimitCases(t, []limitCase{
		{"點擊上限3 < 設定10 → 聽點擊", 99, 10, 10, 3},
		{"設定2 < 點擊上限7 → 聽設定", 499, 10, 2, 2},
		{"兩者相等 3=3", 99, 10, 3, 3},
	})
}

func TestPhotoLimit_Pair_ActualVsGlobalMax(t *testing.T) {
	// 點擊上限 7,不構成限制。
	runLimitCases(t, []limitCase{
		{"實際2 < 設定5 → 聽實際", 499, 2, 5, 2},
		{"設定2 < 實際5 → 聽設定", 499, 5, 2, 2},
		{"兩者相等 4=4", 499, 4, 4, 4},
	})
}

// --- 第三層:三者合併 ---

func TestPhotoLimit_AllThreeCombined_TakesMinimum(t *testing.T) {
	runLimitCases(t, []limitCase{
		{"點擊最小(1/5/5)", 0, 5, 5, 1},
		{"實際最小(7/2/5)", 499, 2, 5, 2},
		{"設定最小(7/5/2)", 499, 5, 2, 2},
		{"三者相等(3/3/3)", 99, 3, 3, 3},
		{"實際0壓過一切(7/0/5)", 499, 0, 5, 0},
		{"點擊上限3、實際2、設定4 → 2", 99, 2, 4, 2},
		{"點擊上限3、實際4、設定2 → 2", 99, 4, 2, 2},
	})
}

// ===========================================================================
// 第四層:情境(單一事件在上述參數之上的行為)
// ===========================================================================

// 核心情境(用 mock 重現的原始問題):Google 上只有 1 張、點擊上限 3。
// 補完 index 0 之後,後續請求不該再打 places.get(原本 6 次請求打 6 次)。
func TestPhotoLimit_Scenario_FewerPhotosThanCap_StopsRefetching(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("只有一張照片的地點", 1)}
	placeID := "ChIJ_scenario_fewer_than_cap"
	s := newPhotoCountServer(t, gw, placeID, 99)

	var perRequest []int
	for i := 0; i < 6; i++ {
		before := gw.count("places.get")
		hitPlaceDetailsAny(t, s, gw, placeID)
		perRequest = append(perRequest, gw.count("places.get")-before)
	}

	t.Logf("每次請求新增的 places.get: %v", perRequest)
	if got := gw.count("places.get"); got != 1 {
		t.Errorf("6 次請求打了 %d 次 places.get,期望 1 次(第一次學到張數之後就不該再重取)", got)
	}
}

// 已知實際張數且都新鮮 → 完全不呼叫 Google,即使點擊上限(3)比實際(2)大。
func TestPhotoLimit_Scenario_KnownCountReachedAndFresh_NoGoogleCalls(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("兩張照片", 2)}
	placeID := "ChIJ_scenario_reached"
	s := newPhotoCountServer(t, gw, placeID, 99)
	if err := s.store.SetPlacePhotoCount(placeID, 2); err != nil {
		t.Fatalf("SetPlacePhotoCount: %v", err)
	}
	writeFreshPhotoAsset(t, s, placeID, 0)
	writeFreshPhotoAsset(t, s, placeID, 1)

	for i := 0; i < 4; i++ {
		hitPlaceDetailsAny(t, s, gw, placeID)
	}

	if g, m := gw.count("places.get"), gw.count("places.photoMedia"); g != 0 || m != 0 {
		t.Fatalf("已到達實際張數且新鮮,不該呼叫 Google;實際 places.get=%d photoMedia=%d", g, m)
	}
}

// 沒有照片的地點(0)要記起來:第一次問 Google,之後都不再問;
// 而且記的是 0,不是 NULL。
func TestPhotoLimit_Scenario_PlaceWithNoPhotos_AsksGoogleOnlyOnce(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("沒有照片的地點", 0)}
	placeID := "ChIJ_scenario_zero_photos"
	s := newPhotoCountServer(t, gw, placeID, 0)

	for i := 0; i < 5; i++ {
		hitPlaceDetailsAny(t, s, gw, placeID)
	}

	if got := gw.count("places.get"); got != 1 {
		t.Errorf("沒有照片的地點 5 次請求打了 %d 次 places.get,期望 1 次", got)
	}
	if n := mustPhotoCount(t, s, placeID); n == nil || *n != 0 {
		t.Errorf("應記下 0(確認沒有照片,不是 NULL),實際 %v", n)
	}
}

// 記下張數不能壓過「真的過期了要換新」:實際 2 張,index 1 過期 → 仍補。
func TestPhotoLimit_Scenario_ExpiredIndexWithinCount_StillRefreshes(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("兩張照片", 2)}
	placeID := "ChIJ_scenario_expired_within"
	s := newPhotoCountServer(t, gw, placeID, 99)
	_ = s.store.SetPlacePhotoCount(placeID, 2)
	writeFreshPhotoAsset(t, s, placeID, 0)
	writeExpiredPhotoAsset(t, s, placeID, 1)

	hitPlaceDetailsAny(t, s, gw, placeID)

	if got := gw.count("places.photoMedia"); got != 1 {
		t.Errorf("過期的 index 1 應被換新,photoMedia=%d(期望 1)", got)
	}
}

// 照片後來變多:舊記錄是 1 張,Google 現在有 3 張。index 0 過期觸發補圖時
// 會重新拿到照片清單,張數要更新成 3,之後補齊其餘兩張。
func TestPhotoLimit_Scenario_PlaceGainsPhotos_CountUpdatesAndFillsUp(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("後來變多", 3)}
	placeID := "ChIJ_scenario_gains"
	s := newPhotoCountServer(t, gw, placeID, 99)
	_ = s.store.SetPlacePhotoCount(placeID, 1) // 舊記錄:只有 1 張
	writeExpiredPhotoAsset(t, s, placeID, 0)

	for i := 0; i < 6; i++ {
		hitPlaceDetailsAny(t, s, gw, placeID)
	}

	if n := mustPhotoCount(t, s, placeID); n == nil || *n != 3 {
		t.Errorf("張數應更新為 3,實際 %v", n)
	}
	if got := gw.count("places.photoMedia"); got != 3 {
		t.Errorf("三張都該補齊,photoMedia=%d(期望 3)", got)
	}
}

// 設定可以在執行中調整,新的上限立刻生效(不需要重啟)。
func TestPhotoLimit_Scenario_RaisingGlobalMax_TakesEffectImmediately(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("五張照片", 5)}
	placeID := "ChIJ_scenario_raise_max"
	s := newPhotoCountServer(t, gw, placeID, 99) // 點擊上限 3
	s.SetPhotoMaxCount(1)
	for i := 0; i < 4; i++ {
		hitPlaceDetailsAny(t, s, gw, placeID)
	}
	if got := gw.count("places.photoMedia"); got != 1 {
		t.Fatalf("前置:設定最大 1 時應只補 1 張,實際 %d", got)
	}

	s.SetPhotoMaxCount(10) // 有效上限變成 min(3, 5, 10) = 3
	for i := 0; i < 6; i++ {
		hitPlaceDetailsAny(t, s, gw, placeID)
	}
	if got := gw.count("places.photoMedia"); got != 3 {
		t.Errorf("調高設定後應補到 3 張(點擊上限),photoMedia=%d", got)
	}
}

// ===========================================================================
// 設定值本身:預設與驗證
// ===========================================================================

// 預設值必須是 3(使用者指定)。
func TestPhotoMaxCount_DefaultIsThree(t *testing.T) {
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, &fakePlaceDetailsGateway{})
	if got := s.PhotoMaxCount(); got != 3 {
		t.Errorf("照片最大張數預設應為 3,實際 %d", got)
	}
}

func TestSetPhotoMaxCount_IgnoresInvalidValues(t *testing.T) {
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, &fakePlaceDetailsGateway{})
	s.SetPhotoMaxCount(5)
	for _, bad := range []int{0, -1} {
		s.SetPhotoMaxCount(bad)
		if got := s.PhotoMaxCount(); got != 5 {
			t.Errorf("SetPhotoMaxCount(%d) 不該生效(0 會等於關掉所有補圖),目前 %d", bad, got)
		}
	}
}
