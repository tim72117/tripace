package api

// geo_outline_public_place_details_any_test.go 測
// GET /public/geo/place-details-any(handlePublicGeoPlaceDetailsAny)——
// 免登入版、不受 publicPlaceDetailsAllowlist 限制的地點詳情查詢,供
// /plan-ai 的 add_attraction 工具查任意 placeId 用(見該 handler 的
// 完整說明)。
//
// 複用 geo_outline_place_photo_progress_test.go 的 fakePlaceDetailsGateway/
// placeDetailsJSON——這支 handler 跟 handleGeoPlaceDetails 一樣呼叫
// client.GetPlaceDetails(對應 "places.get" endpoint),同一套假 gateway
// 機制可以直接重用,只是這裡改把 newGeoGeocodeClient(而非
// newPlaceDetailsClient)換成假 gateway,因為 handlePublicGeoPlaceDetailsAny
// 是透過前者取得 client(比照 handlePublicGeoPlaceSearch 的既有模式)。
import (
	"encoding/json"
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
// newGeoGeocodeClient(不是 newPlaceDetailsClient)換成「內部 gateway 是
// fakeGateway」的 geo.Client——handlePublicGeoPlaceDetailsAny 因此可以
// 整支被驗證,不會真的打 Google API。
func newTestServerWithFakePlaceDetailsGeoGeocodeClient(t *testing.T, fakeGateway *fakePlaceDetailsGateway) *Server {
	t.Helper()
	t.Setenv("GOOGLE_PLACES_API_KEY", "test-places-api-key")
	st := store.OpenTest(t)
	signer := auth.NewSigner("test-secret", 3600_000_000_000)
	s := New(st, signer, true, "test-google-client-id")
	s.newGeoGeocodeClient = func(apiKey string) *geo.Client {
		return geo.NewWithGateway(apiKey, fakeGateway)
	}
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

// TestHandlePublicGeoPlaceDetailsAny_NotInAllowlist_StillSucceeds 是這支
// 端點存在的核心理由:傳一個完全不在 publicPlaceDetailsAllowlist 裡的
// placeId(這裡用「不存在」是刻意的,證明這支端點根本不檢查那份白名單),
// 仍然要成功回傳結果——對比 handlePublicGeoPlaceDetails(受白名單限制的
// 舊端點)會回 403,這支新端點完全不做這個檢查。
func TestHandlePublicGeoPlaceDetailsAny_NotInAllowlist_StillSucceeds(t *testing.T) {
	fakeGateway := &fakePlaceDetailsGateway{detailsBody: placeDetailsJSON("河岸咖啡", 0)}
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, fakeGateway)

	notWhitelistedPlaceID := "ChIJ_not_in_any_allowlist_xyz"
	if publicPlaceDetailsAllowlist[notWhitelistedPlaceID] {
		t.Fatalf("test setup invalid: placeId unexpectedly present in publicPlaceDetailsAllowlist")
	}

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-details-any?placeId="+notWhitelistedPlaceID, nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceDetailsAny(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for placeId not in allowlist, got %d (body: %s)", rec.Code, rec.Body.String())
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
// google_place_photos 表已有既有快取時才帶 photoUrl(見
// handlePublicGeoPlaceDetailsAny 的完整說明——純讀快取,不觸發任何下載
// 或漸進補圖決策)。這個測試場景完全沒有寫入過快取,確認回應正確地不會
// 帶出這個欄位(不是漏寫,是真的沒有資料可帶),也確認不會意外多出
// photoRefs 這種內部欄位。
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
	if _, ok := raw["photoUrl"]; ok {
		t.Error("expected response to NOT include a photoUrl field")
	}
	if _, ok := raw["photoRefs"]; ok {
		t.Error("expected response to NOT include a photoRefs field")
	}
}

