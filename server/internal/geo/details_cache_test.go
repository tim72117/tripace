package geo

// details_cache_test.go 測 geo.Client 的「地點詳情快取」(2026-10)。
//
// 為什麼放在 geo 層而不是各 handler:原本「先讀快取再決定要不要打 Google」
// 寫在 api 層的 handleGeoPlaceDetails,AI 版 handlePublicGeoPlaceDetailsAny
// 重用 fetchAndCachePlaceDetails 時只拿了「未命中」那一半,於是每個請求都打
// 一次 places.get(帳單上 GetPlace 與請求數 1:1)。把讀快取下沉到 Client,
// 任何呼叫者都不可能跳過——跟照片的 PhotoCache 是同一個模式。
//
// 測試結構(使用者要求「先隔離再合併」):
//
//	隔離:命中 / 未命中 / 過期 / Fresh 繞過 / 不快取錯誤 / 沒掛快取 / 並發去重
//	     / TTL 設定 / 預設快取
//	合併:一條完整的生命週期(未命中→命中→過期→Fresh→再命中)
import (
	"bytes"
	"context"
	"io"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// countingGateway 是帶鎖的假 gateway:記錄 places.get 被呼叫幾次。
type countingGateway struct {
	calls   atomic.Int64
	body    string
	status  int
	started chan struct{} // 非 nil 時,每次呼叫開始就 close 一次(只 close 一次)
	release chan struct{} // 非 nil 時,等它被 close 才回應(測並發用)
	once    sync.Once
}

func (g *countingGateway) Do(ctx context.Context, req *http.Request, endpoint, caller, path string) (*http.Response, error) {
	g.calls.Add(1)
	if g.started != nil {
		g.once.Do(func() { close(g.started) })
	}
	if g.release != nil {
		<-g.release
	}
	status := g.status
	if status == 0 {
		status = http.StatusOK
	}
	return &http.Response{StatusCode: status, Body: io.NopCloser(bytes.NewReader([]byte(g.body)))}, nil
}

const detailsBodyOnePhoto = `{
  "displayName": {"text": "測試地點"},
  "formattedAddress": "測試地址",
  "location": {"latitude": 23.5, "longitude": 120.5},
  "rating": 4.5,
  "editorialSummary": {"text": "測試簡介"},
  "photos": [{"name": "places/p/photos/a"}, {"name": "places/p/photos/b"}]
}`

// memDetailsCache 是記憶體版的快取實作。
type memDetailsCache struct {
	mu   sync.Mutex
	rows map[string]memRow
	sets int
}

type memRow struct {
	d  PlaceDetails
	at time.Time
}

func newMemDetailsCache() *memDetailsCache { return &memDetailsCache{rows: map[string]memRow{}} }

func (m *memDetailsCache) Get(placeID string) (PlaceDetails, time.Time, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rows[placeID]
	return r.d, r.at, ok
}

func (m *memDetailsCache) Set(placeID string, d PlaceDetails) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sets++
	m.rows[placeID] = memRow{d: d, at: time.Now()}
}

func (m *memDetailsCache) age(placeID string, by time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := m.rows[placeID]
	r.at = r.at.Add(-by)
	m.rows[placeID] = r
}

func newCachedClient(gw *countingGateway, c PlaceDetailsCache) *Client {
	cl := NewWithGateway("test-key", gw)
	if c != nil {
		cl.SetDetailsCache(c)
	}
	return cl
}

// 每個測試結束後把全域 TTL 還原,避免測試之間互相污染。
func resetDetailsCacheMaxAge(t *testing.T) {
	t.Helper()
	t.Cleanup(func() { SetDetailsCacheMaxAge(24 * time.Hour) })
}

// ===== 隔離 =====

