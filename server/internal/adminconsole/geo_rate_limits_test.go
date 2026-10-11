package adminconsole

// geo_rate_limits_test.go 測 GET/PUT /admin/api/geo-rate-limits(見
// listGeoRateLimits/updateGeoRateLimit 的完整說明)。跟其餘 adminconsole
// 測試共用同一套「開一個真的 httptest.Server + 用一般使用者 JWT(email 在
// 白名單)當管理員」的測試手法。
import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newAuthedGeoRateLimitTestClient 開一支測試 server、建立一個 email 在白
// 名單裡的使用者並簽發對應 JWT,回傳一個會自動帶上 Authorization header
// 的 http.Client 與 server URL——供本檔案每個測試各自呼叫,避免重複這段
// 固定的樣板。
func newAuthedGeoRateLimitTestClient(t *testing.T) (*http.Client, string) {
	t.Helper()
	st := newTestStore(t)
	const email = "geo-rate-limit-test@example.com"
	signer := testSigner()
	token := newAdminTestUser(t, st, signer, email)

	h := NewHandler(signer, st, email)
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	client := &http.Client{Transport: bearerTransport{token: token, base: http.DefaultTransport}}
	return client, srv.URL
}

// bearerTransport 在每個請求自動加上 Authorization: Bearer <token>——取代
// 原本依賴 cookie jar 自動夾帶 session cookie 的測試手法,改成 JWT 架構下
// 的等價做法。
type bearerTransport struct {
	token string
	base  http.RoundTripper
}

func (t bearerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.Header.Set("Authorization", "Bearer "+t.token)
	return t.base.RoundTrip(req)
}

func TestGeoRateLimits_UnauthenticatedRequestsAreRejected(t *testing.T) {
	st := newTestStore(t)
	signer := testSigner()
	h := NewHandler(signer, st, "admin@example.com")
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
