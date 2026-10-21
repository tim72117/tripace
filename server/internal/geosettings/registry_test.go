package geosettings

import "testing"

// 登錄表是「有哪些可線上調整的數值設定、預設值與合法範圍」的唯一來源
// (跟 internal/ratelimits、internal/fieldmasks 同一個模式)。這些測試守
// 住登錄表本身的不變式——失效方式都是靜默的(預設值寫錯、範圍錯位、key
// 重複),不靠測試不會有人發現。

func TestPhotoMaxCountIsRegisteredWithDefaultThree(t *testing.T) {
	s := Find(KeyPhotoMaxCount)
	if s == nil {
		t.Fatalf("登錄表缺少 %q", KeyPhotoMaxCount)
	}
	if s.Default != 3 {
		t.Errorf("照片最大張數預設值應為 3(使用者指定),實際 %d", s.Default)
	}
}

func TestPhotoMaxCountRejectsValuesThatDisableOrBreakFilling(t *testing.T) {
	s := Find(KeyPhotoMaxCount)
	if s == nil {
		t.Fatalf("登錄表缺少 %q", KeyPhotoMaxCount)
	}
	// 0 會讓所有地點都不補圖(等於把照片功能整個關掉);負數沒有意義;
	// 過大的值等於沒有上限、失去這個設定存在的意義。
	for _, bad := range []int{0, -1, -100, 1000000} {
		if err := s.Validate(bad); err == nil {
			t.Errorf("Validate(%d) 應該被拒絕", bad)
		}
	}
	for _, ok := range []int{1, 2, 3, 5, s.Max} {
		if err := s.Validate(ok); err != nil {
			t.Errorf("Validate(%d) 應該通過,實際錯誤: %v", ok, err)
		}
	}
}

func TestFindUnknownKeyReturnsNil(t *testing.T) {
	if Find("noSuchSetting") != nil {
		t.Error("不在登錄表裡的 key 應回傳 nil")
	}
}

func TestRegistryInvariants(t *testing.T) {
	seen := map[string]bool{}
	for _, s := range Registry {
		if s.Key == "" {
			t.Error("登錄表有一筆 key 是空字串")
		}
		if seen[s.Key] {
			t.Errorf("登錄表 key 重複: %q", s.Key)
		}
		seen[s.Key] = true
		if s.Desc == "" {
			t.Errorf("%q 缺少說明(CLI 列表要印給運維看,不能沒有)", s.Key)
		}
		if s.Min > s.Max {
			t.Errorf("%q 範圍錯位: Min=%d > Max=%d", s.Key, s.Min, s.Max)
		}
		// 預設值本身必須通過自己的驗證——否則「從未設定過」就會得到一個
		// 不合法的有效值。
		if err := s.Validate(s.Default); err != nil {
			t.Errorf("%q 的預設值 %d 沒通過自己的驗證: %v", s.Key, s.Default, err)
		}
	}
}

// ===== photoExpiryDays:照片過期週期(天)=====
//
// 照片資產寫入 photo_assets 時 expires_at = 現在 + 這個天數;過期後下一次請求
// 會觸發補圖換新。原本寫死 7 天(見 internal/api 的 photoAssetExpiry)。

func TestPhotoExpiryDaysIsRegisteredWithDefaultSeven(t *testing.T) {
	s := Find(KeyPhotoExpiryDays)
	if s == nil {
		t.Fatalf("登錄表缺少 %q", KeyPhotoExpiryDays)
	}
	if s.Default != 7 {
		t.Errorf("照片過期週期預設應維持原本寫死的 7 天,實際 %d", s.Default)
	}
}

func TestPhotoExpiryDaysValidation(t *testing.T) {
	s := Find(KeyPhotoExpiryDays)
	if s == nil {
		t.Fatalf("登錄表缺少 %q", KeyPhotoExpiryDays)
	}
	// 0 與負數會讓照片一寫入就過期(每次請求都重補,成本失控);過大的值會讓
	// 照片長期不更新。
	for _, bad := range []int{0, -1, -7, 1000} {
		if err := s.Validate(bad); err == nil {
			t.Errorf("Validate(%d) 應該被拒絕", bad)
		}
	}
	for _, ok := range []int{1, 2, 7, 14, s.Max} {
		if err := s.Validate(ok); err != nil {
			t.Errorf("Validate(%d) 應該通過,實際錯誤: %v", ok, err)
		}
	}
}

// 兩項設定彼此獨立:key 不同、範圍各自、改一項不影響另一項。
func TestRegistryHasBothPhotoSettingsAsIndependentEntries(t *testing.T) {
	max, exp := Find(KeyPhotoMaxCount), Find(KeyPhotoExpiryDays)
	if max == nil || exp == nil {
		t.Fatal("登錄表應同時有 photoMaxCount 與 photoExpiryDays")
	}
	if max.Key == exp.Key {
		t.Error("兩項設定的 key 不可相同")
	}
	if max.Default == exp.Default && max.Min == exp.Min && max.Max == exp.Max {
		t.Error("兩項設定的預設與範圍完全一樣,可能是複製貼上時忘了改")
	}
}
