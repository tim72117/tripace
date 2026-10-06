package api

// geo_outline_public_place_details_any_test.go 測
// GET /public/geo/place-details-any(handlePublicGeoPlaceDetailsAny)——
// 免登入版、不受 handlePublicGeoPlaceDetails 那套「必須是已建檔
// attraction」授權限制的地點詳情查詢,供 /plan-ai 的 add_attraction
// 工具查任意 placeId 用(見該 handler 的完整說明)。
//
// 複用 geo_outline_place_photo_progress_test.go 的 fakePlaceDetailsGateway/
// placeDetailsJSON——這支 handler 跟 handleGeoPlaceDetails 一樣呼叫
// client.GetPlaceDetails(對應 "places.get" endpoint),同一套假 gateway
// 機制可以直接重用,只是這裡改把 newGeoGeocodeClient(而非
// newPlaceDetailsClient)換成假 gateway,因為 handlePublicGeoPlaceDetailsAny
// 是透過前者取得 client(比照 handlePublicGeoPlaceSearch 的既有模式)。
import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/store"
)

// newTestServerWithFakePlaceDetailsGeoGeocodeClient 建一個 Server,把
// newGeoGeocodeClient 跟 newPlaceDetailsClient 都換成「內部 gateway 是
// fakeGateway」的 geo.Client——handlePublicGeoPlaceDetailsAny 因此可以
// 整支被驗證,不會真的打 Google API。
//
// 2026-10:原本只覆寫 newGeoGeocodeClient(handlePublicGeoPlaceDetailsAny
// 自己的 Google fallback 分支曾經透過這個工廠建立 client)——套用跟
// handleGeoPlaceDetails 一致的漸進補圖機制後(見該 handler 的完整
// 說明),Google fallback 分支改成直接呼叫 fetchAndCachePlaceDetails
// (地圖版快取未命中時用的同一段核心邏輯),而那支函式內部寫死透過
// newPlaceDetailsClient 建立 client,不是 newGeoGeocodeClient——這裡
// 若只覆寫前者,fetchAndCachePlaceDetails 會繞過假 gateway、真的打
// Google API 導致測試失敗(實際踩到的真實問題:三個測試因此打到
// 正式 Google Places API 回傳 400 API key 不合法)。改成兩個工廠都
// 覆寫成同一個假 gateway,不管呼叫端走哪一個都不會真的打外部 API。
func newTestServerWithFakePlaceDetailsGeoGeocodeClient(t *testing.T, fakeGateway *fakePlaceDetailsGateway) *Server {
	t.Helper()
	t.Setenv("GOOGLE_PLACES_API_KEY", "test-places-api-key")
	st := store.OpenTest(t)
	signer := auth.NewSigner("test-secret", 3600_000_000_000)
	s := New(st, signer, true, "test-google-client-id")
	fakeClientFactory := func(apiKey string) *geo.Client {
		return geo.NewWithGateway(apiKey, fakeGateway)
	}
	s.newGeoGeocodeClient = fakeClientFactory
	s.newPlaceDetailsClient = fakeClientFactory
	return s
}

