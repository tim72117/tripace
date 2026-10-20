package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestCORS_PreflightAllowsHeadersTheFrontendSends 驗證 preflight 回應的
// Access-Control-Allow-Headers 涵蓋前端實際會送的標頭。
//
// 背景:前端在沒有登入 token 時一律附加 X-Guest-Id(web/src/api.ts)。這個
// 標頭沒列進允許清單時,本機開發(Vite 5173 → server 8080,跨來源)的所有
// 未登入請求都會被瀏覽器的 preflight 擋掉,頁面表現成「找不到資料」,而
// server 完全沒收到請求——除錯時很難聯想到是 CORS。這裡用 guestIDHeader
// 常數(server 讀取該標頭的地方)綁住允許清單,兩邊任何一邊改名都會失敗。
func TestCORS_PreflightAllowsHeadersTheFrontendSends(t *testing.T) {
	called := false
	h := cors(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))

	req := httptest.NewRequest(http.MethodOptions, "/v1/itinerary-pages", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Access-Control-Request-Method", "GET")
	req.Header.Set("Access-Control-Request-Headers", "x-guest-id")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("preflight 應回 204,實際 %d", w.Code)
	}
	if called {
		t.Fatal("preflight 不應該呼叫到後面的 handler")
	}
	allowed := strings.ToLower(w.Header().Get("Access-Control-Allow-Headers"))
	for _, want := range []string{"authorization", "content-type", strings.ToLower(guestIDHeader)} {
		if !strings.Contains(allowed, want) {
			t.Errorf("Access-Control-Allow-Headers = %q,缺少 %q", allowed, want)
		}
	}
	if w.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Errorf("Access-Control-Allow-Origin 應維持現行行為 *,實際 %q", w.Header().Get("Access-Control-Allow-Origin"))
	}
}

// TestCORS_NonPreflightPassesThrough 一般請求原樣交給後面的 handler。
func TestCORS_NonPreflightPassesThrough(t *testing.T) {
	called := false
	h := cors(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusTeapot)
	}))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))
	if !called || w.Code != http.StatusTeapot {
		t.Fatalf("一般請求應穿透到 handler,called=%v code=%d", called, w.Code)
	}
}
