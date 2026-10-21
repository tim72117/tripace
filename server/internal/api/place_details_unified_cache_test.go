package api

// place_details_unified_cache_test.go 測「統一的地點詳情快取」在 api 層的接線
// (2026-10)。geo 層本身的行為(命中/過期/Fresh/並發去重)見
// internal/geo/details_cache_test.go,這裡只驗證 handler 接上之後:
//
//   - AI 版 place-details-any 對「未建檔地點」不再每個請求都打 Google
//     (原本 GetPlace 與請求數 1:1,昨天帳單的主因)
//   - 命中快取時,點擊數累加與補圖判斷照常運作(快取不能讓補圖停擺)
//   - 已建檔分支不再把 Google 的資料洗成 rating=0、並重設 fetched_at
//   - 地圖版 textOnly 未命中也會寫快取
//
// 測試結構(使用者要求「先隔離再合併」):隔離 → 合併。
import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/geosettings"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/photostorage"
)

// newUnifiedCacheServer 建一個「所有 Google client 都掛了統一快取」的 Server——
// 對應正式環境(cmd/server 啟動時 SetDefaultDetailsCache,geo.New 自動帶上)。
// seedAttraction 為 true 時把 placeID 建檔成 attraction(走已建檔分支)。
func newUnifiedCacheServer(t *testing.T, gw *countingPlaceGateway, placeID string, clicksBefore int, seedAttraction bool) *Server {
	t.Helper()
	geo.SetPhotosEnabled(true)
	t.Cleanup(func() {
		geo.SetPhotosEnabled(false)
		geo.SetDetailsCacheMaxAge(24 * time.Hour)
	})

	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, &fakePlaceDetailsGateway{})
	factory := func(apiKey string) *geo.Client {
		c := geo.NewWithGateway(apiKey, gw)
		c.SetDetailsCache(NewPlaceDetailsCache(s.store))
		return c
	}
	s.newGeoGeocodeClient = factory
	s.newPlaceDetailsClient = factory
	s.photoUploader = photostorage.NewForTest("test-bucket", photostorage.NewMemoryObjectStore())

	if seedAttraction {
		if _, err := s.store.CreateAttractionWithID(model.Attraction{
			ID: "lmk_unified_" + placeID, Name: "建檔景點", CityName: "台南",
			Lat: 23.0, Lng: 120.2, Level: 2, PlaceID: &placeID,
		}); err != nil {
			t.Fatalf("seed attraction: %v", err)
		}
	}
	if clicksBefore > 0 {
		// 先建列才能累加點擊數。
		if err := s.store.SetCachedPlaceDetails(placeID, "預建", "預建地址", 1, 2, 0, nil); err != nil {
			t.Fatalf("SetCachedPlaceDetails: %v", err)
		}
		s.store.SetCachedPlaceDetailsFetchedAtForTest(placeID, time.Unix(0, 0)) // 預建的列視為過期,不影響「第一次請求是否未命中」
		for i := 0; i < clicksBefore; i++ {
			_, _ = s.store.IncrementPlaceClickCount(placeID)
		}
	}
	return s
}

func clickCountOf(t *testing.T, s *Server, placeID string) int64 {
	t.Helper()
	row, ok, err := s.store.GetCachedPlaceDetails(placeID, 999999*time.Hour)
	if err != nil || !ok {
		t.Fatalf("GetCachedPlaceDetails(%s): ok=%v err=%v", placeID, ok, err)
	}
	return row.ClickCount
}

// ===== 隔離:介面卡 NewPlaceDetailsCache =====

func TestPlaceDetailsCacheAdapter_Isolated_MissingReturnsNotFound(t *testing.T) {
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, &fakePlaceDetailsGateway{})
	if _, _, ok := NewPlaceDetailsCache(s.store).Get("nope"); ok {
		t.Error("不存在的地點不該命中")
	}
}

func TestPlaceDetailsCacheAdapter_Isolated_SetThenGetRoundTrips(t *testing.T) {
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, &fakePlaceDetailsGateway{})
	c := NewPlaceDetailsCache(s.store)
	c.Set("p1", geo.PlaceDetails{Name: "名稱", Address: "地址", Lat: 1.5, Lng: 2.5, Rating: 4.2, Summary: "簡介"})

	d, at, ok := c.Get("p1")
	if !ok {
		t.Fatal("寫入後應能讀回")
	}
	if d.Name != "名稱" || d.Address != "地址" || d.Lat != 1.5 || d.Lng != 2.5 || d.Rating != 4.2 || d.Summary != "簡介" {
		t.Errorf("讀回的資料不對: %+v", d)
	}
	if d.PhotoRefs != nil {
		t.Error("快取不存照片參照")
	}
	if time.Since(at) > time.Minute {
		t.Errorf("fetchedAt 應是剛才,實際 %v", at)
	}
}