func TestHandlePublicGeoPlaceDetailsAny_MissingPlaceId_Returns400(t *testing.T) {
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, &fakePlaceDetailsGateway{})

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details-any", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetailsAny(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing placeId, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestHandlePublicGeoPlaceDetailsAny_NotAttraction_StillSucceeds 是這支
// 端點存在的核心理由:傳一個完全沒有建檔為 attraction 的 placeId(這裡用
// 「不存在」是刻意的,證明這支端點根本不檢查有沒有建檔),仍然要成功
// 回傳結果——對比 handlePublicGeoPlaceDetails(要求必須是已建檔
// attraction 才放行的舊端點)會回 403,這支新端點完全不做這個檢查。
func TestHandlePublicGeoPlaceDetailsAny_NotAttraction_StillSucceeds(t *testing.T) {
	fakeGateway := &fakePlaceDetailsGateway{detailsBody: placeDetailsJSON("河岸咖啡", 0)}
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, fakeGateway)

	notAttractionPlaceID := "ChIJ_not_an_attraction_xyz"
	if _, err := s.store.GetAttractionByPlaceID(notAttractionPlaceID); err == nil {
		t.Fatalf("test setup invalid: placeId unexpectedly exists as an attraction")
	}

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details-any?placeId="+notAttractionPlaceID, nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetailsAny(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for placeId not an attraction, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var body struct {
		Found   bool   `json:"found"`
		Name    string `json:"name"`
		Summary string `json:"summary"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !body.Found || body.Name != "河岸咖啡" || body.Summary != "測試簡介" {
		t.Fatalf("unexpected response: %+v", body)
	}
}

// Google fallback 路徑(attractions 表查無這個 placeId 時)只在
// photo_assets 已有有效紀錄時才帶 googlePhotoUrls(見
// handlePublicGeoPlaceDetailsAny 的完整說明)。這個測試場景完全沒有寫入
// 過任何照片紀錄,確認回應正確地不會帶出這個欄位(不是漏寫,是真的沒有
// 資料可帶),也確認不會意外多出 photoRefs 這種內部欄位。
func TestHandlePublicGeoPlaceDetailsAny_NoPhotosField_ResponseOmitsPhotos(t *testing.T) {
	fakeGateway := &fakePlaceDetailsGateway{detailsBody: placeDetailsJSON("測試地點", 3)}
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, fakeGateway)

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details-any?placeId=ChIJtest", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetailsAny(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("failed to decode raw response: %v", err)
	}
	if _, ok := raw["googlePhotoUrls"]; ok {
		t.Error("expected response to NOT include a googlePhotoUrls field")
	}
	if _, ok := raw["photoRefs"]; ok {
		t.Error("expected response to NOT include a photoRefs field")
	}
}

// TestHandlePublicGeoPlaceDetailsAny_AttractionRecordExists_ReturnsStoredDataSynchronously
// 驗證「優先查 attractions 表」路徑(見 handler 的完整說明):attractions
// 表已有這個 placeId 的建檔紀錄時,這次 HTTP 回應直接回傳存好的
// Name/Summary,不等待任何 Google 查詢完成才回應。
//
// 2026-10 改名(原名 *_SkipsGoogleAndReturnsStoredData):套用跟
// handleGeoPlaceDetails 一致的補圖節奏(photoCapForClickCount/
// decidePlacePhotoRefreshIndex,見 handler 的完整說明)後,這條分支
// 不再是「完全不打 Google」——這裡的 attraction 第一次被查詢,
// photo_assets 查無任何新鮮紀錄,decidePlacePhotoRefreshIndex 必定
// 判定要觸發,背景會啟動 backgroundFillPlacePhoto 嘗試呼叫
// fakeGateway.GetPlaceDetails(這裡的 fakeGateway 沒設 detailsBody,
// 背景呼叫會失敗、記一行 log,但不影響這次同步回應或測試斷言——這正是
// 這次改動刻意接受的行為:已建檔分支從零成本變成也會觸發背景補圖
// 嘗試,舊名稱「SkipsGoogle」已經不符合新行為,改名反映「這次 HTTP
// 回應仍然同步、不等 Google」這個真正被驗證的性質)。
//
// attractions.PhotoURL 這個相容欄位已經連同資料庫欄位本身徹底移除
// (見 cmd/migrate-drop-photo-url 的完整說明)——這支端點只查
// photo_assets(見 store.ListFreshPhotoAssetURLsForPlace 的完整說明),
// 查無就不帶 googlePhotoUrls 欄位。
func TestHandlePublicGeoPlaceDetailsAny_AttractionRecordExists_ReturnsStoredDataSynchronously(t *testing.T) {
	fakeGateway := &fakePlaceDetailsGateway{}
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, fakeGateway)

	placeID := "ChIJ_attraction_record_test"
	summary := "已建檔景點的簡介"
	if _, err := s.store.CreateAttractionWithID(model.Attraction{
		ID:       "lmk_test_place_details_any",
		Name:     "已建檔景點",
		CityName: "台南",
		Lat:      23.0,
		Lng:      120.2,
		Level:    2,
		Summary:  &summary,
		PlaceID:  &placeID,
	}); err != nil {
		t.Fatalf("failed to seed attraction: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details-any?placeId="+placeID, nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetailsAny(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("failed to decode raw response: %v", err)
	}
	var body struct {
		Found   bool   `json:"found"`
		Name    string `json:"name"`
		Summary string `json:"summary"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !body.Found || body.Name != "已建檔景點" || body.Summary != "已建檔景點的簡介" {
		t.Fatalf("unexpected response: %+v", body)
	}
	if _, ok := raw["googlePhotoUrls"]; ok {
		t.Error("expected response to NOT include a googlePhotoUrls field when photo_assets has no record")
	}
}

