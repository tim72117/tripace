package api

// 第三項設定 placeDetailsCacheHours(地點詳情快取有效期,預設 24 小時)的維運
// 端點測試。先隔離(列表預設 / 合法寫入並套用到 geo 層 / 非法輸入),再合併
// (三項設定彼此獨立)。共用 maintenance_geo_settings_test.go 的 fixture。
import (
	"net/http"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/geo"
)

const placeDetailsCachePath = "/internal/maintenance/geo-settings/placeDetailsCacheHours"

func TestGeoSettings_Isolated_PlaceDetailsCacheHours_ListShowsDefault24(t *testing.T) {
	f := newGeoSettingsFixture(t)
	_, resp := f.do(t, http.MethodGet, geoSettingsPath, f.adminToken, "")
	s := settingByKey(t, resp, "placeDetailsCacheHours")
	if s["default"] != float64(24) || s["value"] != float64(24) || s["configured"] != false {
		t.Errorf("預設應為 default=24 value=24 configured=false,實際 %v", s)
	}
}

func TestGeoSettings_Isolated_PlaceDetailsCacheHours_ValidSetIsPersistedAndAppliedToGeoLayer(t *testing.T) {
	f := newGeoSettingsFixture(t)
	t.Cleanup(func() { geo.SetDetailsCacheMaxAge(24 * time.Hour) })

	code, resp := f.do(t, http.MethodPatch, placeDetailsCachePath, f.adminToken, `{"value":48}`)
	if code != http.StatusOK {
		t.Fatalf("合法寫入應 200,實際 %d (%v)", code, resp)
	}
	rows, _ := f.server.store.ListGeoSettings()
	if len(rows) != 1 || rows[0].Key != "placeDetailsCacheHours" || rows[0].Value != 48 {
		t.Fatalf("資料庫應有 placeDetailsCacheHours=48,實際 %+v", rows)
	}
	if got := geo.DetailsCacheMaxAge(); got != 48*time.Hour {
		t.Errorf("PATCH 後 geo 層的快取有效期應立即是 48 小時,實際 %v", got)
	}
}

func TestGeoSettings_Isolated_PlaceDetailsCacheHours_InvalidRejectedWithoutSideEffects(t *testing.T) {
	for _, body := range []string{`{"value":0}`, `{"value":-5}`, `{"value":100000}`, `{"value":"x"}`, `{}`} {
		f := newGeoSettingsFixture(t)
		t.Cleanup(func() { geo.SetDetailsCacheMaxAge(24 * time.Hour) })
		if code, _ := f.do(t, http.MethodPatch, placeDetailsCachePath, f.adminToken, body); code != http.StatusBadRequest {
			t.Errorf("%s 應 400,實際 %d", body, code)
		}
		if got := geo.DetailsCacheMaxAge(); got != 24*time.Hour {
			t.Errorf("%s 被拒絕後有效期不該改變,實際 %v", body, got)
		}
		if rows, _ := f.server.store.ListGeoSettings(); len(rows) != 0 {
			t.Errorf("%s 被拒絕後不該寫資料庫,實際 %+v", body, rows)
		}
	}
}

// 合併:三項設定一起設定,彼此獨立。
func TestGeoSettings_Combined_AllThreeSettingsAreIndependent(t *testing.T) {
	f := newGeoSettingsFixture(t)
	t.Cleanup(func() { geo.SetDetailsCacheMaxAge(24 * time.Hour) })

	for _, step := range []struct{ path, body string }{
		{photoMaxCountPath, `{"value":5}`},
		{photoExpiryPath, `{"value":14}`},
		{placeDetailsCachePath, `{"value":72}`},
	} {
		if code, _ := f.do(t, http.MethodPatch, step.path, f.adminToken, step.body); code != http.StatusOK {
			t.Fatalf("%s 設定失敗: %d", step.path, code)
		}
	}

	_, resp := f.do(t, http.MethodGet, geoSettingsPath, f.adminToken, "")
	want := map[string]float64{"photoMaxCount": 5, "photoExpiryDays": 14, "placeDetailsCacheHours": 72}
	for key, v := range want {
		s := settingByKey(t, resp, key)
		if s["value"] != v || s["configured"] != true {
			t.Errorf("%s 應為 %v 且已自訂,實際 %v", key, v, s)
		}
	}
	if f.server.PhotoMaxCount() != 5 || f.server.PhotoExpiryDays() != 14 || f.server.PlaceDetailsCacheHours() != 72 {
		t.Errorf("執行中的 server 應為 (5,14,72),實際 (%d,%d,%d)",
			f.server.PhotoMaxCount(), f.server.PhotoExpiryDays(), f.server.PlaceDetailsCacheHours())
	}

	// 其中一項被拒絕,另外兩項不受影響
	if code, _ := f.do(t, http.MethodPatch, placeDetailsCachePath, f.adminToken, `{"value":0}`); code != http.StatusBadRequest {
		t.Fatalf("value=0 應被拒絕,實際 %d", code)
	}
	if f.server.PhotoMaxCount() != 5 || f.server.PhotoExpiryDays() != 14 || f.server.PlaceDetailsCacheHours() != 72 {
		t.Errorf("被拒絕的寫入之後三項都該維持 (5,14,72)")
	}
}