func TestPlaceDetailsCacheAdapter_Isolated_EmptySummaryRoundTripsAsEmpty(t *testing.T) {
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, &fakePlaceDetailsGateway{})
	c := NewPlaceDetailsCache(s.store)
	c.Set("p1", geo.PlaceDetails{Name: "無簡介", Address: "a"})
	d, _, ok := c.Get("p1")
	if !ok || d.Summary != "" {
		t.Errorf("沒有簡介的地點應讀回空字串,實際 ok=%v summary=%q", ok, d.Summary)
	}
}

// 補圖用的點擊數與實際張數住在同一列,寫入文字資料不能洗掉它們。
func TestPlaceDetailsCacheAdapter_Isolated_SetPreservesClickAndPhotoCount(t *testing.T) {
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, &fakePlaceDetailsGateway{})
	c := NewPlaceDetailsCache(s.store)
	c.Set("p1", geo.PlaceDetails{Name: "a"})
	for i := 0; i < 5; i++ {
		_, _ = s.store.IncrementPlaceClickCount("p1")
	}
	_ = s.store.SetPlacePhotoCount("p1", 7)

	c.Set("p1", geo.PlaceDetails{Name: "b", Address: "新地址"})

	if got := clickCountOf(t, s, "p1"); got != 5 {
		t.Errorf("click_count 應維持 5,實際 %d", got)
	}
	if n, _ := s.store.GetPlacePhotoCount("p1"); n == nil || *n != 7 {
		t.Errorf("photo_count 應維持 7,實際 %v", n)
	}
}

// ===== 隔離:place-details-any 的 Google 分支(未建檔地點)=====

func TestUnifiedCache_Isolated_UnknownPlaceHitsGoogleOnlyOnce(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("未建檔地點", 2)}
	placeID := "ChIJ_unified_unknown"
	s := newUnifiedCacheServer(t, gw, placeID, 0, false)

	for i := 0; i < 6; i++ {
		hitPlaceDetailsAny(t, s, gw, placeID)
	}

	if got := gw.count("places.get"); got != 1 {
		t.Errorf("6 次請求應只打 1 次 places.get(原本 6 次),實際 %d", got)
	}
}

func TestUnifiedCache_Isolated_HitStillCountsEveryClick(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("未建檔地點", 2)}
	placeID := "ChIJ_unified_clicks"
	s := newUnifiedCacheServer(t, gw, placeID, 0, false)

	for i := 0; i < 5; i++ {
		hitPlaceDetailsAny(t, s, gw, placeID)
	}

	if got := clickCountOf(t, s, placeID); got != 5 {
		t.Errorf("快取命中也要累加點擊數(補圖上限靠它),期望 5,實際 %d", got)
	}
}

func TestUnifiedCache_Isolated_HitReturnsTheSameTextAsMiss(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("文字一致測試", 1)}
	placeID := "ChIJ_unified_text"
	s := newUnifiedCacheServer(t, gw, placeID, 0, false)

	read := func() map[string]any {
		req := httptest.NewRequest(http.MethodGet, "/public/geo/plan-ai/place-details-any?placeId="+placeID, nil)
		rec := httptest.NewRecorder()
		s.handlePublicGeoPlaceDetailsAny(rec, req)
		gw.waitBackgroundIdle(t)
		return decodeJSONMap(t, rec.Body.Bytes())
	}
	miss, hit := read(), read()
	for _, k := range []string{"name", "address", "lat", "lng", "summary", "found"} {
		if miss[k] != hit[k] {
			t.Errorf("欄位 %s 命中與未命中不一致: %v vs %v", k, miss[k], hit[k])
		}
	}
	if miss["name"] != "文字一致測試" {
		t.Errorf("名稱不對: %v", miss["name"])
	}
}

// 快取不能讓補圖停擺:命中時照片參照是 nil,需要補圖的索引要靠
// GetPlaceDetailsFresh 拿最新的照片參照。
func TestUnifiedCache_Isolated_HitStillFillsMissingPhotos(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("三張照片", 3)}
	placeID := "ChIJ_unified_fill"
	s := newUnifiedCacheServer(t, gw, placeID, 99, false) // 點擊上限 3
	s.SetPhotoMaxCount(3)

	for i := 0; i < 8; i++ {
		hitPlaceDetailsAny(t, s, gw, placeID)
	}

	if got := gw.count("places.photoMedia"); got != 3 {
		t.Fatalf("三張照片都該補齊(第一次未命中補 1 張,其餘由命中時的補圖判斷補),photoMedia=%d", got)
	}
	getsAtReach := gw.count("places.get")
	for i := 0; i < 4; i++ {
		hitPlaceDetailsAny(t, s, gw, placeID)
	}
	if got := gw.count("places.get"); got != getsAtReach {
		t.Errorf("補齊之後不該再打 places.get:%d → %d", getsAtReach, got)
	}
}

