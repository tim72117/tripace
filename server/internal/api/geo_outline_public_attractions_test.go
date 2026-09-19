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
