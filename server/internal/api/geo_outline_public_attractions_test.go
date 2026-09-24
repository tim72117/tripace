package api

// geo_outline_public_attractions_test.go 測 GET /public/geo/attractions
// (handlePublicGeoAttractions)——對稱 geo_outline_public_place_details_test.go
// 的測試範圍:白名單之外的城市一律拒絕、白名單內的城市只回傳資料庫
// 內容(不含 Google Places 即時查詢 fallback,見 handleGeoAttractionsByCity
// 的完整說明)。
import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/model"
)

func TestHandlePublicGeoAttractions_NotInAllowlist_Returns403(t *testing.T) {
	s := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/public/geo/attractions?city=東京", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoAttractions(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for city not in allowlist, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

func TestHandlePublicGeoAttractions_EmptyCity_Returns403(t *testing.T) {
	s := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/public/geo/attractions", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoAttractions(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for empty city, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

func TestHandlePublicGeoAttractions_InAllowlist_ReturnsDBAttractionsOnly(t *testing.T) {
	s := newTestServer(t)

	category := "tea"
	if _, err := s.store.CreateAttraction(model.Attraction{
		Name: "忠僕茶屋", CityName: "京都", Lat: 34.9947008, Lng: 135.7835561,
		Level: 3, IsTheme: false, Category: &category,
	}); err != nil {
		t.Fatalf("CreateAttraction failed: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/public/geo/attractions?city=京都", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoAttractions(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}

	var body struct {
		Attractions []attractionResponse `json:"attractions"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(body.Attractions) != 1 {
		t.Fatalf("expected exactly 1 attraction, got %d: %+v", len(body.Attractions), body.Attractions)
	}
	got := body.Attractions[0]
	if got.Name != "忠僕茶屋" || got.Category != "tea" {
		t.Fatalf("unexpected attraction in response: %+v", got)
	}
	// 這支端點的回應刻意不含 hotels/city(見 handlePublicGeoAttractions
	// 的完整說明)——確認回應本身不會意外多出這些欄位造成前端誤解。
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("failed to decode raw response: %v", err)
	}
	if _, ok := raw["hotels"]; ok {
		t.Error("expected response to NOT include a hotels field")
	}
}

// TestHandlePublicGeoAttractions_LandmarkPhotoURL_UsesPhotoAssetsNotAttractionPhotoURL
// 驗證 handleGeoAttractionsByCity 組回應時,LandmarkPhotoURL 只查
// photo_assets(見 store.ListFreshPhotoAssetURLs 的完整說明),不再讀
// attraction.PhotoURL——使用者明確要求全面停用這個欄位:即使 attraction
// 本身存了 PhotoURL,只要沒有對應的 photo_assets 紀錄,回應就不該帶出
// 那個值;有 photo_assets 紀錄時要用它的 GCSURL。
func TestHandlePublicGeoAttractions_LandmarkPhotoURL_UsesPhotoAssetsNotAttractionPhotoURL(t *testing.T) {
	s := newTestServer(t)

	noPhotoAssetPlaceID := "ChIJ_no_photo_asset_test"
	attractionPhotoURL := "https://images.pexels.com/photos/example.jpg"
	if _, err := s.store.CreateAttraction(model.Attraction{
		Name: "沒有 photo_assets 紀錄的景點", CityName: "京都", Lat: 34.99, Lng: 135.78,
		Level: 3, PhotoURL: &attractionPhotoURL, PlaceID: &noPhotoAssetPlaceID,
	}); err != nil {
		t.Fatalf("CreateAttraction failed: %v", err)
	}

	hasPhotoAssetPlaceID := "ChIJ_has_photo_asset_test"
	if _, err := s.store.CreateAttraction(model.Attraction{
		Name: "有 photo_assets 紀錄的景點", CityName: "京都", Lat: 34.98, Lng: 135.77,
		Level: 3, PlaceID: &hasPhotoAssetPlaceID,
	}); err != nil {
		t.Fatalf("CreateAttraction failed: %v", err)
	}
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	if err := s.store.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID:    hasPhotoAssetPlaceID,
		PhotoIndex: 0,
		Usage:      "full",
		Source:     "google",
		GCSURL:     "https://storage.googleapis.com/test-bucket/real-photo.jpg",
		FetchedAt:  time.Now(),
		ExpiresAt:  &expiresAt,
	}); err != nil {
		t.Fatalf("failed to seed photo asset: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/public/geo/attractions?city=京都", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoAttractions(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var body struct {
		Attractions []attractionResponse `json:"attractions"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(body.Attractions) != 2 {
		t.Fatalf("expected exactly 2 attractions, got %d: %+v", len(body.Attractions), body.Attractions)
	}
	byName := make(map[string]attractionResponse, len(body.Attractions))
	for _, a := range body.Attractions {
		byName[a.Name] = a
	}
	if got := byName["沒有 photo_assets 紀錄的景點"]; got.LandmarkPhotoURL != "" {
		t.Errorf("expected no LandmarkPhotoURL when photo_assets has no record, got %q", got.LandmarkPhotoURL)
	}
	if got := byName["有 photo_assets 紀錄的景點"]; got.LandmarkPhotoURL != "https://storage.googleapis.com/test-bucket/real-photo.jpg" {
		t.Errorf("expected photo_assets GCSURL, got %q", got.LandmarkPhotoURL)
	}
}

func TestHandlePublicGeoAttractions_InAllowlist_EmptyCityDataReturnsEmptyArray(t *testing.T) {
	s := newTestServer(t)

	// 京都在白名單內,但資料庫裡完全沒有這個城市的資料——應該回傳空陣列,
	// 不觸發任何 Google Places 查詢 fallback(見
	// handleGeoAttractionsByCity 與 handleGeoAttractions 兩者行為刻意
	// 不同的完整說明)。
	req := httptest.NewRequest(http.MethodGet, "/public/geo/attractions?city=京都", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoAttractions(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var body struct {
		Attractions []attractionResponse `json:"attractions"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(body.Attractions) != 0 {
		t.Fatalf("expected empty attractions array, got %+v", body.Attractions)
	}
}