func TestUnifiedCache_Isolated_ConcurrentRequestsForSameUnknownPlaceShareOneCall(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("並發地點", 1)}
	placeID := "ChIJ_unified_concurrent"
	s := newUnifiedCacheServer(t, gw, placeID, 0, false)

	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodGet, "/public/geo/plan-ai/place-details-any?placeId="+placeID, nil)
			s.handlePublicGeoPlaceDetailsAny(httptest.NewRecorder(), req)
		}()
	}
	wg.Wait()
	gw.waitBackgroundIdle(t)

	// 文字資料:6 個並發請求共用快取與並發去重,不該各打一次(原本 6 次)。
	// 容許最多 1 次額外的 places.get:領頭請求寫完快取後、還沒走到自己的補圖前,
	// 另一個請求已命中快取(沒有照片參照)並搶先拿到補圖標記,它補圖時必須自己用
	// GetPlaceDetailsFresh 取照片參照——那一次是補圖本來就需要的,跟文字資料要不要
	// 重查無關。真正要守住的是:不論並發多少,places.get 不隨請求數增加,而且
	// 補圖只做一次(photoMedia=1,補圖去重有效)。
	if got := gw.count("places.get"); got > 2 {
		t.Errorf("6 個並發請求打了 %d 次 places.get;最多只該有 1 次文字查詢加 1 次補圖取參照", got)
	}
	if got := gw.count("places.photoMedia"); got != 1 {
		t.Errorf("同一張照片只該補一次,實際 photoMedia=%d(補圖去重失效)", got)
	}
}

// ===== 隔離:已建檔分支不再覆蓋快取列 =====

func TestUnifiedCache_Isolated_AttractionBranchDoesNotClobberGoogleData(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("x", 0)}
	placeID := "ChIJ_unified_attraction_keep"
	s := newUnifiedCacheServer(t, gw, placeID, 0, true)
	// 地圖版先前從 Google 存了完整資料。
	if err := s.store.SetCachedPlaceDetails(placeID, "Google 名稱", "Google 地址", 23.1, 120.1, 4.6, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails: %v", err)
	}
	before, _, _ := s.store.GetCachedPlaceDetails(placeID, 999999*time.Hour)
	// 先放一張新鮮照片,避免這次請求觸發背景補圖——補圖會合法地打 Google 並用
	// 真實資料更新快取,那不是這個測試要驗證的事(要驗證的是「不被洗成 rating=0」)。
	writeFreshPhotoAsset(t, s, placeID, 0)

	hitPlaceDetailsAny(t, s, gw, placeID)

	after, ok, _ := s.store.GetCachedPlaceDetails(placeID, 999999*time.Hour)
	if !ok {
		t.Fatal("快取列應仍存在")
	}
	if after.Rating != 4.6 {
		t.Errorf("rating 被洗掉了:4.6 → %v(原本每次請求都用 rating=0 覆蓋)", after.Rating)
	}
	if after.Address != "Google 地址" {
		t.Errorf("address 被換成別的:%q", after.Address)
	}
	if !after.FetchedAt.Equal(before.FetchedAt) {
		t.Errorf("fetched_at 被重設:%v → %v(會讓地圖版的 24 小時重查被抑制)", before.FetchedAt, after.FetchedAt)
	}
	if after.ClickCount != before.ClickCount+1 {
		t.Errorf("點擊數應 +1,實際 %d → %d", before.ClickCount, after.ClickCount)
	}
}