func TestDetailsCache_Isolated_MissCallsGoogleOnceAndWritesCache(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &countingGateway{body: detailsBodyOnePhoto}
	cache := newMemDetailsCache()
	c := newCachedClient(gw, cache)

	d, err := c.GetPlaceDetails(context.Background(), "p1")
	if err != nil {
		t.Fatalf("GetPlaceDetails: %v", err)
	}
	if gw.calls.Load() != 1 {
		t.Errorf("未命中應打 1 次 Google,實際 %d", gw.calls.Load())
	}
	if d.FromCache {
		t.Error("未命中的結果不該標示 FromCache")
	}
	if len(d.PhotoRefs) != 2 {
		t.Errorf("未命中拿到的是完整資料,應含 2 個照片參照,實際 %d", len(d.PhotoRefs))
	}
	if _, _, ok := cache.Get("p1"); !ok {
		t.Error("未命中後應寫入快取")
	}
}

func TestDetailsCache_Isolated_HitDoesNotCallGoogle(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &countingGateway{body: detailsBodyOnePhoto}
	c := newCachedClient(gw, newMemDetailsCache())

	_, _ = c.GetPlaceDetails(context.Background(), "p1")
	for i := 0; i < 5; i++ {
		d, err := c.GetPlaceDetails(context.Background(), "p1")
		if err != nil {
			t.Fatalf("第 %d 次: %v", i+2, err)
		}
		if !d.FromCache {
			t.Errorf("第 %d 次應標示 FromCache", i+2)
		}
		if d.Name != "測試地點" || d.Address != "測試地址" || d.Summary != "測試簡介" || d.Rating != 4.5 {
			t.Errorf("命中的文字資料不對: %+v", d)
		}
	}
	if gw.calls.Load() != 1 {
		t.Errorf("6 次查詢應只打 1 次 Google,實際 %d", gw.calls.Load())
	}
}

// 照片參照有時效(photo name 不能長期保存),快取不存;命中時 PhotoRefs 為
// nil,需要參照的呼叫者必須走 GetPlaceDetailsFresh。
func TestDetailsCache_Isolated_HitHasNoPhotoRefs(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &countingGateway{body: detailsBodyOnePhoto}
	c := newCachedClient(gw, newMemDetailsCache())
	_, _ = c.GetPlaceDetails(context.Background(), "p1")

	d, _ := c.GetPlaceDetails(context.Background(), "p1")
	if d.PhotoRefs != nil {
		t.Errorf("命中不該帶照片參照,實際 %v", d.PhotoRefs)
	}
}

func TestDetailsCache_Isolated_ExpiredEntryIsRefetched(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &countingGateway{body: detailsBodyOnePhoto}
	cache := newMemDetailsCache()
	c := newCachedClient(gw, cache)
	_, _ = c.GetPlaceDetails(context.Background(), "p1")

	cache.age("p1", 25*time.Hour) // 超過預設 24 小時

	d, _ := c.GetPlaceDetails(context.Background(), "p1")
	if d.FromCache {
		t.Error("過期的快取不該被當成命中")
	}
	if gw.calls.Load() != 2 {
		t.Errorf("過期後應再打一次 Google,實際共 %d 次", gw.calls.Load())
	}
}

func TestDetailsCache_Isolated_EntryJustInsideTTLIsStillAHit(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &countingGateway{body: detailsBodyOnePhoto}
	cache := newMemDetailsCache()
	c := newCachedClient(gw, cache)
	_, _ = c.GetPlaceDetails(context.Background(), "p1")

	cache.age("p1", 23*time.Hour)

	if d, _ := c.GetPlaceDetails(context.Background(), "p1"); !d.FromCache {
		t.Error("23 小時前的快取在 24 小時 TTL 內,應命中")
	}
	if gw.calls.Load() != 1 {
		t.Errorf("不該再打 Google,實際 %d 次", gw.calls.Load())
	}
}

// Fresh:補圖需要最新的照片參照、文字過期要重抓——明確繞過讀取,但結果仍寫回快取。
func TestDetailsCache_Isolated_FreshBypassesReadButWritesBack(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &countingGateway{body: detailsBodyOnePhoto}
	cache := newMemDetailsCache()
	c := newCachedClient(gw, cache)
	_, _ = c.GetPlaceDetails(context.Background(), "p1") // 先放進快取
	setsBefore := cache.sets

	d, err := c.GetPlaceDetailsFresh(context.Background(), "p1")
	if err != nil {
		t.Fatalf("GetPlaceDetailsFresh: %v", err)
	}
	if d.FromCache {
		t.Error("Fresh 的結果不該標示 FromCache")
	}
	if len(d.PhotoRefs) != 2 {
		t.Errorf("Fresh 要回完整照片參照,實際 %d", len(d.PhotoRefs))
	}
	if gw.calls.Load() != 2 {
		t.Errorf("Fresh 即使快取有資料也要打 Google,實際共 %d 次", gw.calls.Load())
	}
	if cache.sets != setsBefore+1 {
		t.Errorf("Fresh 的結果應寫回快取(讓之後的一般查詢命中新資料)")
	}
}

