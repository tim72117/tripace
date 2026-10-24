package api

// geo_plan_ai_public_routes_test.go 測 2026-10 新開放給訪客的
// GET /public/geo/plan-ai/place-search 與
// GET /public/geo/plan-ai/attraction-search(見 api.go Routes 內該區塊、
// 以及 geo_plan_ai.go 檔案開頭註解的完整說明)。
//
// 跟 geo_plan_ai_place_search_test.go/geo_plan_ai_attraction_search_test.go
// 的差異:那兩個檔案直接呼叫 handlePublicGeoPlaceSearch/
// handlePublicGeoAttractionSearch 本身,驗證 handler 的查詢邏輯與既有的
// per-user/全域限流;這裡改走 s.Routes() 組出的真正 http.Handler,經由
// /public/geo/plan-ai/* 這個新路徑送請求,驗證兩件事:
//
//  1. 完全不帶 Authorization header(訪客)的請求也能成功打到這兩支新
//     端點、拿到正常回應(不是 401)——這是這次改動要修的核心問題
//     (/ai-plan 展示頁訪客打 /internal/geo/plan-ai/* 會被 internalAuth
//     擋下 401)。
//  2. 新增的 IP 節流(throttleGeoQueryByIP/geoQueryIPThrottleMaxCalls,見
//     api.go 的完整說明)在超過配額後正確回 429,且完全不會把請求放行到
//     handler 本身(用 fakeGateway 的呼叫次數驗證,比照
//     TestHandlePublicGeoPlaceSearch_RateLimited_Returns429_WithoutCallingGateway
//     的既有驗證方式)。
import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/store"
)

// newTestServerWithFakeGeoGatewayForRoutes 跟 newTestServerWithFakeGeoGateway
// 完全一樣(見該函式的完整說明),這裡另外重複定義一份只是為了讓這個
// 檔案的測試命名/註解能獨立參照這支建構邏輯,不直接依賴另一個測試檔案的
// 內部細節。
func newTestServerWithFakeGeoGatewayForRoutes(t *testing.T, fakeGateway *fakeSearchTextGateway) *Server {
	t.Helper()
	st := store.OpenTest(t)
	signer := auth.NewSigner("test-secret", 3600_000_000_000)
	s := New(st, signer, true, "test-google-client-id")
	s.newGeoGeocodeClient = func(apiKey string) *geo.Client {
		return geo.NewWithGateway(apiKey, fakeGateway)
	}
	return s
}

