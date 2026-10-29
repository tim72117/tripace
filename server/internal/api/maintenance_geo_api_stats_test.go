package api

import (
	"net/http"
	"testing"
)

func TestGeoAPIStatsEndpoint(t *testing.T) {
	f := newGeoSettingsFixture(t)
	const path = "/internal/maintenance/geo-api-stats"

	if code, _ := f.do(t, http.MethodGet, path, "", ""); code != http.StatusUnauthorized {
		t.Errorf("未登入應 401,實際 %d", code)
	}
	if code, _ := f.do(t, http.MethodGet, path, f.userToken, ""); code != http.StatusForbidden {
		t.Errorf("一般使用者應 403,實際 %d", code)
	}

	// 寫兩筆今天的呼叫(LogGeoAPICall 用 store 的 now())。
	if err := f.server.store.LogGeoAPICall("places.get", "c", "/p", 200, 5, false); err != nil {
		t.Fatal(err)
	}
	if err := f.server.store.LogGeoAPICall("places.get", "c", "/p", 429, 5, false); err != nil {
		t.Fatal(err)
	}

	for _, o := range []string{"hit", "hit", "hit", "miss"} {
		if err := f.server.store.LogGeoCache("place_details", o, "c", "/p", "pl1"); err != nil {
			t.Fatal(err)
		}
	}

	code, resp := f.do(t, http.MethodGet, path+"?tz=UTC", f.adminToken, "")
	if code != http.StatusOK {
		t.Fatalf("管理員應 200,實際 %d: %v", code, resp)
	}
	totals, _ := resp["totals"].([]any)
	if len(totals) != 1 {
		t.Fatalf("totals = %v", resp["totals"])
	}
	tot := totals[0].(map[string]any)
	if tot["endpoint"] != "places.get" || tot["count"] != float64(2) || tot["errorCount"] != float64(1) {
		t.Fatalf("合計不對: %v", tot)
	}
	cache, _ := resp["cache"].(map[string]any)
	ct, _ := cache["totals"].(map[string]any)
	if ct["hit"] != float64(3) || ct["miss"] != float64(1) || ct["shared"] != float64(0) || cache["hitRate"] != 0.75 {
		t.Fatalf("快取統計不對: %v", cache)
	}
	if resp["period"] != "day" || resp["tz"] != "UTC" {
		t.Fatalf("預設值不對: %v", resp)
	}

	for name, q := range map[string]string{
		"bad period":    "?period=week",
		"bad tz":        "?tz=Mars/Base",
		"bad from":      "?from=10-20",
		"from after to": "?from=2026-10-28&to=2026-10-20",
		"day too long":  "?from=2026-01-01&to=2026-10-20",
		"hour too long": "?period=hour&from=2026-10-01&to=2026-10-20",
	} {
		if code, _ := f.do(t, http.MethodGet, path+q, f.adminToken, ""); code != http.StatusBadRequest {
			t.Errorf("%s 應 400,實際 %d", name, code)
		}
	}
}