func TestDetailsCache_Isolated_NotFoundIsNotCached(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &countingGateway{status: http.StatusNotFound, body: `{}`}
	cache := newMemDetailsCache()
	c := newCachedClient(gw, cache)

	if _, err := c.GetPlaceDetails(context.Background(), "ghost"); err != ErrNotFound {
		t.Fatalf("應回 ErrNotFound,實際 %v", err)
	}
	if _, _, ok := cache.Get("ghost"); ok {
		t.Error("找不到的地點不該寫進快取(負快取是另一個議題,這裡不做)")
	}
}

func TestDetailsCache_Isolated_ServerErrorIsNotCached(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &countingGateway{status: http.StatusInternalServerError, body: `{}`}
	cache := newMemDetailsCache()
	c := newCachedClient(gw, cache)

	if _, err := c.GetPlaceDetails(context.Background(), "p1"); err == nil {
		t.Fatal("HTTP 500 應回錯誤")
	}
	if _, _, ok := cache.Get("p1"); ok {
		t.Error("失敗的結果不該寫進快取")
	}
	// 之後恢復正常,必須能重新打到 Google(失敗沒有毒化快取)。
	gw.status = http.StatusOK
	gw.body = detailsBodyOnePhoto
	if _, err := c.GetPlaceDetails(context.Background(), "p1"); err != nil {
		t.Fatalf("恢復後應成功: %v", err)
	}
}

// 沒掛快取的 Client 行為與加入快取之前完全相同(既有測試與呼叫端不受影響)。
func TestDetailsCache_Isolated_ClientWithoutCacheAlwaysCallsGoogle(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &countingGateway{body: detailsBodyOnePhoto}
	c := newCachedClient(gw, nil)

	for i := 0; i < 3; i++ {
		d, err := c.GetPlaceDetails(context.Background(), "p1")
		if err != nil || d.FromCache {
			t.Fatalf("第 %d 次: err=%v FromCache=%v", i+1, err, d.FromCache)
		}
	}
	if gw.calls.Load() != 3 {
		t.Errorf("沒掛快取應每次都打,實際 %d", gw.calls.Load())
	}
}

func TestDetailsCache_Isolated_DifferentPlacesDoNotShareEntries(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &countingGateway{body: detailsBodyOnePhoto}
	c := newCachedClient(gw, newMemDetailsCache())

	_, _ = c.GetPlaceDetails(context.Background(), "a")
	_, _ = c.GetPlaceDetails(context.Background(), "b")
	_, _ = c.GetPlaceDetails(context.Background(), "a")
	_, _ = c.GetPlaceDetails(context.Background(), "b")

	if gw.calls.Load() != 2 {
		t.Errorf("兩個不同地點各打 1 次,實際 %d", gw.calls.Load())
	}
}

func TestDetailsCache_Isolated_EmptyPlaceIDOrKeyNeverTouchesGoogleOrCache(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &countingGateway{body: detailsBodyOnePhoto}
	cache := newMemDetailsCache()
	c := newCachedClient(gw, cache)

	if _, err := c.GetPlaceDetails(context.Background(), ""); err != ErrNotFound {
		t.Errorf("空 placeID 應回 ErrNotFound,實際 %v", err)
	}
	noKey := NewWithGateway("", gw)
	noKey.SetDetailsCache(cache)
	if _, err := noKey.GetPlaceDetails(context.Background(), "p1"); err != ErrNoKey {
		t.Errorf("沒有 API key 應回 ErrNoKey,實際 %v", err)
	}
	if gw.calls.Load() != 0 {
		t.Errorf("以上兩種情況都不該打 Google,實際 %d", gw.calls.Load())
	}
}

