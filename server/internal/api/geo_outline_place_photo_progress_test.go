package api

// geo_outline_place_photo_progress_test.go 測 GET /internal/geo/place-details
// (handleGeoPlaceDetails)一般模式的漸進補圖主流程串接——驗證
// IncrementPlaceClickCount/decidePlacePhotoAction/UpdatePlacePhotoProgress
// 是否真的被 handler 正確串起來(純函式本身的邏輯已經在
// geo_place_photos_progress_test.go/geo_place_photo_action_test.go 驗證過,
// 這裡不重複測那些案例,只驗證 handler 有沒有正確呼叫這些元件、正確把
// 決策結果寫回資料庫)。
//
// 測試風格參考 geo_outline_geocode_test.go 的
// fakeSearchTextGateway/newTestServerWithFakeGeoGateway 模式(見該檔案
// 開頭的完整說明)。這裡的假 gateway 需要同時處理三種 endpoint:
//
//   - "places.get" 且 field mask 是完整的 placeDetailsFieldMask
//     (含 displayName 等文字欄位):對應 geo.Client.GetPlaceDetails,
//     只有快取未命中(初次查詢)時會走到。
//   - "places.get" 且 field mask 只有 "photos":對應
//     geo.Client.ListPlacePhotoRefs——這支函式跟 GetPlaceDetails 共用
//     同一個 endpoint 字串(見 places.go 的說明),必須用 field mask
//     內容區分兩者實際要的是完整資料還是只要 photos 陣列,呼叫順序不
//     保證能區分(理論上這支測試只會在快取命中分支呼叫到這個變體)。
//   - "places.photoMedia":對應 geo.Client.PhotoDataURI(內部呼叫
//     downloadPhotoBytes)下載單張照片位元組。
import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/store"
)

// placeDetailsGatewayCall 記錄一次 fakePlaceDetailsGateway.Do 被呼叫時的
// endpoint 與 field mask,供測試斷言「這次點擊實際打了哪些 Google API」。
type placeDetailsGatewayCall struct {
	endpoint  string
	fieldMask string
}

// fakePlaceDetailsGateway 滿足 geo 套件內部未匯出的 requestDoer 介面
// (見 fakeSearchTextGateway 的說明,Go 隱式介面滿足規則)。
//
//   - detailsBody:GetPlaceDetails(完整 field mask)該回傳的假 JSON,
//     模擬 Google 目前這個地點的 photos[] 完整清單。
//   - photoRefsBody:ListPlacePhotoRefs(field mask 只有 "photos")該
//     回傳的假 JSON——通常跟 detailsBody 的 photos[] 是同一份資料,但
//     測試裡故意允許各自獨立指定,才能驗證「target 變動」這類情境
//     (快取命中分支重新查到的張數跟上次不同)。
//   - photoMediaEnabled:對應 geo.SetPhotosEnabled(true) 的全域開關,
//     這個套件層級開關預設 false,測試需要真的驗證下載流程時必須手動
//     開啟(見 newPlaceDetailsFixture 的說明)。
type fakePlaceDetailsGateway struct {
	detailsBody   string
	photoRefsBody string
	calls         []placeDetailsGatewayCall
}

func (g *fakePlaceDetailsGateway) Do(ctx context.Context, req *http.Request, endpoint, caller, path string) (*http.Response, error) {
	fieldMask := req.Header.Get("X-Goog-FieldMask")
	g.calls = append(g.calls, placeDetailsGatewayCall{endpoint: endpoint, fieldMask: fieldMask})

	switch endpoint {
	case "places.get":
		if fieldMask == "photos" {
			// ListPlacePhotoRefs——只要 photos 陣列。
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewReader([]byte(g.photoRefsBody)))}, nil
		}
		// GetPlaceDetails——完整資料。
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewReader([]byte(g.detailsBody)))}, nil
	case "places.photoMedia":
		// downloadPhotoBytes 直接讀 response body 當圖片位元組使用(見
		// 該函式的說明,不解析 JSON),回傳一小段假的圖片位元組即可。
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewReader([]byte("fake-jpeg-bytes")))}, nil
	default:
		panic("fakePlaceDetailsGateway 收到未預期的 endpoint: " + endpoint)
	}
}

