package api

// maintenance_geo_settings_test.go 測維運端點:
//
//	GET   /internal/maintenance/geo-settings          列出可調整的數值設定
//	PATCH /internal/maintenance/geo-settings/{key}    修改一項(body: {"value": N})
//
// 目前只有一項設定:photoMaxCount(照片最大張數,預設 3)。
//
// 測試結構(使用者要求「各個參數都先隔離測試,然後再合併測試」):
//
//	隔離:權限 / 列表預設值 / 合法寫入 / 各種非法輸入 / 即時生效,各自一個測試
//	合併:寫入 → 列表 → 再寫入 → 被拒絕的寫入不影響目前值,串成一條流程
import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

const testAdminEmail = "admin@example.com"

type geoSettingsFixture struct {
	server     *Server
	routes     http.Handler
	adminToken string
	userToken  string
}

func newGeoSettingsFixture(t *testing.T) *geoSettingsFixture {
	t.Helper()
	s := newTestServerWithFakePlaceDetailsGeoGeocodeClient(t, &fakePlaceDetailsGateway{})
	s.adminBootstrapEmail = testAdminEmail

	admin, err := s.store.CreatePasswordUser("usr_geo_set_admin", "管理員", "#8C7B6A", testAdminEmail, "hash")
	if err != nil {
		t.Fatalf("建立管理員: %v", err)
	}
	user, err := s.store.CreatePasswordUser("usr_geo_set_user", "一般使用者", "#8C7B6A", "user@example.com", "hash")
	if err != nil {
		t.Fatalf("建立一般使用者: %v", err)
	}
	adminToken, err := s.signer.Sign(admin.ID, admin.Name)
	if err != nil {
		t.Fatalf("簽管理員 token: %v", err)
	}
	userToken, err := s.signer.Sign(user.ID, user.Name)
	if err != nil {
		t.Fatalf("簽使用者 token: %v", err)
	}
	return &geoSettingsFixture{server: s, routes: s.Routes(), adminToken: adminToken, userToken: userToken}
}

