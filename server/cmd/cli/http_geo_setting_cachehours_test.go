package main

import "testing"

// 第三項設定走同一組泛用端點,只是 key 不同(key 是路徑的一部分)。
func TestHTTPClientGeoSettingSet_Isolated_PlaceDetailsCacheHoursKey(t *testing.T) {
	srv, got := newFakeServer(t)
	withToken(t, srv.URL, "tok_test")

	if _, err := newHTTPClient(srv.URL).geoSettingSet("placeDetailsCacheHours", 48); err != nil {
		t.Fatalf("geoSettingSet: %v", err)
	}
	assertReq(t, got, "PATCH", "/internal/maintenance/geo-settings/placeDetailsCacheHours")
	if got.body["value"] != float64(48) {
		t.Errorf("value 應為 48,實際 %v", got.body["value"])
	}
}