// 列不存在時仍要建一列(補圖的點擊數累加需要它),但要標成「過期」——那一列
// 的內容是用建檔資料湊的(address 是城市名、沒有評分),不能被當成 Google 的
// 新鮮資料。
func TestUnifiedCache_Isolated_AttractionBranchCreatesStaleRowWhenAbsent(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("x", 0)}
	placeID := "ChIJ_unified_attraction_new"
	s := newUnifiedCacheServer(t, gw, placeID, 0, true)
	// 先放一張新鮮照片,避免這次請求觸發背景補圖(補圖會合法地打 Google 並更新快取)。
	writeFreshPhotoAsset(t, s, placeID, 0)

	hitPlaceDetailsAny(t, s, gw, placeID)

	_, at, ok := NewPlaceDetailsCache(s.store).Get(placeID)
	if !ok {
		t.Fatal("應建立快取列(點擊數累加需要)")
	}
	if time.Since(at) < geo.DetailsCacheMaxAge() {
		t.Errorf("用建檔資料湊出來的列必須標成過期,fetchedAt=%v", at)
	}
	if got := clickCountOf(t, s, placeID); got != 1 {
		t.Errorf("點擊數應為 1,實際 %d", got)
	}
}

// 建檔景點在「地圖版」要的是 Google 文字時,湊出來的那一列不該被當成新鮮
// 命中:第一次要打 Google 拿真資料。
func TestUnifiedCache_Isolated_StaleStubRowIsRefetchedByClientNotServedAsFresh(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("Google 真名稱", 1)}
	placeID := "ChIJ_unified_stub_refetch"
	s := newUnifiedCacheServer(t, gw, placeID, 0, true)
	// 先放一張新鮮照片,避免這次請求觸發背景補圖(補圖會合法地打 Google 並更新快取)。
	writeFreshPhotoAsset(t, s, placeID, 0)
	hitPlaceDetailsAny(t, s, gw, placeID) // 建出過期的湊合列

	c := s.newPlaceDetailsClient("k")
	d, err := c.GetPlaceDetails(testCtx(), placeID)
	if err != nil {
		t.Fatalf("GetPlaceDetails: %v", err)
	}
	if d.FromCache {
		t.Error("湊合列是過期的,不該當成快取命中")
	}
	if d.Name != "Google 真名稱" {
		t.Errorf("應拿到 Google 的真名稱,實際 %q", d.Name)
	}
}

// ===== 隔離:地圖版 textOnly 未命中會寫快取 =====

func TestUnifiedCache_Isolated_TextOnlyMissWritesCacheSoSecondCallIsFree(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("textOnly 地點", 1)}
	f := newPlaceDetailsFixture(t, &fakePlaceDetailsGateway{})
	f.server.newPlaceDetailsClient = func(apiKey string) *geo.Client {
		c := geo.NewWithGateway(apiKey, gw)
		c.SetDetailsCache(NewPlaceDetailsCache(f.server.store))
		return c
	}
	t.Cleanup(func() { geo.SetDetailsCacheMaxAge(24 * time.Hour) })

	get := func() int {
		req := httptest.NewRequest(http.MethodGet, "/internal/geo/place-details?placeId=ChIJ_textonly&textOnly=1", nil)
		req.Header.Set("Authorization", "Bearer "+f.token)
		rec := httptest.NewRecorder()
		f.routes.ServeHTTP(rec, req)
		return rec.Code
	}
	for i := 0; i < 4; i++ {
		if code := get(); code != http.StatusOK {
			t.Fatalf("第 %d 次: %d", i+1, code)
		}
	}
	if got := gw.count("places.get"); got != 1 {
		t.Errorf("textOnly 連點 4 次應只打 1 次 places.get(原本未命中分支不寫快取、每次都打),實際 %d", got)
	}
}

// ===== 隔離:快取有效期設定 =====

func TestUnifiedCache_Isolated_CacheHoursSettingDefaultsTo24(t *testing.T) {
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, &fakePlaceDetailsGateway{})
	t.Cleanup(func() { geo.SetDetailsCacheMaxAge(24 * time.Hour) })
	if got := s.PlaceDetailsCacheHours(); got != 24 {
		t.Errorf("預設應為 24 小時,實際 %d", got)
	}
}

func TestUnifiedCache_Isolated_SettingAppliesToGeoLayer(t *testing.T) {
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, &fakePlaceDetailsGateway{})
	t.Cleanup(func() { geo.SetDetailsCacheMaxAge(24 * time.Hour) })

	s.SetPlaceDetailsCacheHours(48)

	if got := geo.DetailsCacheMaxAge(); got != 48*time.Hour {
		t.Errorf("設定 48 小時後 geo 層應為 48h,實際 %v", got)
	}
	if got := s.PlaceDetailsCacheHours(); got != 48 {
		t.Errorf("PlaceDetailsCacheHours 應為 48,實際 %d", got)
	}
}