// TestPublicGeoPlanAiPlaceSearch_NoAuth_NotUnauthorized 驗證訪客(完全不帶
// Authorization header)打 GET /public/geo/plan-ai/place-search 能得到
// 正常的 200 回應,不是 internalAuth 那組 401——這是這次改動要修的
// /ai-plan 展示頁核心問題(見 web/src/planning/preview/LivePlanLayer.tsx
// 開頭 TODO 第1項)。
func TestPublicGeoPlanAiPlaceSearch_NoAuth_NotUnauthorized(t *testing.T) {
	fakeGateway := &fakeSearchTextGateway{responses: []string{placesJSON("安平古堡")}}
	t.Setenv("GOOGLE_PLACES_API_KEY", "test-places-api-key")
	s := newTestServerWithFakeGeoGatewayForRoutes(t, fakeGateway)
	routes := s.Routes()

	req := httptest.NewRequest(http.MethodGet, "/public/geo/plan-ai/place-search?query=安平古堡", nil)
	rec := httptest.NewRecorder()
	routes.ServeHTTP(rec, req)

	if rec.Code == http.StatusUnauthorized {
		t.Fatalf("訪客請求不應被擋 401,實際: %d (body: %s)", rec.Code, rec.Body.String())
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var body struct {
		Found bool   `json:"found"`
		Name  string `json:"name"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !body.Found || body.Name != "安平古堡" {
		t.Fatalf("unexpected response: %+v", body)
	}
}

// TestPublicGeoPlanAiAttractionSearch_NoAuth_NotUnauthorized 是上一支測試的
// attraction-search 版本——同樣驗證訪客能成功打到新路由,不是 401。這支
// 端點優先查資料庫候選(見 handlePublicGeoAttractionSearch 的完整說明),
// 這裡刻意查一個資料庫裡沒有任何候選、也不會觸發 Google Nearby Search
// 補點門檻的座標(只要不是 401/5xx,回應結構正常即可,不需要真的驗證
// 補點邏輯——那是 geo_plan_ai_attraction_search_test.go 的職責)。
func TestPublicGeoPlanAiAttractionSearch_NoAuth_NotUnauthorized(t *testing.T) {
	fakeGateway := &fakeNearbySearchGateway{response: nearbyPlacesJSON()}
	t.Setenv("GOOGLE_PLACES_API_KEY", "test-places-api-key")
	s := newTestServerWithFakeGeoGatewayForRoutes(t, &fakeSearchTextGateway{})
	s.newGeoGeocodeClient = func(apiKey string) *geo.Client {
		return geo.NewWithGateway(apiKey, fakeGateway)
	}
	routes := s.Routes()

	req := httptest.NewRequest(http.MethodGet, "/public/geo/plan-ai/attraction-search?lat=23.0&lng=120.2", nil)
	rec := httptest.NewRecorder()
	routes.ServeHTTP(rec, req)

	if rec.Code == http.StatusUnauthorized {
		t.Fatalf("訪客請求不應被擋 401,實際: %d (body: %s)", rec.Code, rec.Body.String())
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestThrottleGeoQueryByIP_AllowsUpToLimitThenBlocks 驗證 throttleGeoQueryByIP
// (見 api.go 該函式與 geoQueryIPThrottleWindow/geoQueryIPThrottleMaxCalls
// 的完整說明)的邊界行為,對稱既有
// TestThrottleGeoQueryByUser_AllowsUpToLimitThenBlocks 的驗證方式:同一個
// 來源 IP 在視窗內的前 geoQueryIPThrottleMaxCalls(目前 300)次請求應
// 全部放行,緊接著第 300+1 次應被拒絕(429 rate_limited)。
//
// 這支測試直接呼叫 throttleGeoQueryByIP 本身,不經過 Routes()/handler——
// 這層節流只讀 X-Forwarded-For/RemoteAddr 算出 key、操作記憶體內的
// geoQueryIPRateLimiter,不需要真的打 Google API 或經過完整路由堆疊,
// 直接測這個函式最單純也最快;也避免了經過 withGeoQueryIPThrottle 時,
// handler 本身呼叫的 SetLimitForKey(固定套用正式環境的
// geoQueryIPThrottleMaxCalls=300)把測試預先覆寫的較小配額蓋回去這個
// 問題——SetLimitForKey 的語意是「同一個 key 重複呼叫只覆寫規則、不
// 重置視窗計數」(見其完整說明),所以不能在這裡預先覆寫成小配額再經過
// 真正的 handler,只能直接送滿 300 次驗證正式數值本身的邊界。
func TestThrottleGeoQueryByIP_AllowsUpToLimitThenBlocks(t *testing.T) {
	s := newTestServer(t)

	const testIP = "203.0.113.7"
	for i := 0; i < geoQueryIPThrottleMaxCalls; i++ {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/public/geo/plan-ai/place-search", nil)
		r.Header.Set("X-Forwarded-For", testIP)
		// 判斷放行與否一律看回傳值本身,不猜測 w.Code——理由同
		// TestThrottleGeoQueryByUser_AllowsUpToLimitThenBlocks 的既有說明。
		if ok := s.throttleGeoQueryByIP(w, r); !ok {
			t.Fatalf("request %d/%d: expected allowed, got blocked (status %d)", i+1, geoQueryIPThrottleMaxCalls, w.Code)
		}
	}

	// 第 geoQueryIPThrottleMaxCalls+1 次:視窗配額已耗盡,應被拒絕。
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/public/geo/plan-ai/place-search", nil)
	r.Header.Set("X-Forwarded-For", testIP)
	if ok := s.throttleGeoQueryByIP(w, r); ok {
		t.Fatalf("request %d: expected blocked after exhausting quota, got allowed", geoQueryIPThrottleMaxCalls+1)
	}
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected status %d, got %d", http.StatusTooManyRequests, w.Code)
	}
}

// TestThrottleGeoQueryByIP_DifferentIPsHaveIndependentQuota 驗證 IP 節流的
// 「依 IP 分別計算」語意本身:來源 IP A 耗盡配額,不影響來源 IP B 的
// 配額——理由見 geoQueryIPRateLimiter 欄位的完整說明(這是訪客流量各自
// 獨立的資源池,不該讓某個訪客的操作頻率影響到其他訪客還剩多少配額
// 可用),對稱既有 TestThrottleGeoQueryByUser_DifferentUsersHaveIndependentQuota
// 的驗證方式。
func TestThrottleGeoQueryByIP_DifferentIPsHaveIndependentQuota(t *testing.T) {
	s := newTestServer(t)

	reqFromIP := func(ip string) bool {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/public/geo/plan-ai/place-search", nil)
		r.Header.Set("X-Forwarded-For", ip)
		return s.throttleGeoQueryByIP(w, r)
	}

	ipA := "198.51.100.1"
	ipB := "198.51.100.2"
	for i := 0; i < geoQueryIPThrottleMaxCalls; i++ {
		if !reqFromIP(ipA) {
			t.Fatalf("IP A request %d/%d: expected allowed, got blocked", i+1, geoQueryIPThrottleMaxCalls)
		}
	}
	// IP A 的配額已耗盡。
	if reqFromIP(ipA) {
		t.Fatalf("IP A: expected blocked after exhausting quota, got allowed")
	}
	// IP B 的配額應完全不受 IP A 影響,仍能正常放行。
	if !reqFromIP(ipB) {
		t.Fatalf("IP B: expected allowed (independent quota), got blocked")
	}
}

// TestThrottleGeoQueryByIP_ConcurrentRequests_ExactlyMaxCallsAllowed 驗證
// throttleGeoQueryByIP 在真正並發(多 goroutine 同時呼叫,不是上面
// TestThrottleGeoQueryByIP_AllowsUpToLimitThenBlocks 那種依序迴圈)下
// 計數仍然正確——RateLimiter.Allow/AllowWithLimit 內部用 sync.Mutex
// 保護(見 apigateway/ratelimiter.go 的完整說明),理論上併發安全,但
// 既有測試全部是單一 goroutine 依序呼叫,從未真正驗證過這個保護在併發
// 下確實生效,不是只在單執行緒情境下「剛好」沒出錯。
//
// 2026-10 新增(使用者明確要求「請求改並發看看」)。
//
// 驗證方式:同一個 IP,同時發出 2×geoQueryIPThrottleMaxCalls 次請求
// (超過配額一倍,確保一定會有請求被擋),用 atomic 計數器分別累計
// 放行與拒絕的次數,等全部 goroutine 完成後斷言:
//  1. 放行次數精確等於 geoQueryIPThrottleMaxCalls,不多也不少——如果
//     Mutex 保護失效,競態視窗會讓多個 goroutine 同時讀到「尚未達到
//     上限」的舊計數值、一起放行,放行次數就會超過配額(這是最常見的
//     併發計數 bug,單執行緒測試完全測不出來)。
//  2. 放行次數+拒絕次數精確等於發出的總請求數——驗證沒有請求在併發過程
//     中「消失」(例如 panic 被外層 recover 吞掉卻沒有計數)。
// 用 -race 執行這個測試(go test -race)能進一步確認沒有資料競態,這裡
// 的斷言本身驗證的是「計數語意正確」,-race 驗證的是「沒有未同步的
// 記憶體存取」,兩者互補、缺一不可。
func TestThrottleGeoQueryByIP_ConcurrentRequests_ExactlyMaxCallsAllowed(t *testing.T) {
	s := newTestServer(t)

	const testIP = "203.0.113.42"
	const totalRequests = geoQueryIPThrottleMaxCalls * 2

	var wg sync.WaitGroup
	var allowedCount, blockedCount int64

	for i := 0; i < totalRequests; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := httptest.NewRecorder()
			r := httptest.NewRequest(http.MethodGet, "/public/geo/plan-ai/place-search", nil)
			r.Header.Set("X-Forwarded-For", testIP)
			if s.throttleGeoQueryByIP(w, r) {
				atomic.AddInt64(&allowedCount, 1)
			} else {
				atomic.AddInt64(&blockedCount, 1)
			}
		}()
	}
	wg.Wait()

	if allowedCount != geoQueryIPThrottleMaxCalls {
		t.Fatalf("expected exactly %d allowed requests under concurrency, got %d (blocked=%d)",
			geoQueryIPThrottleMaxCalls, allowedCount, blockedCount)
	}
	if allowedCount+blockedCount != totalRequests {
		t.Fatalf("expected allowed+blocked to equal total requests %d, got %d (allowed=%d, blocked=%d)",
			totalRequests, allowedCount+blockedCount, allowedCount, blockedCount)
	}
}

// TestWithGeoQueryIPThrottle_BlocksBeforeCallingHandler 驗證
// withGeoQueryIPThrottle(見 api.go 的完整說明——Routes 用它包住
// /public/geo/plan-ai/* 這批公開路由)這個 wrapper 本身的疊加行為:
// 節流不通過時直接回 429、完全不呼叫被包住的 next handler;節流通過時
// 原封不動呼叫 next、把 next 的回應透傳回去。用一個簡單的假 next(不是
// 真正的 handlePublicGeoPlaceSearch)驗證這層 wrapper 本身的邏輯,不
// 牽涉 Google API/fakeGateway——那是上面幾支測試與
// geo_plan_ai_place_search_test.go/geo_plan_ai_attraction_search_test.go
// 各自的職責。
func TestWithGeoQueryIPThrottle_BlocksBeforeCallingHandler(t *testing.T) {
	s := newTestServer(t)

	nextCalls := 0
	next := func(w http.ResponseWriter, r *http.Request) {
		nextCalls++
		w.WriteHeader(http.StatusOK)
	}
	wrapped := withGeoQueryIPThrottle(s, next)

	const testIP = "203.0.113.9"
	doRequest := func() int {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/public/geo/plan-ai/place-search", nil)
		r.Header.Set("X-Forwarded-For", testIP)
		wrapped(w, r)
		return w.Code
	}

	for i := 0; i < geoQueryIPThrottleMaxCalls; i++ {
		if code := doRequest(); code != http.StatusOK {
			t.Fatalf("request %d/%d: expected 200, got %d", i+1, geoQueryIPThrottleMaxCalls, code)
		}
	}
	if nextCalls != geoQueryIPThrottleMaxCalls {
		t.Fatalf("expected next called %d times, got %d", geoQueryIPThrottleMaxCalls, nextCalls)
	}

	// 配額耗盡後:應回 429,且完全不再呼叫 next。
	if code := doRequest(); code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 after exhausting quota, got %d", code)
	}
	if nextCalls != geoQueryIPThrottleMaxCalls {
		t.Fatalf("next should not be called once quota is exhausted, but call count changed to %d", nextCalls)
	}
}

// TestClientIP 驗證 clientIP 對 X-Forwarded-For 的取值:取由後往前數
// trustedProxyHops 筆(預設 1,即代理追加的那一筆),不取用戶端可偽造的
// 最左邊值。
func TestClientIP(t *testing.T) {
	newReq := func(fwd, real, remote string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/x", nil)
		if fwd != "" {
			r.Header.Set("X-Forwarded-For", fwd)
		}
		if real != "" {
			r.Header.Set("X-Real-IP", real)
		}
		r.RemoteAddr = remote
		return r
	}

	cases := []struct {
		name   string
		hops   int
		fwd    string
		real   string
		remote string
		want   string
	}{
		{"單一值", 1, "203.0.113.7", "", "10.0.0.1:1234", "203.0.113.7"},
		{"用戶端偽造在最左邊,取代理追加的最後一筆", 1, "1.2.3.4, 203.0.113.9", "", "10.0.0.1:1234", "203.0.113.9"},
		{"多段偽造仍取最後一筆", 1, "9.9.9.9, 8.8.8.8, 203.0.113.9", "", "10.0.0.1:1234", "203.0.113.9"},
		{"空白與空項被忽略", 1, " 1.2.3.4 ,, 203.0.113.9 ,", "", "10.0.0.1:1234", "203.0.113.9"},
		{"前面多一層代理(hops=2)取倒數第二筆", 2, "1.2.3.4, 203.0.113.9, 130.211.0.1", "", "10.0.0.1:1234", "203.0.113.9"},
		{"筆數少於 hops 時不信任 header,退回 RemoteAddr", 2, "203.0.113.9", "", "10.0.0.1:1234", "10.0.0.1"},
		{"沒有 XFF 時不信任 X-Real-IP,用 RemoteAddr", 1, "", "198.51.100.5", "10.0.0.1:1234", "10.0.0.1"},
		{"XFF 筆數不足時也不信任 X-Real-IP", 2, "203.0.113.9", "198.51.100.5", "10.0.0.1:1234", "10.0.0.1"},
		{"XFF 足夠時 X-Real-IP 不影響結果", 1, "1.2.3.4, 203.0.113.9", "198.51.100.5", "10.0.0.1:1234", "203.0.113.9"},
		{"都沒有時用 RemoteAddr 去掉 port", 1, "", "", "192.0.2.10:5555", "192.0.2.10"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			old := trustedProxyHops
			trustedProxyHops = tc.hops
			t.Cleanup(func() { trustedProxyHops = old })
			if got := clientIP(newReq(tc.fwd, tc.real, tc.remote)); got != tc.want {
				t.Fatalf("clientIP = %q,想要 %q", got, tc.want)
			}
		})
	}
}

// TestTrustedProxyHopsFromEnv 驗證環境變數解析:非正整數一律回到預設 1。
func TestTrustedProxyHopsFromEnv(t *testing.T) {
	cases := map[string]int{"": 1, "1": 1, "2": 2, " 3 ": 3, "0": 1, "-1": 1, "abc": 1}
	for in, want := range cases {
		if got := trustedProxyHopsFromEnv(in); got != want {
			t.Errorf("trustedProxyHopsFromEnv(%q) = %d,想要 %d", in, got, want)
		}
	}
}

// TestThrottleGeoQueryByIP_SpoofedLeadingForwardedForCannotBypass 驗證
// 繞過情境:用戶端每次請求都在 X-Forwarded-For 最左邊放一個不同的假 IP,
// 代理追加的真實來源(最後一筆)不變——這些請求必須被算成同一個來源,
// 超過配額後被拒絕。若取最左邊的值,每次都會是新 key,永遠不會被限流。
func TestThrottleGeoQueryByIP_SpoofedLeadingForwardedForCannotBypass(t *testing.T) {
	s := newTestServer(t)
	old := trustedProxyHops
	trustedProxyHops = 1
	t.Cleanup(func() { trustedProxyHops = old })

	const realIP = "203.0.113.50"
	send := func(i int) bool {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/public/geo/plan-ai/place-search", nil)
		r.Header.Set("X-Forwarded-For", fmt.Sprintf("10.%d.%d.1, %s", i/250, i%250, realIP))
		return s.throttleGeoQueryByIP(w, r)
	}

	for i := 0; i < geoQueryIPThrottleMaxCalls; i++ {
		if !send(i) {
			t.Fatalf("第 %d 次應在配額內被放行", i+1)
		}
	}
	if send(geoQueryIPThrottleMaxCalls) {
		t.Fatal("偽造最左邊 X-Forwarded-For 不應能繞過節流:超過配額後必須被拒絕")
	}
}

// TestThrottleGeoQueryByIP_SpoofedXRealIPCannotBypass 驗證繞過情境:
// X-Forwarded-For 筆數不足(代理層數設定比實際多)時,用戶端每次請求換
// 一個假的 X-Real-IP,這些請求必須仍被算成同一個來源(RemoteAddr),
// 超過配額後被拒絕。若 X-Real-IP 是 fallback,每次都會是新 key,永遠不會
// 被限流。
func TestThrottleGeoQueryByIP_SpoofedXRealIPCannotBypass(t *testing.T) {
	s := newTestServer(t)
	old := trustedProxyHops
	trustedProxyHops = 2
	t.Cleanup(func() { trustedProxyHops = old })

	send := func(i int) bool {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/public/geo/plan-ai/place-search", nil)
		r.RemoteAddr = "10.0.0.1:4321"
		r.Header.Set("X-Forwarded-For", "203.0.113.50")
		r.Header.Set("X-Real-IP", fmt.Sprintf("10.%d.%d.1", i/250, i%250))
		return s.throttleGeoQueryByIP(w, r)
	}

	for i := 0; i < geoQueryIPThrottleMaxCalls; i++ {
		if !send(i) {
			t.Fatalf("第 %d 次應在配額內被放行", i+1)
		}
	}
	if send(geoQueryIPThrottleMaxCalls) {
		t.Fatal("偽造 X-Real-IP 不應能繞過節流:超過配額後必須被拒絕")
	}
}
