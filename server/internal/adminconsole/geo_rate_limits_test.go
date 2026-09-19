package adminconsole

// geo_rate_limits_test.go 測 GET/PUT /admin/api/geo-rate-limits(見
// listGeoRateLimits/updateGeoRateLimit 的完整說明)。跟
// adminconsole_test.go 的 TestAdminAPIEndToEnd 共用同一套「開一個真的
// httptest.Server + 登入取得 session cookie」的測試手法,獨立成專屬檔案
// 而非塞進那個泛用 e2e 測試,理由同該檔案一貫的組織慣例:各功能領域
// 各自一個測試檔案。
import (
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tim72117/tripace/internal/adminauth"
)

// newAuthedGeoRateLimitTestClient 開一支測試 server、登入一個管理員帳號,
// 回傳已帶有合法 session cookie 的 client 與 server URL——供本檔案每個
// 測試各自呼叫,避免重複這段固定的登入樣板。
func newAuthedGeoRateLimitTestClient(t *testing.T) (*http.Client, string) {
	t.Helper()
	st := newTestStore(t)
	const email = "geo-rate-limit-test@example.com"
	const password = "supersecret123"

	auth := adminauth.New(st, false)
	if _, err := auth.Bootstrap(email, password); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}

	h := NewHandler(auth, st)
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookie jar: %v", err)
	}
	client := &http.Client{Jar: jar}
	resp, err := client.Post(srv.URL+"/admin/api/login", "application/json",
		strings.NewReader(`{"email":"`+email+`","password":"`+password+`"}`))
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login = %d, want 200", resp.StatusCode)
	}
	return client, srv.URL
}

func TestGeoRateLimits_UnauthenticatedRequestsAreRejected(t *testing.T) {
	st := newTestStore(t)
	auth := adminauth.New(st, false)
	h := NewHandler(auth, st)
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	if resp, err := http.Get(srv.URL + "/admin/api/geo-rate-limits"); err != nil {
		t.Fatalf("unauth GET: %v", err)
	} else {
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("unauth GET /admin/api/geo-rate-limits = %d, want 401", resp.StatusCode)
		}
	}

	req, err := http.NewRequest(http.MethodPut, srv.URL+"/admin/api/geo-rate-limits",
		strings.NewReader(`{"endpoint":"places.get","windowSec":10,"maxCalls":1,"dailyMax":0}`))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if resp, err := http.DefaultClient.Do(req); err != nil {
		t.Fatalf("unauth PUT: %v", err)
	} else {
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("unauth PUT /admin/api/geo-rate-limits = %d, want 401", resp.StatusCode)
		}
	}
}

func TestGeoRateLimits_ListIsEmptyBeforeAnyUpsert(t *testing.T) {
	client, baseURL := newAuthedGeoRateLimitTestClient(t)

	resp, err := client.Get(baseURL + "/admin/api/geo-rate-limits")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /admin/api/geo-rate-limits = %d, want 200", resp.StatusCode)
	}
	var got geoRateLimitsResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Limits) != 0 {
		t.Fatalf("expected empty limits before any PUT, got %+v", got.Limits)
	}
}

func TestGeoRateLimits_PutThenGetRoundTrips(t *testing.T) {
	client, baseURL := newAuthedGeoRateLimitTestClient(t)

	body := `{"endpoint":"places.photoMedia","windowSec":5,"maxCalls":1,"dailyMax":100}`
	req, err := http.NewRequest(http.MethodPut, baseURL+"/admin/api/geo-rate-limits", strings.NewReader(body))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	putResp, err := client.Do(req)
	if err != nil {
		t.Fatalf("PUT: %v", err)
	}
	defer putResp.Body.Close()
	if putResp.StatusCode != http.StatusOK {
		t.Fatalf("PUT /admin/api/geo-rate-limits = %d, want 200", putResp.StatusCode)
	}

	getResp, err := client.Get(baseURL + "/admin/api/geo-rate-limits")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer getResp.Body.Close()
	var got geoRateLimitsResponse
	if err := json.NewDecoder(getResp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Limits) != 1 {
		t.Fatalf("expected 1 limit after PUT, got %+v", got.Limits)
	}
	limit := got.Limits[0]
	if limit.Endpoint != "places.photoMedia" || limit.WindowSec != 5 || limit.MaxCalls != 1 || limit.DailyMax != 100 {
		t.Fatalf("unexpected limit after round trip: %+v", limit)
	}
}

func TestGeoRateLimits_PutRejectsNonPositiveWindowOrMaxCalls(t *testing.T) {
	client, baseURL := newAuthedGeoRateLimitTestClient(t)

	cases := []string{
		`{"endpoint":"places.get","windowSec":0,"maxCalls":1,"dailyMax":0}`,
		`{"endpoint":"places.get","windowSec":10,"maxCalls":0,"dailyMax":0}`,
		`{"endpoint":"","windowSec":10,"maxCalls":1,"dailyMax":0}`,
	}
	for _, body := range cases {
		req, err := http.NewRequest(http.MethodPut, baseURL+"/admin/api/geo-rate-limits", strings.NewReader(body))
		if err != nil {
			t.Fatalf("new request: %v", err)
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("PUT: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("PUT %s = %d, want 400", body, resp.StatusCode)
		}
	}
}