func TestUnifiedCache_Isolated_SettingIgnoresInvalidValues(t *testing.T) {
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, &fakePlaceDetailsGateway{})
	t.Cleanup(func() { geo.SetDetailsCacheMaxAge(24 * time.Hour) })
	s.SetPlaceDetailsCacheHours(12)
	for _, bad := range []int{0, -1, 100000} {
		s.SetPlaceDetailsCacheHours(bad)
		if got := s.PlaceDetailsCacheHours(); got != 12 {
			t.Errorf("SetPlaceDetailsCacheHours(%d) 不該生效(0 會讓快取立刻過期),目前 %d", bad, got)
		}
	}
}

func TestUnifiedCache_Isolated_RegistryEntry(t *testing.T) {
	st := geosettings.Find(geosettings.KeyPlaceDetailsCacheHours)
	if st == nil {
		t.Fatal("登錄表缺少 placeDetailsCacheHours")
	}
	if st.Default != 24 || st.Min != 1 {
		t.Errorf("預設應為 24、最小 1,實際 default=%d min=%d", st.Default, st.Min)
	}
}

// 把設定調短之後,已經存在的快取會立刻依新的有效期判斷是否過期。
func TestUnifiedCache_Isolated_ShorterSettingExpiresExistingEntriesImmediately(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("調整有效期", 1)}
	placeID := "ChIJ_unified_ttl"
	s := newUnifiedCacheServer(t, gw, placeID, 0, false)
	hitPlaceDetailsAny(t, s, gw, placeID)
	s.store.SetCachedPlaceDetailsFetchedAtForTest(placeID, time.Now().Add(-3*time.Hour)) // 3 小時前

	hitPlaceDetailsAny(t, s, gw, placeID) // 有效期 24h:命中
	if got := gw.count("places.get"); got != 1 {
		t.Fatalf("24 小時有效期內應命中,places.get=%d", got)
	}

	s.SetPlaceDetailsCacheHours(2) // 3 小時前的資料現在過期了
	hitPlaceDetailsAny(t, s, gw, placeID)
	if got := gw.count("places.get"); got != 2 {
		t.Errorf("調短到 2 小時後 3 小時前的快取應過期重抓,places.get=%d(期望 2)", got)
	}
}

// ===== 合併:一個冷地點的完整生命週期 =====

func TestUnifiedCache_Combined_ColdPlaceLifecycle(t *testing.T) {
	gw := &countingPlaceGateway{detailsBody: placeDetailsJSON("生命週期", 2)}
	placeID := "ChIJ_unified_lifecycle"
	s := newUnifiedCacheServer(t, gw, placeID, 0, false)
	s.SetPhotoMaxCount(2)
	s.SetPhotoExpiryDays(7)

	type snap struct{ gets, media int }
	take := func() snap { return snap{gw.count("places.get"), gw.count("places.photoMedia")} }

	// 1. 冷:未命中 → 打 Google 一次;點擊上限 1 → 補 1 張
	hitPlaceDetailsAny(t, s, gw, placeID)
	if got := take(); got.gets != 1 || got.media != 1 {
		t.Fatalf("1 冷請求:期望 gets=1 media=1,實際 %+v", got)
	}

	// 2. 熱:連續 8 次(點擊數 2..9,仍 < 10,上限仍是 1 張)→ 完全不打 Google
	for i := 0; i < 8; i++ {
		hitPlaceDetailsAny(t, s, gw, placeID)
	}
	if got := take(); got.gets != 1 || got.media != 1 {
		t.Fatalf("2 熱請求:Google 呼叫不該增加,實際 %+v", got)
	}
	if got := clickCountOf(t, s, placeID); got != 9 {
		t.Fatalf("2 熱請求:點擊數應累計到 9,實際 %d", got)
	}

	// 3. 點擊數跨過 10 次門檻 → 上限升到 2 張 → 命中時補第 2 張(用 Fresh 拿參照)
	hitPlaceDetailsAny(t, s, gw, placeID)
	if got := take(); got.media != 2 {
		t.Fatalf("3 跨門檻:應補第 2 張,實際 %+v", got)
	}

	// 4. 補齊(2 張 = 設定上限 = 實際張數)之後再也不打 Google
	after := take()
	for i := 0; i < 6; i++ {
		hitPlaceDetailsAny(t, s, gw, placeID)
	}
	if got := take(); got != after {
		t.Fatalf("4 補齊後:Google 呼叫不該再增加,%+v → %+v", after, got)
	}

	// 5. 張數已記下
	if n := mustPhotoCount(t, s, placeID); n == nil || *n != 2 {
		t.Errorf("5 應記下實際張數 2,實際 %v", n)
	}
}

func testCtx() context.Context { return context.Background() }

func decodeJSONMap(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("回應不是合法 JSON: %v (%s)", err, raw)
	}
	return m
}