// ===== 隔離:並發去重 =====

// 同一個 placeID 同時有 N 個請求(前端同一地點請求兩次、多個使用者同時點),
// 只該打 1 次 Google,其餘共用結果。
func TestDetailsCache_Isolated_ConcurrentMissesShareOneGoogleCall(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &countingGateway{body: detailsBodyOnePhoto, started: make(chan struct{}), release: make(chan struct{})}
	c := newCachedClient(gw, newMemDetailsCache())

	const n = 8
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := c.GetPlaceDetails(context.Background(), "hot"); err != nil {
				errs <- err
			}
		}()
	}
	<-gw.started                       // 第一個請求已經在 Google 那邊等待
	time.Sleep(100 * time.Millisecond) // 讓其餘請求都進到「等待共用」
	close(gw.release)
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Errorf("並發查詢失敗: %v", err)
	}
	if got := gw.calls.Load(); got != 1 {
		t.Errorf("%d 個並發請求應只打 1 次 Google,實際 %d", n, got)
	}
}

func TestDetailsCache_Isolated_ConcurrentDifferentPlacesAreIndependent(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &countingGateway{body: detailsBodyOnePhoto}
	c := newCachedClient(gw, newMemDetailsCache())

	var wg sync.WaitGroup
	for _, id := range []string{"a", "b", "c", "d"} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			_, _ = c.GetPlaceDetails(context.Background(), id)
		}(id)
	}
	wg.Wait()
	if got := gw.calls.Load(); got != 4 {
		t.Errorf("4 個不同地點應各打 1 次,實際 %d", got)
	}
}

// 第一個請求的 context 被取消(例如 AI 版 5 秒逾時、使用者斷線),不能害到
// 共用這次呼叫的其他請求。
func TestDetailsCache_Isolated_LeaderCancellationDoesNotFailFollowers(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &countingGateway{body: detailsBodyOnePhoto, started: make(chan struct{}), release: make(chan struct{})}
	c := newCachedClient(gw, newMemDetailsCache())

	leaderCtx, cancelLeader := context.WithCancel(context.Background())
	leaderDone := make(chan struct{})
	go func() {
		defer close(leaderDone)
		_, _ = c.GetPlaceDetails(leaderCtx, "hot")
	}()
	<-gw.started

	followerErr := make(chan error, 1)
	go func() {
		_, err := c.GetPlaceDetails(context.Background(), "hot")
		followerErr <- err
	}()
	time.Sleep(100 * time.Millisecond)
	cancelLeader()
	time.Sleep(50 * time.Millisecond)
	close(gw.release)

	if err := <-followerErr; err != nil {
		t.Errorf("領頭請求取消不該讓跟隨者失敗: %v", err)
	}
	<-leaderDone
}

// ===== 隔離:TTL 設定 =====

func TestDetailsCache_Isolated_MaxAgeSettingControlsExpiry(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	cases := []struct {
		name      string
		maxAge    time.Duration
		entryAge  time.Duration
		wantCalls int64
	}{
		{"TTL 1 小時,快取 30 分鐘前 → 命中", time.Hour, 30 * time.Minute, 1},
		{"TTL 1 小時,快取 2 小時前 → 過期重抓", time.Hour, 2 * time.Hour, 2},
		{"TTL 72 小時,快取 48 小時前 → 命中", 72 * time.Hour, 48 * time.Hour, 1},
		{"TTL 72 小時,快取 80 小時前 → 過期重抓", 72 * time.Hour, 80 * time.Hour, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			SetDetailsCacheMaxAge(tc.maxAge)
			gw := &countingGateway{body: detailsBodyOnePhoto}
			cache := newMemDetailsCache()
			c := newCachedClient(gw, cache)
			_, _ = c.GetPlaceDetails(context.Background(), "p1")
			cache.age("p1", tc.entryAge)

			_, _ = c.GetPlaceDetails(context.Background(), "p1")

			if gw.calls.Load() != tc.wantCalls {
				t.Errorf("期望 Google 被打 %d 次,實際 %d", tc.wantCalls, gw.calls.Load())
			}
		})
	}
}