func (f *geoSettingsFixture) do(t *testing.T, method, path, token, rawBody string) (int, map[string]any) {
	t.Helper()
	var body *bytes.Reader
	if rawBody != "" {
		body = bytes.NewReader([]byte(rawBody))
	} else {
		body = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, body)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if rawBody != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	f.routes.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

const (
	geoSettingsPath    = "/internal/maintenance/geo-settings"
	photoMaxCountPath  = "/internal/maintenance/geo-settings/photoMaxCount"
	unknownSettingPath = "/internal/maintenance/geo-settings/noSuchSetting"
	photoExpiryPath    = "/internal/maintenance/geo-settings/photoExpiryDays"
)

// settingByKey 從列表回應取出指定 key 那一項。
func settingByKey(t *testing.T, resp map[string]any, key string) map[string]any {
	t.Helper()
	list, ok := resp["settings"].([]any)
	if !ok {
		t.Fatalf("回應缺少 settings 陣列: %v", resp)
	}
	for _, it := range list {
		m, _ := it.(map[string]any)
		if m["key"] == key {
			return m
		}
	}
	t.Fatalf("列表裡找不到 %s: %v", key, resp)
	return nil
}

// photoSetting 從列表回應取出 photoMaxCount 那一項。
func photoSetting(t *testing.T, resp map[string]any) map[string]any {
	t.Helper()
	return settingByKey(t, resp, "photoMaxCount")
}

// ===== 隔離:權限 =====

func TestGeoSettings_Isolated_UnauthenticatedIsRejected(t *testing.T) {
	f := newGeoSettingsFixture(t)
	if code, _ := f.do(t, http.MethodGet, geoSettingsPath, "", ""); code != http.StatusUnauthorized {
		t.Errorf("未登入 GET 應 401,實際 %d", code)
	}
	if code, _ := f.do(t, http.MethodPatch, photoMaxCountPath, "", `{"value":5}`); code != http.StatusUnauthorized {
		t.Errorf("未登入 PATCH 應 401,實際 %d", code)
	}
}

// 任何登入使用者都過得了 internalAuth,所以這兩支必須自己判斷管理員——
// 否則一般使用者就能調整成本相關設定(同 requireRateLimitAdmin 補上的那個缺口)。
func TestGeoSettings_Isolated_NonAdminIsForbidden(t *testing.T) {
	f := newGeoSettingsFixture(t)
	if code, _ := f.do(t, http.MethodGet, geoSettingsPath, f.userToken, ""); code != http.StatusForbidden {
		t.Errorf("一般使用者 GET 應 403,實際 %d", code)
	}
	if code, _ := f.do(t, http.MethodPatch, photoMaxCountPath, f.userToken, `{"value":9}`); code != http.StatusForbidden {
		t.Errorf("一般使用者 PATCH 應 403,實際 %d", code)
	}
	// 被拒絕的寫入不能有任何副作用。
	if got := f.server.PhotoMaxCount(); got != 3 {
		t.Errorf("被拒絕的 PATCH 不該改變執行中的設定,目前 %d", got)
	}
	if rows, _ := f.server.store.ListGeoSettings(); len(rows) != 0 {
		t.Errorf("被拒絕的 PATCH 不該寫入資料庫,實際 %+v", rows)
	}
}

func TestGeoSettings_Isolated_AdminIsAllowed(t *testing.T) {
	f := newGeoSettingsFixture(t)
	if code, _ := f.do(t, http.MethodGet, geoSettingsPath, f.adminToken, ""); code != http.StatusOK {
		t.Errorf("管理員 GET 應 200,實際 %d", code)
	}
}

// ===== 隔離:列表 =====

func TestGeoSettings_Isolated_ListShowsDefaultsBeforeAnyChange(t *testing.T) {
	f := newGeoSettingsFixture(t)
	_, resp := f.do(t, http.MethodGet, geoSettingsPath, f.adminToken, "")
	s := photoSetting(t, resp)

	if s["default"] != float64(3) {
		t.Errorf("default 應為 3,實際 %v", s["default"])
	}
	if s["value"] != float64(3) {
		t.Errorf("尚未設定時目前值應等於預設 3,實際 %v", s["value"])
	}
	if s["configured"] != false {
		t.Errorf("尚未設定時 configured 應為 false,實際 %v", s["configured"])
	}
	if s["desc"] == "" || s["desc"] == nil {
		t.Error("列表要附說明,運維才知道這個值在管什麼")
	}
	if _, ok := s["min"]; !ok {
		t.Error("列表要附合法範圍 min")
	}
	if _, ok := s["max"]; !ok {
		t.Error("列表要附合法範圍 max")
	}
	if _, ok := resp["appliesWithinSec"]; !ok {
		t.Error("要告訴運維多久內生效(appliesWithinSec)")
	}
}

// ===== 隔離:合法寫入 =====

func TestGeoSettings_Isolated_ValidSetIsPersisted(t *testing.T) {
	f := newGeoSettingsFixture(t)
	code, resp := f.do(t, http.MethodPatch, photoMaxCountPath, f.adminToken, `{"value":5}`)
	if code != http.StatusOK {
		t.Fatalf("合法寫入應 200,實際 %d (%v)", code, resp)
	}
	rows, err := f.server.store.ListGeoSettings()
	if err != nil || len(rows) != 1 || rows[0].Key != "photoMaxCount" || rows[0].Value != 5 {
		t.Fatalf("資料庫應有 photoMaxCount=5,實際 %+v err=%v", rows, err)
	}
}

// 寫入後立即套用到執行中的 server,不必等背景重讀(跟既有限流設定「45 秒內
// 生效」不同:這個值只影響這個 server 實例的判斷,直接設就好)。
func TestGeoSettings_Isolated_SetTakesEffectImmediatelyOnRunningServer(t *testing.T) {
	f := newGeoSettingsFixture(t)
	f.do(t, http.MethodPatch, photoMaxCountPath, f.adminToken, `{"value":5}`)
	if got := f.server.PhotoMaxCount(); got != 5 {
		t.Errorf("PATCH 後執行中的 server 應立即是 5,實際 %d", got)
	}
}

// ===== 隔離:非法輸入(每一種各自測,並確認沒有副作用)=====

func TestGeoSettings_Isolated_InvalidInputsAreRejectedWithoutSideEffects(t *testing.T) {
	cases := []struct {
		name string
		path string
		body string
	}{
		{"value 為 0(會關掉所有補圖)", photoMaxCountPath, `{"value":0}`},
		{"value 為負數", photoMaxCountPath, `{"value":-1}`},
		{"value 過大", photoMaxCountPath, `{"value":1000000}`},
		{"缺少 value", photoMaxCountPath, `{}`},
		{"value 不是數字", photoMaxCountPath, `{"value":"abc"}`},
		{"value 是小數", photoMaxCountPath, `{"value":2.5}`},
		{"不是合法 JSON", photoMaxCountPath, `not-json`},
		{"不存在的設定 key", unknownSettingPath, `{"value":3}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newGeoSettingsFixture(t)
			code, _ := f.do(t, http.MethodPatch, tc.path, f.adminToken, tc.body)
			if code != http.StatusBadRequest {
				t.Errorf("應 400,實際 %d", code)
			}
			if got := f.server.PhotoMaxCount(); got != 3 {
				t.Errorf("被拒絕的寫入不該改變執行中的設定,目前 %d", got)
			}
			if rows, _ := f.server.store.ListGeoSettings(); len(rows) != 0 {
				t.Errorf("被拒絕的寫入不該寫入資料庫,實際 %+v", rows)
			}
		})
	}
}

// ===== 合併:一條完整流程 =====

func TestGeoSettings_Combined_SetListSetAgainAndRejectedSetKeepsCurrent(t *testing.T) {
	f := newGeoSettingsFixture(t)

	// 1. 寫入 5 → 列表顯示 5、已自訂、預設值仍是 3
	if code, _ := f.do(t, http.MethodPatch, photoMaxCountPath, f.adminToken, `{"value":5}`); code != http.StatusOK {
		t.Fatalf("第一次寫入失敗: %d", code)
	}
	_, resp := f.do(t, http.MethodGet, geoSettingsPath, f.adminToken, "")
	s := photoSetting(t, resp)
	if s["value"] != float64(5) || s["configured"] != true || s["default"] != float64(3) {
		t.Fatalf("寫入 5 之後列表應為 value=5 configured=true default=3,實際 %v", s)
	}
	if f.server.PhotoMaxCount() != 5 {
		t.Fatalf("執行中的 server 應是 5,實際 %d", f.server.PhotoMaxCount())
	}

	// 2. 再寫入 2 → 覆蓋成 2,資料庫只有一列
	if code, _ := f.do(t, http.MethodPatch, photoMaxCountPath, f.adminToken, `{"value":2}`); code != http.StatusOK {
		t.Fatalf("第二次寫入失敗: %d", code)
	}
	if rows, _ := f.server.store.ListGeoSettings(); len(rows) != 1 || rows[0].Value != 2 {
		t.Fatalf("應覆蓋成單一列 value=2,實際 %+v", rows)
	}
	if f.server.PhotoMaxCount() != 2 {
		t.Fatalf("執行中的 server 應是 2,實際 %d", f.server.PhotoMaxCount())
	}

	// 3. 非法寫入被拒絕,目前值(2)維持不變
	if code, _ := f.do(t, http.MethodPatch, photoMaxCountPath, f.adminToken, `{"value":0}`); code != http.StatusBadRequest {
		t.Fatalf("value=0 應被拒絕,實際 %d", code)
	}
	_, resp = f.do(t, http.MethodGet, geoSettingsPath, f.adminToken, "")
	if s := photoSetting(t, resp); s["value"] != float64(2) {
		t.Errorf("被拒絕的寫入之後目前值應維持 2,實際 %v", s["value"])
	}
	if f.server.PhotoMaxCount() != 2 {
		t.Errorf("被拒絕的寫入之後執行中的 server 應維持 2,實際 %d", f.server.PhotoMaxCount())
	}
}

// ===== 第二項設定:photoExpiryDays(照片過期週期,預設 7 天)=====
//
// 同樣先隔離(列表預設 / 合法寫入 / 即時生效 / 非法輸入),再合併(兩項設定
// 彼此獨立)。

func TestGeoSettings_Isolated_PhotoExpiryDays_ListShowsDefaultSeven(t *testing.T) {
	f := newGeoSettingsFixture(t)
	_, resp := f.do(t, http.MethodGet, geoSettingsPath, f.adminToken, "")
	s := settingByKey(t, resp, "photoExpiryDays")
	if s["default"] != float64(7) || s["value"] != float64(7) || s["configured"] != false {
		t.Errorf("預設應為 default=7 value=7 configured=false,實際 %v", s)
	}
}

func TestGeoSettings_Isolated_PhotoExpiryDays_ValidSetIsPersistedAndApplied(t *testing.T) {
	f := newGeoSettingsFixture(t)
	code, resp := f.do(t, http.MethodPatch, photoExpiryPath, f.adminToken, `{"value":14}`)
	if code != http.StatusOK {
		t.Fatalf("合法寫入應 200,實際 %d (%v)", code, resp)
	}
	rows, _ := f.server.store.ListGeoSettings()
	if len(rows) != 1 || rows[0].Key != "photoExpiryDays" || rows[0].Value != 14 {
		t.Fatalf("資料庫應有 photoExpiryDays=14,實際 %+v", rows)
	}
	if got := f.server.PhotoExpiryDays(); got != 14 {
		t.Errorf("PATCH 後執行中的 server 應立即是 14,實際 %d", got)
	}
}

func TestGeoSettings_Isolated_PhotoExpiryDays_InvalidInputsRejectedWithoutSideEffects(t *testing.T) {
	cases := []struct{ name, body string }{
		{"0(照片一寫入就過期)", `{"value":0}`},
		{"負數", `{"value":-3}`},
		{"超過上限", `{"value":365}`},
		{"不是數字", `{"value":"x"}`},
		{"缺少 value", `{}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newGeoSettingsFixture(t)
			if code, _ := f.do(t, http.MethodPatch, photoExpiryPath, f.adminToken, tc.body); code != http.StatusBadRequest {
				t.Errorf("應 400,實際 %d", code)
			}
			if got := f.server.PhotoExpiryDays(); got != 7 {
				t.Errorf("被拒絕的寫入不該改變執行中的設定,目前 %d", got)
			}
			if rows, _ := f.server.store.ListGeoSettings(); len(rows) != 0 {
				t.Errorf("被拒絕的寫入不該寫入資料庫,實際 %+v", rows)
			}
		})
	}
}

