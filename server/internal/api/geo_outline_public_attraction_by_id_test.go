package api

// geo_outline_public_attraction_by_id_test.go 測
// GET /public/geo/attraction/{id}(handlePublicGeoAttractionByID)——免登入
// 版、用資料庫 id 查單筆已建檔景點,供 /plan-ai 的 search_attraction/
// add_attraction 工具流程使用(見該 handler 的完整說明)。

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/store"
)

func newTestServerForAttractionByID(t *testing.T) *Server {
	t.Helper()
	st := store.OpenTest(t)
	signer := auth.NewSigner("test-secret", 3600_000_000_000)
	return New(st, signer, true, "test-google-client-id")
}

func TestHandlePublicGeoAttractionByID_MissingID_Returns400(t *testing.T) {
	s := newTestServerForAttractionByID(t)

	req := httptest.NewRequest(http.MethodGet, "/public/geo/attraction/", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoAttractionByID(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing id, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

func TestHandlePublicGeoAttractionByID_NotFound_Returns404(t *testing.T) {
	s := newTestServerForAttractionByID(t)

	req := httptest.NewRequest(http.MethodGet, "/public/geo/attraction/lmk_does_not_exist", nil)
	req.SetPathValue("id", "lmk_does_not_exist")
	rec := httptest.NewRecorder()
	s.handlePublicGeoAttractionByID(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown id, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestHandlePublicGeoAttractionByID_Found_ReturnsStoredFields 驗證命中時
// 回傳的欄位對齊 store.GetAttraction 存的資料,包含選填欄位(summary/
// placeId)都正確帶出。
//
// 2026-09:不再測試會回傳 attraction.PhotoURL——使用者明確要求前端
// 不該再取用這個欄位可能存的 Pexels 示意圖網址,這支端點的 photoUrl
// 現在只查 photo_assets(見 handlePublicGeoAttractionByID 的完整
// 說明),沒有 photo_assets 紀錄時就不帶這個欄位,即使 attraction 本身
// 存了 PhotoURL 也一樣。這裡刻意仍在 seed 資料裡帶 PhotoURL,是為了
// 確認「即使 attraction 有這個欄位,回應也不會誤用它」。
func TestHandlePublicGeoAttractionByID_Found_ReturnsStoredFields(t *testing.T) {
	s := newTestServerForAttractionByID(t)

	summary := "測試景點簡介"
	photoURL := "https://example.com/attraction-photo.jpg"
	placeID := "ChIJ_attraction_by_id_test"
	if _, err := s.store.CreateAttractionWithID(model.Attraction{
		ID:       "lmk_attraction_by_id_test",
		Name:     "測試景點",
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

	req := httptest.NewRequest(http.MethodGet, "/public/geo/attraction/lmk_attraction_by_id_test", nil)
	req.SetPathValue("id", "lmk_attraction_by_id_test")
	rec := httptest.NewRecorder()
	s.handlePublicGeoAttractionByID(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("failed to decode raw response: %v", err)
	}
	var body struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Summary string `json:"summary"`
		PlaceID string `json:"placeId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if body.ID != "lmk_attraction_by_id_test" || body.Name != "測試景點" || body.Summary != summary ||
		body.PlaceID != placeID {
		t.Fatalf("unexpected response: %+v", body)
	}
	if _, ok := raw["photoUrl"]; ok {
		t.Error("expected response to NOT include a photoUrl field when photo_assets has no record")
	}
}

// TestHandlePublicGeoAttractionByID_HasFreshPhotoAsset_ReturnsGCSURL 驗證
// photo_assets 有這個 place_id 的有效紀錄時,photoUrl 帶的是它的 GCSURL。
func TestHandlePublicGeoAttractionByID_HasFreshPhotoAsset_ReturnsGCSURL(t *testing.T) {
	s := newTestServerForAttractionByID(t)

	placeID := "ChIJ_attraction_by_id_photo_asset_test"
	if _, err := s.store.CreateAttractionWithID(model.Attraction{
		ID:       "lmk_attraction_by_id_photo_asset_test",
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

	req := httptest.NewRequest(http.MethodGet, "/public/geo/attraction/lmk_attraction_by_id_photo_asset_test", nil)
	req.SetPathValue("id", "lmk_attraction_by_id_photo_asset_test")
	rec := httptest.NewRecorder()
	s.handlePublicGeoAttractionByID(rec, req)

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

// TestHandlePublicGeoAttractionByID_NoPlaceID_OmitsPlaceIDField 驗證未
// 建檔 place_id 的景點(人工建檔當下沒有查到對應地點,見
// model.Attraction.PlaceID 的完整說明)回應裡不會出現 placeId 這個 key,
// 供前端 insertAttractionAfter 判斷「這筆沒有 placeId,不需要再查
// place-details-any 補強」。
func TestHandlePublicGeoAttractionByID_NoPlaceID_OmitsPlaceIDField(t *testing.T) {
	s := newTestServerForAttractionByID(t)

	if _, err := s.store.CreateAttractionWithID(model.Attraction{
		ID:       "lmk_no_place_id_test",
		Name:     "沒有 place_id 的景點",
		CityName: "台南",
		Lat:      23.0,
		Lng:      120.2,
		Level:    2,
	}); err != nil {
		t.Fatalf("failed to seed attraction: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/public/geo/attraction/lmk_no_place_id_test", nil)
	req.SetPathValue("id", "lmk_no_place_id_test")
	rec := httptest.NewRecorder()
	s.handlePublicGeoAttractionByID(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("failed to decode raw response: %v", err)
	}
	if _, ok := raw["placeId"]; ok {
		t.Error("expected response to NOT include a placeId field")
	}
}
