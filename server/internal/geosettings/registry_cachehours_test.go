package geosettings

import "testing"

// ===== placeDetailsCacheHours:地點詳情快取有效期(小時)=====
//
// 統一的地點詳情快取(internal/geo 的 DetailsCacheMaxAge)命中時直接回快取、
// 不打 Google。預設 24 小時,對齊地圖版原本的文字新鮮度規則。

func TestPlaceDetailsCacheHoursIsRegisteredWithDefault24(t *testing.T) {
	s := Find(KeyPlaceDetailsCacheHours)
	if s == nil {
		t.Fatalf("登錄表缺少 %q", KeyPlaceDetailsCacheHours)
	}
	if s.Default != 24 {
		t.Errorf("預設應為 24 小時,實際 %d", s.Default)
	}
}

func TestPlaceDetailsCacheHoursValidation(t *testing.T) {
	s := Find(KeyPlaceDetailsCacheHours)
	if s == nil {
		t.Fatalf("登錄表缺少 %q", KeyPlaceDetailsCacheHours)
	}
	// 0 與負數會讓所有快取立刻過期(等於把快取關掉卻看起來像有開);過大的值
	// 會讓地點資料長期不更新。
	for _, bad := range []int{0, -1, -24, 100000} {
		if err := s.Validate(bad); err == nil {
			t.Errorf("Validate(%d) 應該被拒絕", bad)
		}
	}
	for _, ok := range []int{1, 6, 24, 72, s.Max} {
		if err := s.Validate(ok); err != nil {
			t.Errorf("Validate(%d) 應該通過,實際錯誤: %v", ok, err)
		}
	}
}

func TestRegistryThreeSettingsAreDistinct(t *testing.T) {
	keys := map[string]bool{}
	for _, s := range Registry {
		if keys[s.Key] {
			t.Errorf("key 重複: %s", s.Key)
		}
		keys[s.Key] = true
	}
	for _, k := range []string{KeyPhotoMaxCount, KeyPhotoExpiryDays, KeyPlaceDetailsCacheHours} {
		if !keys[k] {
			t.Errorf("登錄表缺少 %s", k)
		}
	}
}