func TestDetailsCacheMaxAge_DefaultIs24HoursAndRejectsNonPositive(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	if got := DetailsCacheMaxAge(); got != 24*time.Hour {
		t.Errorf("預設應為 24 小時,實際 %v", got)
	}
	SetDetailsCacheMaxAge(6 * time.Hour)
	for _, bad := range []time.Duration{0, -time.Hour} {
		SetDetailsCacheMaxAge(bad)
		if got := DetailsCacheMaxAge(); got != 6*time.Hour {
			t.Errorf("SetDetailsCacheMaxAge(%v) 不該生效(0 會讓所有快取立刻過期),目前 %v", bad, got)
		}
	}
}

// ===== 隔離:預設快取(讓 geo.New 建出來的 client 自動帶上,呼叫者無法跳過)=====

func TestDetailsCache_Isolated_DefaultCacheIsPickedUpByNew(t *testing.T) {
	cache := newMemDetailsCache()
	SetDefaultDetailsCache(cache)
	t.Cleanup(func() { SetDefaultDetailsCache(nil) })

	if c := New("key"); c.detailsCache == nil {
		t.Fatal("geo.New 建出來的 client 應自動帶上預設快取")
	}
}

func TestDetailsCache_Isolated_NoDefaultMeansNoCache(t *testing.T) {
	SetDefaultDetailsCache(nil)
	if c := New("key"); c.detailsCache != nil {
		t.Fatal("沒設定預設快取時,client 不該有快取")
	}
}

// NewWithGateway 是測試用建構子,不吃全域預設——避免測試之間靠全域狀態互相影響。
func TestDetailsCache_Isolated_NewWithGatewayIgnoresDefault(t *testing.T) {
	SetDefaultDetailsCache(newMemDetailsCache())
	t.Cleanup(func() { SetDefaultDetailsCache(nil) })

	if c := NewWithGateway("key", &countingGateway{}); c.detailsCache != nil {
		t.Fatal("NewWithGateway 不該自動帶預設快取")
	}
}

// ===== 合併:完整生命週期 =====

func TestDetailsCache_Combined_Lifecycle(t *testing.T) {
	resetDetailsCacheMaxAge(t)
	gw := &countingGateway{body: detailsBodyOnePhoto}
	cache := newMemDetailsCache()
	c := newCachedClient(gw, cache)
	ctx := context.Background()
	steps := []struct {
		name      string
		do        func() PlaceDetails
		wantCalls int64
		wantCache bool
	}{
		{"1 未命中 → 打 Google", func() PlaceDetails { d, _ := c.GetPlaceDetails(ctx, "p"); return d }, 1, false},
		{"2 命中", func() PlaceDetails { d, _ := c.GetPlaceDetails(ctx, "p"); return d }, 1, true},
		{"3 再命中", func() PlaceDetails { d, _ := c.GetPlaceDetails(ctx, "p"); return d }, 1, true},
		{"4 Fresh 繞過 → 打 Google", func() PlaceDetails { d, _ := c.GetPlaceDetailsFresh(ctx, "p"); return d }, 2, false},
		{"5 之後的一般查詢仍命中", func() PlaceDetails { d, _ := c.GetPlaceDetails(ctx, "p"); return d }, 2, true},
		{"6 快取過期 → 重抓", func() PlaceDetails { cache.age("p", 25*time.Hour); d, _ := c.GetPlaceDetails(ctx, "p"); return d }, 3, false},
		{"7 重抓後命中", func() PlaceDetails { d, _ := c.GetPlaceDetails(ctx, "p"); return d }, 3, true},
	}
	for _, s := range steps {
		d := s.do()
		if got := gw.calls.Load(); got != s.wantCalls {
			t.Fatalf("%s:Google 累計呼叫應為 %d,實際 %d", s.name, s.wantCalls, got)
		}
		if d.FromCache != s.wantCache {
			t.Fatalf("%s:FromCache 應為 %v,實際 %v", s.name, s.wantCache, d.FromCache)
		}
	}
}