func TestGeoSettings_Isolated_PhotoExpiryDays_NonAdminIsForbidden(t *testing.T) {
	f := newGeoSettingsFixture(t)
	if code, _ := f.do(t, http.MethodPatch, photoExpiryPath, f.userToken, `{"value":2}`); code != http.StatusForbidden {
		t.Errorf("一般使用者 PATCH 應 403,實際 %d", code)
	}
	if got := f.server.PhotoExpiryDays(); got != 7 {
		t.Errorf("被拒絕的 PATCH 不該改變設定,目前 %d", got)
	}
}

// 合併:兩項設定一起存在時彼此獨立——設定其中一項不會動到另一項的值、
// 資料庫列與執行中的狀態。
func TestGeoSettings_Combined_BothSettingsAreIndependent(t *testing.T) {
	f := newGeoSettingsFixture(t)

	if code, _ := f.do(t, http.MethodPatch, photoMaxCountPath, f.adminToken, `{"value":5}`); code != http.StatusOK {
		t.Fatalf("設定 photoMaxCount 失敗: %d", code)
	}
	// 只設了 photoMaxCount:photoExpiryDays 仍是預設
	_, resp := f.do(t, http.MethodGet, geoSettingsPath, f.adminToken, "")
	if s := settingByKey(t, resp, "photoExpiryDays"); s["value"] != float64(7) || s["configured"] != false {
		t.Fatalf("設定 photoMaxCount 不該影響 photoExpiryDays,實際 %v", s)
	}

	if code, _ := f.do(t, http.MethodPatch, photoExpiryPath, f.adminToken, `{"value":2}`); code != http.StatusOK {
		t.Fatalf("設定 photoExpiryDays 失敗: %d", code)
	}
	_, resp = f.do(t, http.MethodGet, geoSettingsPath, f.adminToken, "")
	if s := photoSetting(t, resp); s["value"] != float64(5) || s["configured"] != true {
		t.Errorf("設定 photoExpiryDays 不該動到 photoMaxCount,實際 %v", s)
	}
	if s := settingByKey(t, resp, "photoExpiryDays"); s["value"] != float64(2) || s["configured"] != true {
		t.Errorf("photoExpiryDays 應為 2,實際 %v", s)
	}
	if f.server.PhotoMaxCount() != 5 || f.server.PhotoExpiryDays() != 2 {
		t.Errorf("執行中的 server 應為 (5,2),實際 (%d,%d)", f.server.PhotoMaxCount(), f.server.PhotoExpiryDays())
	}
	if rows, _ := f.server.store.ListGeoSettings(); len(rows) != 2 {
		t.Errorf("資料庫應有兩列,實際 %+v", rows)
	}

	// 其中一項被拒絕,另一項不受影響
	if code, _ := f.do(t, http.MethodPatch, photoExpiryPath, f.adminToken, `{"value":0}`); code != http.StatusBadRequest {
		t.Fatalf("value=0 應被拒絕,實際 %d", code)
	}
	if f.server.PhotoMaxCount() != 5 || f.server.PhotoExpiryDays() != 2 {
		t.Errorf("被拒絕的寫入之後兩項都該維持 (5,2),實際 (%d,%d)", f.server.PhotoMaxCount(), f.server.PhotoExpiryDays())
	}
}