// TestHandlePublicGeoPlaceDetailsAny_AttractionRecordExists_SkipsGoogleAndReturnsStoredData
// 驗證「優先查 attractions 表」路徑(見 handler 的完整說明):attractions
// 表已有這個 placeId 的建檔紀錄時,直接回傳存好的 Name/Summary,完全不
// 呼叫 fakeGateway——用「fakeGateway 沒設 detailsBody,若真的被呼叫會
// 回傳空 body 導致解析失敗」這個手法間接證明 Google 完全沒被打到,不
// 需要額外的呼叫次數計數器。
//
// 2026-09:photoUrl 不再測試會回傳 attraction.PhotoURL——使用者明確
// 要求「不用回退」,這支端點現在只查 photo_assets(見
// store.GetFreshPhotoAssetURL 的完整說明),查無就不帶 photoUrl 欄位,
// 不論 attraction 本身是否存了 PhotoURL。這裡刻意仍在 seed 資料裡帶
// PhotoURL 欄位,是為了確認「即使 attraction 有這個欄位,回應也不會
// 誤用它」,不是遺留的無意義欄位。
func TestHandlePublicGeoPlaceDetailsAny_AttractionRecordExists_SkipsGoogleAndReturnsStoredData(t *testing.T) {
	fakeGateway := &fakePlaceDetailsGateway{}
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, fakeGateway)

	placeID := "ChIJ_attraction_record_test"
	summary := "已建檔景點的簡介"
	photoURL := "https://example.com/photo.jpg"
	if _, err := s.store.CreateAttractionWithID(model.Attraction{
		ID:       "lmk_test_place_details_any",
		Name:     "已建檔景點",
		CityName: "台南",
		Lat:      23.0,
		Lng:      120.2,
		Level:    2,
		Summary:  &summary,
		PhotoURL: &photoURL,
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
	if _, ok := raw["photoUrl"]; ok {
		t.Error("expected response to NOT include a photoUrl field when photo_assets has no record")
	}
}

// TestHandlePublicGeoPlaceDetailsAny_AttractionRecordExists_UsesPhotoAssetWhenPresent
// 驗證 attractions 表命中時,若 photo_assets 已經有這個 place_id 的
// 有效(未過期)紀錄,回應要帶上它的 GCSURL——這是目前唯一的正式照片
// 來源(見 store.GetFreshPhotoAssetURL 的完整說明),不論 attraction 本身
// 是否存了 PhotoURL 都一樣優先用 photo_assets。
func TestHandlePublicGeoPlaceDetailsAny_AttractionRecordExists_UsesPhotoAssetWhenPresent(t *testing.T) {
	fakeGateway := &fakePlaceDetailsGateway{}
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, fakeGateway)

	placeID := "ChIJ_uses_photo_asset_test"
	pexelsPhotoURL := "https://images.pexels.com/photos/example.jpg"
	if _, err := s.store.CreateAttractionWithID(model.Attraction{
		ID:       "lmk_uses_photo_asset_test",
		Name:     "有 Pexels 建檔照但也有 photo_assets 紀錄的景點",
		CityName: "台南",
		Lat:      23.0,
		Lng:      120.2,
		Level:    2,
		PhotoURL: &pexelsPhotoURL,
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
		PhotoURL string `json:"photoUrl"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if body.PhotoURL != "https://storage.googleapis.com/test-bucket/real-photo.jpg" {
		t.Fatalf("expected photo_assets url to be used, got: %q", body.PhotoURL)
	}
}

// TestHandlePublicGeoPlaceDetailsAny_GoogleFallbackWithCachedPhoto_IncludesPhotoURL
// 驗證 2026-09 新增的「Google fallback 路徑讀 google_place_photos 既有
// 快取」邏輯(見 handler 的完整說明)——attractions 表查無這個 placeId,
// 但 google_place_photos 表已經有其他呼叫端(例如登入後的正式 POI 點擊
// 查詢)留下的快取列時,這裡應該直接撿現成的第一張(photo_index 最小)
// 補上 photoUrl,不需要另外呼叫 Google Photo Media。
func TestHandlePublicGeoPlaceDetailsAny_GoogleFallbackWithCachedPhoto_IncludesPhotoURL(t *testing.T) {
	fakeGateway := &fakePlaceDetailsGateway{detailsBody: placeDetailsJSON("有快取照片的地點", 0)}
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, fakeGateway)

	placeID := "ChIJ_cached_photo_test"
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
		Found    bool   `json:"found"`
		Name     string `json:"name"`
		PhotoURL string `json:"photoUrl"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !body.Found || body.Name != "有快取照片的地點" || body.PhotoURL != "https://example.com/cached-photo.jpg" {
		t.Fatalf("unexpected response: %+v", body)
	}
}
