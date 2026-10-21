package store

import "testing"

// geo_settings 表存「可線上調整的數值設定」的自訂值(登錄表見
// internal/geosettings)。沒有資料列 = 沿用登錄表預設值,所以不需要
// seeding——這跟 geo_rate_limits/geo_field_masks 不同,刻意的:單一數值
// 沒有「多欄位要一起寫入才算完整」的問題。

func TestListGeoSettings_EmptyByDefault(t *testing.T) {
	s := OpenTest(t)
	rows, err := s.ListGeoSettings()
	if err != nil {
		t.Fatalf("ListGeoSettings: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("新資料庫不該有任何設定列,實際 %d", len(rows))
	}
}

func TestUpsertGeoSetting_RoundTrip(t *testing.T) {
	s := OpenTest(t)
	if err := s.UpsertGeoSetting("photoMaxCount", 5); err != nil {
		t.Fatalf("UpsertGeoSetting: %v", err)
	}
	rows, err := s.ListGeoSettings()
	if err != nil {
		t.Fatalf("ListGeoSettings: %v", err)
	}
	if len(rows) != 1 || rows[0].Key != "photoMaxCount" || rows[0].Value != 5 {
		t.Fatalf("期望 [photoMaxCount=5],實際 %+v", rows)
	}
}

func TestUpsertGeoSetting_OverwritesExistingKey(t *testing.T) {
	s := OpenTest(t)
	_ = s.UpsertGeoSetting("photoMaxCount", 5)
	if err := s.UpsertGeoSetting("photoMaxCount", 2); err != nil {
		t.Fatalf("UpsertGeoSetting: %v", err)
	}
	rows, _ := s.ListGeoSettings()
	if len(rows) != 1 || rows[0].Value != 2 {
		t.Fatalf("同一個 key 再寫入應覆蓋成 2,且只有一列,實際 %+v", rows)
	}
}

func TestUpsertGeoSetting_KeepsDifferentKeysIndependent(t *testing.T) {
	s := OpenTest(t)
	_ = s.UpsertGeoSetting("a", 1)
	_ = s.UpsertGeoSetting("b", 2)
	_ = s.UpsertGeoSetting("a", 9)

	got := map[string]int{}
	rows, _ := s.ListGeoSettings()
	for _, r := range rows {
		got[r.Key] = r.Value
	}
	if len(got) != 2 || got["a"] != 9 || got["b"] != 2 {
		t.Fatalf("期望 a=9 b=2,實際 %v", got)
	}
}