// TestHandlePublicGeoPlaceDetailsAny_AttractionRecordExists_UsesPhotoAssetWhenPresent
// 驗證 attractions 表命中時,若 photo_assets 已經有這個 place_id 的
// 有效(未過期)紀錄,回應要帶上它的 GCSURL——這是目前唯一的正式照片
// 來源(見 store.GetFreshPhotoAssetURL 的完整說明)。
func TestHandlePublicGeoPlaceDetailsAny_AttractionRecordExists_UsesPhotoAssetWhenPresent(t *testing.T) {
	fakeGateway := &fakePlaceDetailsGateway{}
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, fakeGateway)

	placeID := "ChIJ_uses_photo_asset_test"
	if _, err := s.store.CreateAttractionWithID(model.Attraction{
		ID:       "lmk_uses_photo_asset_test",
		Name:     "有 photo_assets 紀錄的景點",
		CityName: "台南",
		Lat:      23.0,
		Lng:      120.2,
		Level:    2,
		PlaceID:  &placeID,
	}); err != nil {
		t.Fatalf("failed to seed attraction: %v", err)
	}
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	if err := s.store.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID:    placeID,
		PhotoIndex: 0,
		Usage:      "full",
		Source:     "google",
		GCSURL:     "https://storage.googleapis.com/test-bucket/real-photo.jpg",
		FetchedAt:  time.Now(),
		ExpiresAt:  &expiresAt,
	}); err != nil {
		t.Fatalf("failed to seed photo asset: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details-any?placeId="+placeID, nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetailsAny(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var body struct {
		GooglePhotoURLs []string `json:"googlePhotoUrls"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(body.GooglePhotoURLs) != 1 || body.GooglePhotoURLs[0] != "https://storage.googleapis.com/test-bucket/real-photo.jpg" {
		t.Fatalf("expected photo_assets url to be used, got: %+v", body.GooglePhotoURLs)
	}
}

// TestHandlePublicGeoPlaceDetailsAny_MultiplePhotoAssets_ReturnsGooglePhotoUrls
// 驗證多圖瀏覽需求(使用者明確要求「ai plan 景點的照片比照景點介紹卡
// 照片可以多張瀏覽」):photo_assets 底下同一個 place_id 若有多筆有效
// 紀錄,回應要把完整清單一併帶在 googlePhotoUrls,前端 PhotoCarousel
// 才有多圖可以瀏覽。
func TestHandlePublicGeoPlaceDetailsAny_MultiplePhotoAssets_ReturnsGooglePhotoUrls(t *testing.T) {
	fakeGateway := &fakePlaceDetailsGateway{}
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, fakeGateway)

	placeID := "ChIJ_multiple_photo_assets_test"
	if _, err := s.store.CreateAttractionWithID(model.Attraction{
		ID:       "lmk_multiple_photo_assets_test",
		Name:     "有多張 photo_assets 紀錄的景點",
		CityName: "台南",
		Lat:      23.0,
		Lng:      120.2,
		Level:    2,
		PlaceID:  &placeID,
	}); err != nil {
		t.Fatalf("failed to seed attraction: %v", err)
	}
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	for i := 0; i < 3; i++ {
		if err := s.store.UpsertPhotoAsset(model.PhotoAsset{
			PlaceID:    placeID,
			PhotoIndex: i,
			Usage:      "full",
			Source:     "google",
			GCSURL:     fmt.Sprintf("https://storage.googleapis.com/test-bucket/photo-%d.jpg", i),
			FetchedAt:  time.Now(),
			ExpiresAt:  &expiresAt,
		}); err != nil {
			t.Fatalf("failed to seed photo asset %d: %v", i, err)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details-any?placeId="+placeID, nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetailsAny(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var body struct {
		GooglePhotoURLs []string `json:"googlePhotoUrls"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(body.GooglePhotoURLs) != 3 || body.GooglePhotoURLs[0] != "https://storage.googleapis.com/test-bucket/photo-0.jpg" {
		t.Fatalf("expected 3 googlePhotoUrls starting with photo-0, got %d: %v", len(body.GooglePhotoURLs), body.GooglePhotoURLs)
	}
}

// TestHandlePublicGeoPlaceDetailsAny_GoogleFallbackWithStalePhoto_OmitsPhotoURL
// 驗證 Google fallback 路徑(attractions 表查無這個 placeId 時走的分支,
// 見 handler 的完整說明)只信任 photo_assets(ListFreshPhotoAssetURLsForPlace)
// ——google_place_photos 表即使已經有其他呼叫端留下的快取列,這裡也不該
// 讀取它,查無 photo_assets 時回應乾脆不帶 googlePhotoUrls 這個欄位。
func TestHandlePublicGeoPlaceDetailsAny_GoogleFallbackWithStalePhoto_OmitsPhotoURL(t *testing.T) {
	fakeGateway := &fakePlaceDetailsGateway{detailsBody: placeDetailsJSON("有快取照片的地點", 0)}
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, fakeGateway)

	placeID := "ChIJ_cached_photo_test"
	// 舊表留一筆快取,驗證它不會被讀取(不是這個測試要驗證的路徑存在,
	// 而是要驗證它已經不存在)。
	if err := s.store.SetGooglePlacePhotos(placeID, []string{"https://example.com/cached-photo.jpg"}); err != nil {
		t.Fatalf("failed to seed cached photo: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details-any?placeId="+placeID, nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetailsAny(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var body struct {
		Found           bool     `json:"found"`
		Name            string   `json:"name"`
		GooglePhotoURLs []string `json:"googlePhotoUrls"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !body.Found || body.Name != "有快取照片的地點" {
		t.Fatalf("unexpected response: %+v", body)
	}
	if len(body.GooglePhotoURLs) != 0 {
		t.Fatalf("googlePhotoUrls 不該退回 google_place_photos 的舊快取,got: %v", body.GooglePhotoURLs)
	}
}

// TestHandlePublicGeoPlaceDetailsAny_AttractionRecordExists_WritesPlaceDetailsCacheRow
// 2026-10 新增:驗證已建檔 attraction 分支確實套用了跟 handleGeoPlaceDetails
// 一致的漸進補圖機制(見 handler 的完整說明)——這條分支過去完全不碰
// place_details_cache,這裡驗證呼叫後該表真的出現了這個 place_id 的
// 一列,且 ClickCount 等於 1(呼叫一次 IncrementPlaceClickCount 的結果)。
// 這是這次改動最核心的行為驗證:若這張表沒被寫入,代表
// SetCachedPlaceDetails 沒被呼叫到,IncrementPlaceClickCount 只會拿到
// 零值、漸進補圖永遠不會真正啟動。
func TestHandlePublicGeoPlaceDetailsAny_AttractionRecordExists_WritesPlaceDetailsCacheRow(t *testing.T) {
	fakeGateway := &fakePlaceDetailsGateway{}
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, fakeGateway)

	placeID := "ChIJ_writes_cache_row_test"
	if _, err := s.store.CreateAttractionWithID(model.Attraction{
		ID:       "lmk_writes_cache_row_test",
		Name:     "測試寫入快取列的景點",
		CityName: "台南",
		Lat:      23.0,
		Lng:      120.2,
		Level:    2,
		PlaceID:  &placeID,
	}); err != nil {
		t.Fatalf("failed to seed attraction: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details-any?placeId="+placeID, nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetailsAny(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}

	row, ok, err := s.store.GetCachedPlaceDetails(placeID, 999999*time.Hour)
	if err != nil {
		t.Fatalf("GetCachedPlaceDetails failed: %v", err)
	}
	if !ok {
		t.Fatal("expected place_details_cache row to exist after calling handlePublicGeoPlaceDetailsAny on an attraction-backed placeId")
	}
	if row.ClickCount != 1 {
		t.Fatalf("expected ClickCount=1 after first call, got %d", row.ClickCount)
	}
}

// TestHandlePublicGeoPlaceDetailsAny_AttractionRecordExists_PhotoAlreadyFresh_SkipsGoogleCall
// 2026-10 code review 發現的測試覆蓋缺口:既有測試全部是「第一次查詢
// 這個 placeId、本地完全沒有任何 photo_assets 紀錄」的情境,
// decidePlacePhotoRefreshIndex 必定回傳 shouldFetch=true——只驗證過
// 「該觸發」這條路徑,從未驗證過「cap 範圍內已經有新鮮照片」時不該
// 觸發的最常見穩態路徑。若日後 photoCapForClickCount/
// decidePlacePhotoRefreshIndex 被改錯,導致這條路徑誤判成「該觸發」,
// 不會有任何測試捕捉到這個回歸,會在正式環境悄悄推高 Google Photo
// API 配額用量。
//
// 2026-10 改寫(原本測的是舊機制「google_photo_target_count 手動設成
// 0」這個已經不存在的概念,見 decidePlacePhotoRefreshIndex 的完整
// 說明:新機制只看 photo_assets 的新鮮度,不再看任何計數器)——改成
// 直接寫一筆新鮮的 photo_assets 紀錄(writeFreshPhotoAsset,見
// geo_outline_place_photo_progress_test.go 的完整說明)模擬「cap
// 範圍內(click_count<10 時 cap=1)index=0 已經是新鮮照片」的穩態,
// 斷言完全沒有呼叫 gateway。
func TestHandlePublicGeoPlaceDetailsAny_AttractionRecordExists_PhotoAlreadyFresh_SkipsGoogleCall(t *testing.T) {
	fakeGateway := &fakePlaceDetailsGateway{}
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, fakeGateway)

	placeID := "ChIJ_photo_already_fresh_test"
	if _, err := s.store.CreateAttractionWithID(model.Attraction{
		ID:       "lmk_photo_already_fresh_test",
		Name:     "測試照片已新鮮不觸發的景點",
		CityName: "台南",
		Lat:      23.0,
		Lng:      120.2,
		Level:    2,
		PlaceID:  &placeID,
	}); err != nil {
		t.Fatalf("failed to seed attraction: %v", err)
	}

	// 直接用 store 層函式手動建好快取列,不透過 HTTP 呼叫觸發第一次
	// 查詢——若改成先打一次端點讓第一次查詢自然觸發背景 goroutine,
	// 會在這裡清空 fakeGateway.calls 時跟那個尚未結束的背景 goroutine
	// 產生資料競爭(用 -race 實測踩到:fakePlaceDetailsGateway.Do 寫入
	// calls 的同時測試主線程在清空同一個切片)。手動建列完全是同步的
	// DB 寫入,不會啟動任何背景查詢,乾淨避開這個時序問題。
	if err := s.store.SetCachedPlaceDetails(placeID, "測試照片已新鮮不觸發的景點", "台南", 23.0, 120.2, 0, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails failed: %v", err)
	}
	// cap(click_count<10)=1,index=0 已經是新鮮紀錄——decidePlacePhotoRefreshIndex
	// 掃描 [0,1) 範圍會發現全部新鮮,不觸發。
	writeFreshPhotoAsset(t, s, placeID, 0)

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details-any?placeId="+placeID, nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetailsAny(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	if len(fakeGateway.calls) != 0 {
		t.Fatalf("cap 範圍內照片已新鮮時不該呼叫 Google API,實際打了 %d 次: %v", len(fakeGateway.calls), fakeGateway.calls)
	}

	row, ok, err := s.store.GetCachedPlaceDetails(placeID, 999999*time.Hour)
	if err != nil {
		t.Fatalf("GetCachedPlaceDetails failed: %v", err)
	}
	if !ok {
		t.Fatal("expected place_details_cache row to still exist")
	}
	if row.ClickCount != 1 {
		t.Fatalf("expected ClickCount=1 after the handler's own IncrementPlaceClickCount call, got %d", row.ClickCount)
	}
}
