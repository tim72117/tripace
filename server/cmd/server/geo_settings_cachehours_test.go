package main

import (
	"testing"

	"github.com/tim72117/tripace/internal/store"
)

// placeDetailsCacheHours(地點詳情快取有效期,預設 24 小時)的啟動載入測試。
// fakePhotoMaxCountApplier 的第三個方法見 geo_settings_test.go。

func TestApplyGeoSettings_Isolated_CacheHours_EmptyStoreAppliesDefault24(t *testing.T) {
	st := store.OpenTest(t)
	a := &fakePhotoMaxCountApplier{}
	applyGeoSettingsFromStore(st, a)
	if a.lastCacheHours() != 24 {
		t.Errorf("資料庫沒有設定時應套用預設 24,實際 %v", a.cacheCalls)
	}
}

func TestApplyGeoSettings_Isolated_CacheHours_StoredValidValueIsApplied(t *testing.T) {
	for _, v := range []int{1, 6, 48, 720} {
		st := store.OpenTest(t)
		_ = st.UpsertGeoSetting("placeDetailsCacheHours", v)
		a := &fakePhotoMaxCountApplier{}
		applyGeoSettingsFromStore(st, a)
		if a.lastCacheHours() != v {
			t.Errorf("資料庫 %d 應套用 %d,實際 %v", v, v, a.cacheCalls)
		}
	}
}

func TestApplyGeoSettings_Isolated_CacheHours_InvalidStoredValueFallsBackToDefault(t *testing.T) {
	for _, bad := range []int{0, -1, 100000} {
		st := store.OpenTest(t)
		_ = st.UpsertGeoSetting("placeDetailsCacheHours", bad)
		a := &fakePhotoMaxCountApplier{}
		applyGeoSettingsFromStore(st, a)
		if a.lastCacheHours() != 24 {
			t.Errorf("資料庫的壞值 %d 應退回預設 24,實際 %v", bad, a.cacheCalls)
		}
	}
}

// 合併:三項設定各自套用,其中一項壞掉不影響另外兩項。
func TestApplyGeoSettings_Combined_AllThreeApplyIndependently(t *testing.T) {
	st := store.OpenTest(t)
	_ = st.UpsertGeoSetting("photoMaxCount", 6)
	_ = st.UpsertGeoSetting("photoExpiryDays", 14)
	_ = st.UpsertGeoSetting("placeDetailsCacheHours", 72)
	a := &fakePhotoMaxCountApplier{}
	applyGeoSettingsFromStore(st, a)
	if a.last() != 6 || a.lastExpiry() != 14 || a.lastCacheHours() != 72 {
		t.Fatalf("期望 (6,14,72),實際 (%d,%d,%d)", a.last(), a.lastExpiry(), a.lastCacheHours())
	}

	_ = st.UpsertGeoSetting("placeDetailsCacheHours", 0) // 只壞掉快取有效期
	applyGeoSettingsFromStore(st, a)
	if a.last() != 6 || a.lastExpiry() != 14 {
		t.Errorf("快取有效期壞掉不該影響另外兩項,實際 (%d,%d)", a.last(), a.lastExpiry())
	}
	if a.lastCacheHours() != 24 {
		t.Errorf("壞掉的快取有效期應退回預設 24,實際 %d", a.lastCacheHours())
	}
}
