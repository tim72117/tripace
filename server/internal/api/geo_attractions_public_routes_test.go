package api

// geo_attractions_public_routes_test.go 測 2026-10 新開放給訪客的
// GET /public/geo/attractions/nearby-only 與
// GET /public/geo/attractions/nearby(見 api.go Routes() 內該區塊、以及
// geo_outline.go handleGeoAttractionsOnlyNearby/handleGeoAttractionsNearby
// 開頭註解的完整說明)。
//
// 這兩支複用既有的 internal 版 handler,這裡只驗證「免登入能呼叫到」這個
// 改動本身的核心行為(完全不帶 Authorization header 也能拿到 200、回應
// 格式跟 internal 版一致),不是重新驗證 handler 內部的查詢邏輯——那部分
// 沒有因為這次改動而變動。
//
// 刻意不在測試環境設定 GOOGLE_PLACES_API_KEY:geo.Client.SearchNearby 在
// apiKey 為空字串時會立刻回傳 geo.ErrNoKey(見該函式開頭的檢查),不會真的
// 發送任何 HTTP 請求——fetchNearbyHotels 會吞掉這個錯誤、回傳空的 hotels
// 陣列(見該函式的完整說明),讓這裡的測試不需要 mock Google Places 網路
// 呼叫就能驗證路由本身是否正確掛載、回應格式是否正確,也不會因為外部
// 網路而變慢或不穩定。
import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestPublicGeoAttractionsNearbyOnly_NoAuth_NotUnauthorized 驗證訪客(完全
// 不帶 Authorization header)打 GET /public/geo/attractions/nearby-only
// 能得到正常的 200 回應,不是 internalAuth 那組 401,且回應格式跟
// /internal/geo/attractions/nearby-only(handleGeoAttractionsOnlyNearby)
// 一致——只有 attractions 欄位,沒有 hotels。
func TestPublicGeoAttractionsNearbyOnly_NoAuth_NotUnauthorized(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	req := httptest.NewRequest(http.MethodGet, "/public/geo/attractions/nearby-only?lat=23.0&lng=120.2", nil)
	rec := httptest.NewRecorder()
	routes.ServeHTTP(rec, req)

	if rec.Code == http.StatusUnauthorized {
		t.Fatalf("訪客請求不應被擋 401,實際: %d (body: %s)", rec.Code, rec.Body.String())
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("failed to decode response as map: %v (body: %s)", err, rec.Body.String())
	}
	if _, ok := raw["attractions"]; !ok {
		t.Fatalf("expected attractions field in response, got: %s", rec.Body.String())
	}
	if _, ok := raw["hotels"]; ok {
		t.Fatalf("expected no hotels field in nearby-only response, got: %s", rec.Body.String())
	}
}

// TestPublicGeoAttractionsNearby_NoAuth_NotUnauthorized 是上一支測試的
// nearby 版本(有 hotels 欄位)——同樣驗證訪客能成功打到新路由,不是 401,
// 且回應格式跟 /internal/geo/attractions/nearby(handleGeoAttractionsNearby)
// 一致:同時有 attractions 與 hotels 兩個欄位。
func TestPublicGeoAttractionsNearby_NoAuth_NotUnauthorized(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	req := httptest.NewRequest(http.MethodGet, "/public/geo/attractions/nearby?lat=23.0&lng=120.2", nil)
	rec := httptest.NewRecorder()
	routes.ServeHTTP(rec, req)

	if rec.Code == http.StatusUnauthorized {
		t.Fatalf("訪客請求不應被擋 401,實際: %d (body: %s)", rec.Code, rec.Body.String())
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var body struct {
		Attractions []attractionResponse `json:"attractions"`
		Hotels      []hotelResponse      `json:"hotels"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v (body: %s)", err, rec.Body.String())
	}
}

// TestThrottleGeoAttractionsByIP_AllowsUpToLimitThenBlocks 驗證
// throttleGeoAttractionsByIP(見 api.go 該函式與
// geoAttractionsIPThrottleWindow/geoAttractionsIPThrottleMaxCalls 的完整
// 說明)的邊界行為,對稱既有 TestThrottleGeoQueryByIP_AllowsUpToLimitThenBlocks
// 的驗證方式:同一個來源 IP 在視窗內的前 geoAttractionsIPThrottleMaxCalls
// (目前 30)次請求應全部放行,緊接著第 30+1 次應被拒絕(429
// rate_limited)。
func TestThrottleGeoAttractionsByIP_AllowsUpToLimitThenBlocks(t *testing.T) {
	s := newTestServer(t)

	const testIP = "203.0.113.42"
	for i := 0; i < geoAttractionsIPThrottleMaxCalls; i++ {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/public/geo/attractions/nearby", nil)
		r.Header.Set("X-Forwarded-For", testIP)
		if ok := s.throttleGeoAttractionsByIP(w, r); !ok {
			t.Fatalf("request %d/%d: expected allowed, got blocked (status %d)", i+1, geoAttractionsIPThrottleMaxCalls, w.Code)
		}
	}

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/public/geo/attractions/nearby", nil)
	r.Header.Set("X-Forwarded-For", testIP)
	if ok := s.throttleGeoAttractionsByIP(w, r); ok {
		t.Fatalf("request %d: expected blocked after exhausting quota, got allowed", geoAttractionsIPThrottleMaxCalls+1)
	}
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected status %d, got %d", http.StatusTooManyRequests, w.Code)
	}
}