// placeDetailsJSON 組一份 Place Details / ListPlacePhotoRefs 都能共用的
// 假回應 body——photoCount 張照片,每張 resource name 依序編號,方便
// 測試斷言下載的是第幾張。
func placeDetailsJSON(name string, photoCount int) string {
	type photo struct {
		Name string `json:"name"`
	}
	photos := make([]photo, photoCount)
	for i := range photos {
		photos[i].Name = "places/test-place/photos/photo" + string(rune('a'+i))
	}
	body := map[string]any{
		"displayName":      map[string]any{"text": name},
		"formattedAddress": "測試地址",
		"location":         map[string]any{"latitude": 35.0, "longitude": 135.76},
		"rating":           4.5,
		"photos":           photos,
		"editorialSummary": map[string]any{"text": "測試簡介"},
	}
	b, err := json.Marshal(body)
	if err != nil {
		panic(err)
	}
	return string(b)
}

// placeDetailsFixture 是「已登入使用者 + 可打路由的 mux」,只給這個檔案
// 的測試共用(比照 geoGeocodeFixture 的模式)。
type placeDetailsFixture struct {
	server *Server
	routes http.Handler
	token  string
}

// newPlaceDetailsFixture 建一個 Server,把 newPlaceDetailsClient 換成
// 「內部 gateway 是 fakeGateway」的 geo.Client——handleGeoPlaceDetails
// 一般模式因此可以整支被驗證,不會真的打 Google API。
//
// 這裡呼叫 geo.SetPhotosEnabled(true)(套件層級全域開關,見該函式的
// 說明)——預設 false 時 downloadPhotoBytes 會直接回 ErrPhotosDisabled,
// 讓所有照片下載都失敗,測試將永遠驗證不到「有沒有真的下載到照片」這件
// 事。這是套件全域狀態,測試結束後用 t.Cleanup 還原成關閉,避免影響
// 同一個測試二進位檔內其他套件測試(這些測試預設假設關閉)。
func newPlaceDetailsFixture(t *testing.T, fakeGateway *fakePlaceDetailsGateway) *placeDetailsFixture {
	t.Helper()
	geo.SetPhotosEnabled(true)
	t.Cleanup(func() { geo.SetPhotosEnabled(false) })

	t.Setenv("GOOGLE_PLACES_API_KEY", "test-places-api-key")
	st := store.OpenTest(t)
	signer := auth.NewSigner("test-secret", 3600_000_000_000)
	s := New(st, signer, true, "test-google-client-id")
	s.newPlaceDetailsClient = func(apiKey string) *geo.Client {
		return geo.NewWithGateway(apiKey, fakeGateway)
	}

	user, err := s.store.CreatePasswordUser("usr_geo_photo", "地點照片測試員", "#8C7B6A", "geo-photo@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	token, err := s.signer.Sign(user.ID, user.Name)
	if err != nil {
		t.Fatalf("簽 token: %v", err)
	}
	return &placeDetailsFixture{server: s, routes: s.Routes(), token: token}
}

func (f *placeDetailsFixture) get(t *testing.T, placeID string) (*http.Response, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/internal/geo/place-details?placeId="+placeID, nil)
	req.Header.Set("Authorization", "Bearer "+f.token)
	rec := httptest.NewRecorder()
	f.routes.ServeHTTP(rec, req)
	resp := rec.Result()
	var body map[string]any
	if resp.Body != nil {
		_ = json.NewDecoder(resp.Body).Decode(&body)
	}
	return resp, body
}

// TestHandleGeoPlaceDetails_CacheMiss_DownloadsOnlyOnePhoto 對應快取未命中
// (初次查詢)的情境——驗證只下載了 1 張 Google 照片(不是舊邏輯的最多 5
// 張),且 click_count/new_photo_count/google_photo_target_count 依
// decidePlacePhotoAction 的規則正確寫入(初次查詢：previousGoogleTarget
// 傳 0,任意 clickCount 都會觸發 shouldFetch,補 index=0)。
func TestHandleGeoPlaceDetails_CacheMiss_DownloadsOnlyOnePhoto(t *testing.T) {
	const placeID = "place_first_visit"
	// Google 這個地點目前實際有 3 張照片(currentGoogleTarget=3),但初次
	// 查詢應該只下載第一張,不是一次下載到 3 張或舊邏輯的上限 5 張。
	gw := &fakePlaceDetailsGateway{detailsBody: placeDetailsJSON("測試地點", 3)}
	f := newPlaceDetailsFixture(t, gw)

	resp, body := f.get(t, placeID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}

	googlePhotos, _ := body["googlePhotoUrls"].([]any)
	if len(googlePhotos) != 1 {
		t.Fatalf("初次查詢應該只下載 1 張 Google 照片,實際 = %d 張(%v)", len(googlePhotos), googlePhotos)
	}

	row, ok, err := f.server.store.GetCachedPlaceDetails(placeID, 24*time.Hour)
	if err != nil || !ok {
		t.Fatalf("GetCachedPlaceDetails failed: ok=%v err=%v", ok, err)
	}
	if row.ClickCount != 1 {
		t.Errorf("click_count = %d, want 1", row.ClickCount)
	}
	if row.NewPhotoCount != 1 {
		t.Errorf("new_photo_count = %d, want 1(已補到第 1 張,0-based index 0 補完後累積數為 1)", row.NewPhotoCount)
	}
	if row.GooglePhotoTargetCount != 3 {
		t.Errorf("google_photo_target_count = %d, want 3", row.GooglePhotoTargetCount)
	}

	googlePhotoRows, _ := f.server.store.ListGooglePlacePhotos(placeID)
	if len(googlePhotoRows) != 1 {
		t.Errorf("google_place_photos 應該只有 1 筆,實際 = %d", len(googlePhotoRows))
	}
}

// TestHandleGeoPlaceDetails_CacheHit_NoTrigger_SkipsGoogleCall 對應快取
// 命中、點擊節奏未觸發、時間也未過期的最常見路徑——驗證完全沒有呼叫
// gateway(len(gw.calls) == 0),直接回傳快取現有資料,維持零成本。
func TestHandleGeoPlaceDetails_CacheHit_NoTrigger_SkipsGoogleCall(t *testing.T) {
	const placeID = "place_cache_hit_no_trigger"
	gw := &fakePlaceDetailsGateway{}
	f := newPlaceDetailsFixture(t, gw)

	// 手動準備一筆快取:google_photo_target_count=5、new_photo_count=2,
	// 且 click_count 目前是 3(下一次點擊會變成 4)。
	// shouldAddGooglePlacePhoto(4, 2, 5):newPhotoCount+1=3,3*3=9,
	// 4 % 9 != 0,不觸發——刻意挑選這組數字確保點擊節奏不會誤觸發。
	if err := f.server.store.SetCachedPlaceDetails(placeID, "已快取地點", "已快取地址", 35.0, 135.76, 4.2, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails failed: %v", err)
	}
	for i := 0; i < 3; i++ {
		if _, _, _, err := f.server.store.IncrementPlaceClickCount(placeID); err != nil {
			t.Fatalf("IncrementPlaceClickCount failed: %v", err)
		}
	}
	if err := f.server.store.UpdatePlacePhotoProgress(placeID, 2, 5, false); err != nil {
		t.Fatalf("UpdatePlacePhotoProgress failed: %v", err)
	}

	resp, body := f.get(t, placeID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}
	if len(gw.calls) != 0 {
		t.Fatalf("點擊節奏與時間都未觸發時不該呼叫任何 Google API,實際打了 %d 次: %v", len(gw.calls), gw.calls)
	}
}

// placeDetailsProgressSnapshot 是 waitForGoogleTarget 回傳的最小快照——
// store.placeDetailsCacheRow 是 store 套件內未匯出型別,這個測試檔案
// (api 套件)無法命名它當函式回傳型別,故只取呼叫端實際關心的兩個欄位
// 另外包一個本地 struct。
type placeDetailsProgressSnapshot struct {
	FetchedAt              time.Time
	NewPhotoCount          int
	GooglePhotoTargetCount int
}

// waitForGoogleTarget 輪詢 GetCachedPlaceDetails,直到
// refreshGooglePlacePhotoInBackground(見該函式的完整說明,2026-09 起
// 點擊節奏/時間觸發後的實際查詢改成背景 goroutine 執行,不再阻塞
// handleGeoPlaceDetails 的回應)完成寫回,或逾時——這支 handler 拿到
// HTTP 回應時不保證背景查詢已經完成,測試需要主動等待,不能假設請求一
// 結束資料庫就已經是最終狀態。
//
// 用 fetched_at 是否晚於呼叫端傳入的 before(呼叫 f.get 之前的時間點)
// 判斷背景查詢是否已完成,而非比對 google_photo_target_count 是否等於
// 某個期待值——UpdatePlacePhotoProgress 每次背景查詢完成都會把
// fetched_at 重置成現在(見該函式 touchFetchedAt 參數的說明),不論
// target 這次有沒有變化都一定會更新,是唯一在所有測試情境(target 有變/
// 沒變)下都能正確反映「這次背景查詢真的跑完了」的訊號;若改用
// target 值本身當判斷依據,遇到「target 沒有變化」的情境(例如點擊節奏
// 觸發但 Google 端照片數量沒變)會在背景查詢真正完成前就提早符合條件、
// 誤判成已完成(這是實測踩到的真實 bug,故改用這個判斷方式)。
func waitForGoogleTarget(t *testing.T, s *Server, placeID string, before time.Time) placeDetailsProgressSnapshot {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		row, ok, err := s.store.GetCachedPlaceDetails(placeID, 999999*time.Hour)
		if err != nil {
			t.Fatalf("GetCachedPlaceDetails failed: %v", err)
		}
		if ok && row.FetchedAt.After(before) {
			return placeDetailsProgressSnapshot{FetchedAt: row.FetchedAt, NewPhotoCount: row.NewPhotoCount, GooglePhotoTargetCount: row.GooglePhotoTargetCount}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("等待背景查詢完成(fetched_at 更新)逾時: placeID=%s", placeID)
	return placeDetailsProgressSnapshot{}
}

// TestHandleGeoPlaceDetails_CacheHit_ClickRhythmTriggers 對應快取命中、
// 點擊節奏觸發的情境——驗證有呼叫 ListPlacePhotoRefs("places.get" +
// field mask 只有 "photos"),且 fetched_at 有被更新成現在。
//
// 2026-09:點擊節奏觸發後的實際查詢改成背景執行(見
// refreshGooglePlacePhotoInBackground 的完整說明),f.get 拿到的回應
// body 這次不會帶新照片(仍是觸發前的舊快取內容)——這是刻意的行為
// 改變,不是這個測試該驗證錯的地方。改成用 waitForGoogleTarget 輪詢
// 資料庫最終狀態,驗證背景查詢確實有發生、確實有把結果寫回。
func TestHandleGeoPlaceDetails_CacheHit_ClickRhythmTriggers(t *testing.T) {
	const placeID = "place_cache_hit_click_triggers"
	// Google 目前實際仍是 5 張(跟上次記錄的 target 相同,不因為 target
	// 變動而觸發,單純由點擊節奏觸發)。
	gw := &fakePlaceDetailsGateway{photoRefsBody: placeDetailsJSON("", 5)}
	f := newPlaceDetailsFixture(t, gw)

	if err := f.server.store.SetCachedPlaceDetails(placeID, "已快取地點", "已快取地址", 35.0, 135.76, 4.2, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails failed: %v", err)
	}
	// newPhotoCount=1、googlePhotoTargetCount=5:shouldAddGooglePlacePhoto
	// 分母是 (1+1)^2=4,點擊次數是 4 的倍數時觸發。先點 3 次墊到
	// click_count=3,這次點擊(第 4 次)會觸發。
	for i := 0; i < 3; i++ {
		if _, _, _, err := f.server.store.IncrementPlaceClickCount(placeID); err != nil {
			t.Fatalf("IncrementPlaceClickCount failed: %v", err)
		}
	}
	if err := f.server.store.UpdatePlacePhotoProgress(placeID, 1, 5, false); err != nil {
		t.Fatalf("UpdatePlacePhotoProgress failed: %v", err)
	}

	before, ok, err := f.server.store.GetCachedPlaceDetails(placeID, 24*time.Hour)
	if err != nil || !ok {
		t.Fatalf("GetCachedPlaceDetails (before) failed: ok=%v err=%v", ok, err)
	}
	time.Sleep(2 * time.Millisecond)

	resp, body := f.get(t, placeID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}

	// google_photo_target_count 應該維持 5(target 沒變),new_photo_count
	// 應該從 1 補到 2。
	after := waitForGoogleTarget(t, f.server, placeID, before.FetchedAt)
	if after.GooglePhotoTargetCount != 5 {
		t.Errorf("google_photo_target_count 應該維持 5,實際 = %d", after.GooglePhotoTargetCount)
	}
	if after.NewPhotoCount != 2 {
		t.Errorf("這次觸發應該補到第 2 張,new_photo_count 實際 = %d", after.NewPhotoCount)
	}

	foundPhotoRefsCall := false
	for _, c := range gw.calls {
		if c.endpoint == "places.get" && c.fieldMask == "photos" {
			foundPhotoRefsCall = true
		}
	}
	if !foundPhotoRefsCall {
		t.Fatalf("點擊節奏觸發時應該呼叫 ListPlacePhotoRefs,實際呼叫紀錄 = %v", gw.calls)
	}

	googlePhotoRows, _ := f.server.store.ListGooglePlacePhotos(placeID)
	if len(googlePhotoRows) != 1 {
		t.Errorf("這次觸發應該補到 1 張新照片,google_place_photos 實際 = %d 筆", len(googlePhotoRows))
	}
}

// TestHandleGeoPlaceDetails_CacheHit_TimeElapsedTriggers 對應快取命中、
// 點擊節奏未觸發、但距離上次真正查過 Google 已經超過
// placeDetailsTargetRecheckMaxAge(7 天)的情境——即使點擊節奏沒觸發,
// 也應該觸發重新查詢。
func TestHandleGeoPlaceDetails_CacheHit_TimeElapsedTriggers(t *testing.T) {
	const placeID = "place_cache_hit_time_triggers"
	// Google 目前實際仍是 2 張(跟上次記錄的 target 相同,不因為 target
	// 變動而觸發,單純由時間觸發——若這裡跟 UpdatePlacePhotoProgress 寫入
	// 的 target 對不上,decidePlacePhotoAction 會誤判成 target 變動,
	// 干擾這個測試案例想單獨驗證的「純粹時間觸發」情境)。
	gw := &fakePlaceDetailsGateway{photoRefsBody: placeDetailsJSON("", 2)}
	f := newPlaceDetailsFixture(t, gw)

	if err := f.server.store.SetCachedPlaceDetails(placeID, "已快取地點", "已快取地址", 35.0, 135.76, 4.2, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails failed: %v", err)
	}
	// newPhotoCount 已經追上 googlePhotoTargetCount(2/2)——依
	// shouldAddGooglePlacePhoto 的規則,newPhotoCount >= googlePhotoTargetCount
	// 時恆為 false,點擊節奏不可能觸發,確保這個測試案例驗證的是純粹的
	// 時間觸發、不是點擊節奏碰巧也觸發。
	if err := f.server.store.UpdatePlacePhotoProgress(placeID, 2, 2, false); err != nil {
		t.Fatalf("UpdatePlacePhotoProgress failed: %v", err)
	}
	// 把 fetched_at 改成 8 天前,超過 7 天的門檻。
	staleFetchedAt := time.Now().UTC().Add(-8 * 24 * time.Hour)
	f.server.store.SetPlaceDetailsFetchedAtForTest(t, placeID, staleFetchedAt)

	resp, body := f.get(t, placeID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}

	// target 沒有變動(還是 2 張),輪詢等待背景查詢完成(見
	// waitForGoogleTarget 的完整說明,2026-09 起這段改成背景執行)。
	after := waitForGoogleTarget(t, f.server, placeID, staleFetchedAt)
	if time.Since(after.FetchedAt) > time.Hour {
		t.Errorf("時間觸發後 fetched_at 應該被重置成現在,實際距今 = %v", time.Since(after.FetchedAt))
	}
	if after.GooglePhotoTargetCount != 2 {
		t.Errorf("google_photo_target_count 應該維持 2,實際 = %d", after.GooglePhotoTargetCount)
	}
	// newPhotoCount 已追上 target,這次不該觸發實際下載——驗證 handler
	// 有把「查過但沒有補圖」的結果正確寫回,不是誤判成有補圖。
	if after.NewPhotoCount != 2 {
		t.Errorf("target 未變動且已追上進度時不該補新照片,new_photo_count 實際 = %d", after.NewPhotoCount)
	}

	foundPhotoRefsCall := false
	for _, c := range gw.calls {
		if c.endpoint == "places.get" && c.fieldMask == "photos" {
			foundPhotoRefsCall = true
		}
	}
	if !foundPhotoRefsCall {
		t.Fatalf("距離上次查詢已超過 7 天時應該觸發重新查詢 ListPlacePhotoRefs,實際呼叫紀錄 = %v", gw.calls)
	}

	googlePhotoRows, _ := f.server.store.ListGooglePlacePhotos(placeID)
	if len(googlePhotoRows) != 0 {
		t.Errorf("target 未變動且已追上進度時不該補新照片,google_place_photos 實際 = %d 筆", len(googlePhotoRows))
	}
}

// TestHandleGeoPlaceDetails_CacheHit_TargetChanged_ResetsProgress 對應
// target 變動時 new_photo_count 正確歸零重新累積的情境——
// decidePlacePhotoAction 這支純函式本身的歸零規則已經在
// geo_place_photo_action_test.go 驗證過,這裡只驗證 handler 有沒有把這個
// 決策結果正確寫回資料庫(不是重複測純函式邏輯本身)。
func TestHandleGeoPlaceDetails_CacheHit_TargetChanged_ResetsProgress(t *testing.T) {
	const placeID = "place_cache_hit_target_changed"
	// Google 現在只剩 2 張(比上次記錄的 5 張少,店家可能刪除了照片)。
	gw := &fakePlaceDetailsGateway{photoRefsBody: placeDetailsJSON("", 2)}
	f := newPlaceDetailsFixture(t, gw)

	if err := f.server.store.SetCachedPlaceDetails(placeID, "已快取地點", "已快取地址", 35.0, 135.76, 4.2, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails failed: %v", err)
	}
	if err := f.server.store.UpdatePlacePhotoProgress(placeID, 3, 5, false); err != nil {
		t.Fatalf("UpdatePlacePhotoProgress failed: %v", err)
	}
	// 用時間觸發條件確保這次點擊一定會重新查詢(不依賴點擊節奏是否剛好
	// 觸發,讓這個測試案例只專注在驗證 target 變動後的歸零行為)。
	staleFetchedAt := time.Now().UTC().Add(-8 * 24 * time.Hour)
	f.server.store.SetPlaceDetailsFetchedAtForTest(t, placeID, staleFetchedAt)

	resp, body := f.get(t, placeID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200;body=%v", resp.StatusCode, body)
	}

	// 輪詢等待背景查詢完成(見 waitForGoogleTarget 的完整說明,2026-09
	// 起這段改成背景執行)——target 從 5 變成 2。
	after := waitForGoogleTarget(t, f.server, placeID, staleFetchedAt)
	if after.GooglePhotoTargetCount != 2 {
		t.Errorf("google_photo_target_count 應該更新成這次查到的 2,實際 = %d", after.GooglePhotoTargetCount)
	}
	// target 從 5 變成 2,resetPhotoProgressOnTargetChange 判斷為
	// true,newPhotoCount 歸零後重新累積:這次點擊會立刻觸發補 index=0,
	// 補完後 new_photo_count 應該是 1,不是延續舊的 3、也不是單純的 0。
	if after.NewPhotoCount != 1 {
		t.Errorf("new_photo_count 應該歸零後重新補到 1,實際 = %d", after.NewPhotoCount)
	}

	googlePhotoRows, _ := f.server.store.ListGooglePlacePhotos(placeID)
	if len(googlePhotoRows) != 1 {
		t.Errorf("target 變動觸發 reset 後這次點擊應該補到 1 張新照片,google_place_photos 實際 = %d 筆", len(googlePhotoRows))
	}
}
