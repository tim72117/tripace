package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// http_geo_setting_test.go 測 CLI 的 geo-setting 子命令底層的 HTTP 呼叫:
//
//	tripace-cli geo-setting list [-json]
//	tripace-cli geo-setting set -key KEY -value N
//
// 對應後端 GET /internal/maintenance/geo-settings 與
// PATCH /internal/maintenance/geo-settings/{key}(見
// server/internal/api/maintenance_geo_settings_test.go)。
//
// 既有的 cmd* 函式吃具體的 *httpClient 且失敗走 fatal(直接結束程序),
// 沒辦法在測試裡呼叫,所以跟其他子命令一樣只測 httpClient 方法本身——
// 驗證「打到哪個路徑、帶什麼 body、有沒有帶 token」。
//
// 結構:隔離(list / set 的路徑 / body / 權杖 / 數值型別 / 路徑跳脫)各自
// 一個測試,最後合併。

func TestHTTPClientGeoSettingList_Isolated_PathAndMethod(t *testing.T) {
	srv, got := newFakeServer(t)
	withToken(t, srv.URL, "tok_test")

	if _, err := newHTTPClient(srv.URL).geoSettingList(); err != nil {
		t.Fatalf("geoSettingList: %v", err)
	}
	assertReq(t, got, "GET", "/internal/maintenance/geo-settings")
}

func TestHTTPClientGeoSettingList_Isolated_SendsNoBody(t *testing.T) {
	srv, got := newFakeServer(t)
	withToken(t, srv.URL, "tok_test")

	_, _ = newHTTPClient(srv.URL).geoSettingList()
	if len(got.body) != 0 {
		t.Errorf("list 不該帶 body,實際 %v", got.body)
	}
}

func TestHTTPClientGeoSettingSet_Isolated_PathAndMethod(t *testing.T) {
	srv, got := newFakeServer(t)
	withToken(t, srv.URL, "tok_test")

	if _, err := newHTTPClient(srv.URL).geoSettingSet("photoMaxCount", 5); err != nil {
		t.Fatalf("geoSettingSet: %v", err)
	}
	assertReq(t, got, "PATCH", "/internal/maintenance/geo-settings/photoMaxCount")
}

func TestHTTPClientGeoSettingSet_Isolated_BodyCarriesValue(t *testing.T) {
	srv, got := newFakeServer(t)
	withToken(t, srv.URL, "tok_test")

	_, _ = newHTTPClient(srv.URL).geoSettingSet("photoMaxCount", 5)
	v, ok := got.body["value"]
	if !ok {
		t.Fatalf("body 缺少 value 欄位: %v", got.body)
	}
	if v != float64(5) { // JSON 數字解碼成 float64
		t.Errorf("value 應為數字 5,實際 %v (%T)", v, v)
	}
	if len(got.body) != 1 {
		t.Errorf("body 應只有 value 一個欄位,實際 %v", got.body)
	}
}

// 0 與負數必須原樣送給後端(由後端統一驗證、回精準的錯誤訊息),CLI 端
// 不該自己吞掉或改值——同限流 CLI 把哨兵值換成 flag.Visit 的同一個教訓。
func TestHTTPClientGeoSettingSet_Isolated_ForwardsInvalidValuesUntouched(t *testing.T) {
	for _, v := range []int{0, -1, 1000000} {
		srv, got := newFakeServer(t)
		withToken(t, srv.URL, "tok_test")
		_, _ = newHTTPClient(srv.URL).geoSettingSet("photoMaxCount", v)
		if got.body["value"] != float64(v) {
			t.Errorf("value=%d 應原樣送出,實際 %v", v, got.body["value"])
		}
	}
}

func TestHTTPClientGeoSettingSet_Isolated_EscapesKeyInPath(t *testing.T) {
	// newFakeServer 記錄的是 server 解碼後的 r.URL.Path,看不出 client 有沒有跳脫,
	// 所以這裡自己起一個 server 記錄原始請求 URI。
	var rawURI string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rawURI = r.RequestURI
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(srv.Close)
	withToken(t, srv.URL, "tok_test")

	_, _ = newHTTPClient(srv.URL).geoSettingSet("a/b c", 1)

	// 路徑裡的 key 要跳脫,不能讓使用者輸入的斜線改變路由。
	want := "/internal/maintenance/geo-settings/a%2Fb%20c"
	if rawURI != want {
		t.Errorf("key 應被跳脫成 %s,實際 %s", want, rawURI)
	}
}

// 合併:同一個 client 先列表再設定,兩次呼叫都帶權杖、路徑各自正確。
func TestHTTPClientGeoSetting_Combined_ListThenSet(t *testing.T) {
	srv, got := newFakeServer(t)
	withToken(t, srv.URL, "tok_test")
	c := newHTTPClient(srv.URL)

	if _, err := c.geoSettingList(); err != nil {
		t.Fatalf("geoSettingList: %v", err)
	}
	assertReq(t, got, "GET", "/internal/maintenance/geo-settings")

	if _, err := c.geoSettingSet("photoMaxCount", 2); err != nil {
		t.Fatalf("geoSettingSet: %v", err)
	}
	assertReq(t, got, "PATCH", "/internal/maintenance/geo-settings/photoMaxCount")
	if got.body["value"] != float64(2) {
		t.Errorf("set 的 body.value 應為 2,實際 %v", got.body["value"])
	}
}

// 第二項設定走同一組泛用端點,只是 key 不同(key 是路徑的一部分)。
func TestHTTPClientGeoSettingSet_Isolated_PhotoExpiryDaysKey(t *testing.T) {
	srv, got := newFakeServer(t)
	withToken(t, srv.URL, "tok_test")

	if _, err := newHTTPClient(srv.URL).geoSettingSet("photoExpiryDays", 14); err != nil {
		t.Fatalf("geoSettingSet: %v", err)
	}
	assertReq(t, got, "PATCH", "/internal/maintenance/geo-settings/photoExpiryDays")
	if got.body["value"] != float64(14) {
		t.Errorf("value 應為 14,實際 %v", got.body["value"])
	}
}
