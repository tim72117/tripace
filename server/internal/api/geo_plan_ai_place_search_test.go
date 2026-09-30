package api

// geo_outline_public_place_search_test.go 測 GET /public/geo/place-search
// (handlePublicGeoPlaceSearch)——免登入版通用地名查詢,涵蓋:成功查到結果、
// 查無結果、缺少 query 參數、以及最重要的全域拒絕型限流(publicPlaceSearchLimiter,
// 見該欄位在 api.go 的完整說明:這支端點沒有身份驗證,必須靠這個機制
// 防止被任意呼叫者濫用觸發 Google API 計費)。
//
// 複用 geo_outline_geocode_test.go 的 fakeSearchTextGateway/placesJSON/
// newTestServerWithFakeGeoGateway——這支 handler 跟 handleGeoGeocode 一樣
// 透過 Server.newGeoGeocodeClient 取得 geo.Client,同一套假 gateway 機制
// 可以直接重用,不需要為這個檔案另外寫一份。
import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandlePublicGeoPlaceSearch_MissingQuery_Returns400(t *testing.T) {
	s := newTestServerWithFakeGeoGateway(t, &fakeSearchTextGateway{})

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-search", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceSearch(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing query, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

func TestHandlePublicGeoPlaceSearch_Found_ReturnsFirstResult(t *testing.T) {
	fakeGateway := &fakeSearchTextGateway{responses: []string{placesJSON("安平古堡")}}
	t.Setenv("GOOGLE_PLACES_API_KEY", "test-places-api-key")
	s := newTestServerWithFakeGeoGateway(t, fakeGateway)

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-search?query=安平古堡", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceSearch(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var body struct {
		Found   bool    `json:"found"`
		Name    string  `json:"name"`
		Lat     float64 `json:"lat"`
		Lng     float64 `json:"lng"`
		PlaceID string  `json:"placeId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !body.Found || body.Name != "安平古堡" || body.PlaceID != "place_安平古堡" {
		t.Fatalf("unexpected response: %+v", body)
	}
}

func TestHandlePublicGeoPlaceSearch_NoResults_ReturnsFoundFalse(t *testing.T) {
	fakeGateway := &fakeSearchTextGateway{responses: []string{placesJSON()}}
	t.Setenv("GOOGLE_PLACES_API_KEY", "test-places-api-key")
	s := newTestServerWithFakeGeoGateway(t, fakeGateway)

	req := httptest.NewRequest(http.MethodGet, "/public/geo/place-search?query=不存在的地方", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoPlaceSearch(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var body struct {
		Found bool `json:"found"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if body.Found {
		t.Fatalf("expected found=false, got %+v", body)
	}
}

// TestHandlePublicGeoPlaceSearch_RateLimited_Returns429_WithoutCallingGateway
// 是這個新端點最重要的一項測試:第二次呼叫在限流視窗內被拒絕時,必須
// 回傳 429 且完全不觸發 fakeGateway.Do——這證明限流檢查確實在真正呼叫
// Google API 之前就攔下請求,不是「呼叫了 API 但事後才回應限流錯誤」
// 這種仍然會產生費用的錯誤實作方式。
func TestHandlePublicGeoPlaceSearch_RateLimited_Returns429_WithoutCallingGateway(t *testing.T) {
	fakeGateway := &fakeSearchTextGateway{responses: []string{placesJSON("安平古堡"), placesJSON("安平古堡")}}
	t.Setenv("GOOGLE_PLACES_API_KEY", "test-places-api-key")
	s := newTestServerWithFakeGeoGateway(t, fakeGateway)

	first := httptest.NewRequest(http.MethodGet, "/public/geo/place-search?query=安平古堡", nil)
	firstRec := httptest.NewRecorder()
	s.handlePublicGeoPlaceSearch(firstRec, first)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("expected first call to succeed with 200, got %d (body: %s)", firstRec.Code, firstRec.Body.String())
	}

	second := httptest.NewRequest(http.MethodGet, "/public/geo/place-search?query=安平天后宮", nil)
	secondRec := httptest.NewRecorder()
	s.handlePublicGeoPlaceSearch(secondRec, second)
	if secondRec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected second call to be rate limited with 429, got %d (body: %s)", secondRec.Code, secondRec.Body.String())
	}
	if len(fakeGateway.calls) != 1 {
		t.Fatalf("expected exactly 1 Google API call (rate-limited request should not reach the gateway), got %d", len(fakeGateway.calls))
	}
}
