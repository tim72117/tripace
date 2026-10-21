package main

import (
	"testing"

	"github.com/tim72117/tripace/internal/store"
)

// geo_settings_test.go 測啟動與背景重讀時,資料庫裡的數值設定如何套用到
// 執行中的 server(applyGeoSettingsFromStore)。
//
// 設計:資料庫沒有資料列 = 沿用登錄表預設值,所以不需要 seeding(跟
// geo_rate_limits/geo_field_masks 不同,見 store/geo_settings_test.go 開頭)。
// 載入時不合法的值(例如有人直接改資料庫寫了 0)一律退回預設值並記 log,
// 而不是把壞值套進去——0 會讓所有地點都不補圖。
//
// 測試結構:隔離(空資料庫/合法值/各種非法值/不認得的 key/重讀)各自一個
// 測試,最後合併成「資料庫被改動 → 重讀 → 回到預設」一條流程。

type fakePhotoMaxCountApplier struct {
	calls       []int // SetPhotoMaxCount 的呼叫紀錄
	expiryCalls []int // SetPhotoExpiryDays 的呼叫紀錄
	cacheCalls  []int // SetPlaceDetailsCacheHours 的呼叫紀錄
}

func (a *fakePhotoMaxCountApplier) SetPlaceDetailsCacheHours(n int) {
	a.cacheCalls = append(a.cacheCalls, n)
}

func (a *fakePhotoMaxCountApplier) lastCacheHours() int {
	if len(a.cacheCalls) == 0 {
		return -1
	}
	return a.cacheCalls[len(a.cacheCalls)-1]
}

func (a *fakePhotoMaxCountApplier) SetPhotoMaxCount(n int) { a.calls = append(a.calls, n) }
func (a *fakePhotoMaxCountApplier) SetPhotoExpiryDays(n int) {
	a.expiryCalls = append(a.expiryCalls, n)
}

func (a *fakePhotoMaxCountApplier) lastExpiry() int {
	if len(a.expiryCalls) == 0 {
		return -1
	}
	return a.expiryCalls[len(a.expiryCalls)-1]
}

func (a *fakePhotoMaxCountApplier) last() int {
	if len(a.calls) == 0 {
		return -1
	}
	return a.calls[len(a.calls)-1]
}

func TestApplyGeoSettings_Isolated_EmptyStoreAppliesDefault(t *testing.T) {
	st := store.OpenTest(t)
	a := &fakePhotoMaxCountApplier{}
	applyGeoSettingsFromStore(st, a)
	if a.last() != 3 {
		t.Errorf("資料庫沒有設定時應套用預設 3,實際 %v", a.calls)
	}
}

func TestApplyGeoSettings_Isolated_StoredValidValueIsApplied(t *testing.T) {
	for _, v := range []int{1, 2, 5, 10} {
		st := store.OpenTest(t)
		if err := st.UpsertGeoSetting("photoMaxCount", v); err != nil {
			t.Fatalf("UpsertGeoSetting: %v", err)
		}
		a := &fakePhotoMaxCountApplier{}
		applyGeoSettingsFromStore(st, a)
		if a.last() != v {
			t.Errorf("資料庫 %d 應套用 %d,實際 %v", v, v, a.calls)
		}
	}
}

func TestApplyGeoSettings_Isolated_InvalidStoredValueFallsBackToDefault(t *testing.T) {
	for _, bad := range []int{0, -1, -50, 1000000} {
		st := store.OpenTest(t)
		_ = st.UpsertGeoSetting("photoMaxCount", bad)
		a := &fakePhotoMaxCountApplier{}
		applyGeoSettingsFromStore(st, a)
		if a.last() != 3 {
			t.Errorf("資料庫的壞值 %d 應退回預設 3,實際 %v", bad, a.calls)
		}
	}
}

func TestApplyGeoSettings_Isolated_UnknownKeysInStoreAreIgnored(t *testing.T) {
	// 程式已移除的舊設定、或手動寫進去的雜項 key:不能影響 photoMaxCount,
	// 也不能讓載入失敗。
	st := store.OpenTest(t)
	_ = st.UpsertGeoSetting("someRemovedSetting", 99)
	a := &fakePhotoMaxCountApplier{}
	applyGeoSettingsFromStore(st, a)
	if a.last() != 3 {
		t.Errorf("不認得的 key 不該影響 photoMaxCount,實際 %v", a.calls)
	}
}

func TestApplyGeoSettings_Isolated_ReloadPicksUpChanges(t *testing.T) {
	st := store.OpenTest(t)
	a := &fakePhotoMaxCountApplier{}
	_ = st.UpsertGeoSetting("photoMaxCount", 4)
	applyGeoSettingsFromStore(st, a)
	_ = st.UpsertGeoSetting("photoMaxCount", 6)
	applyGeoSettingsFromStore(st, a)
	if a.last() != 6 || len(a.calls) != 2 {
		t.Errorf("每次載入都該套用最新值,期望 [4 6],實際 %v", a.calls)
	}
}

// 合併:設定 → 載入 → 資料庫被壞掉 → 載入退回預設 → 修好 → 載入恢復。
func TestApplyGeoSettings_Combined_BreakAndRecoverThroughReload(t *testing.T) {
	st := store.OpenTest(t)
	a := &fakePhotoMaxCountApplier{}

	_ = st.UpsertGeoSetting("photoMaxCount", 5)
	applyGeoSettingsFromStore(st, a)
	_ = st.UpsertGeoSetting("photoMaxCount", 0) // 有人直接改壞資料庫
	applyGeoSettingsFromStore(st, a)
	_ = st.UpsertGeoSetting("photoMaxCount", 2) // 修好
	applyGeoSettingsFromStore(st, a)

	want := []int{5, 3, 2}
	if len(a.calls) != len(want) {
		t.Fatalf("期望依序套用 %v,實際 %v", want, a.calls)
	}
	for i := range want {
		if a.calls[i] != want[i] {
			t.Fatalf("期望依序套用 %v,實際 %v", want, a.calls)
		}
	}
}

// ===== photoExpiryDays(照片過期週期,預設 7 天)=====

func TestApplyGeoSettings_Isolated_PhotoExpiry_EmptyStoreAppliesDefaultSeven(t *testing.T) {
	st := store.OpenTest(t)
	a := &fakePhotoMaxCountApplier{}
	applyGeoSettingsFromStore(st, a)
	if a.lastExpiry() != 7 {
		t.Errorf("資料庫沒有設定時應套用預設 7,實際 %v", a.expiryCalls)
	}
}

func TestApplyGeoSettings_Isolated_PhotoExpiry_StoredValidValueIsApplied(t *testing.T) {
	for _, v := range []int{1, 3, 14, 30} {
		st := store.OpenTest(t)
		_ = st.UpsertGeoSetting("photoExpiryDays", v)
		a := &fakePhotoMaxCountApplier{}
		applyGeoSettingsFromStore(st, a)
		if a.lastExpiry() != v {
			t.Errorf("資料庫 %d 應套用 %d,實際 %v", v, v, a.expiryCalls)
		}
	}
}

func TestApplyGeoSettings_Isolated_PhotoExpiry_InvalidStoredValueFallsBackToDefault(t *testing.T) {
	for _, bad := range []int{0, -1, 365, 1000000} {
		st := store.OpenTest(t)
		_ = st.UpsertGeoSetting("photoExpiryDays", bad)
		a := &fakePhotoMaxCountApplier{}
		applyGeoSettingsFromStore(st, a)
		if a.lastExpiry() != 7 {
			t.Errorf("資料庫的壞值 %d 應退回預設 7,實際 %v", bad, a.expiryCalls)
		}
	}
}

// 合併:兩項設定同時存在,各自套用各自的值,其中一項壞掉不影響另一項。
func TestApplyGeoSettings_Combined_BothSettingsApplyIndependently(t *testing.T) {
	st := store.OpenTest(t)
	_ = st.UpsertGeoSetting("photoMaxCount", 6)
	_ = st.UpsertGeoSetting("photoExpiryDays", 14)
	a := &fakePhotoMaxCountApplier{}
	applyGeoSettingsFromStore(st, a)
	if a.last() != 6 || a.lastExpiry() != 14 {
		t.Fatalf("期望 (6,14),實際 (%d,%d)", a.last(), a.lastExpiry())
	}

	_ = st.UpsertGeoSetting("photoExpiryDays", 0) // 只壞掉過期週期
	applyGeoSettingsFromStore(st, a)
	if a.last() != 6 {
		t.Errorf("過期週期壞掉不該影響 photoMaxCount,實際 %d", a.last())
	}
	if a.lastExpiry() != 7 {
		t.Errorf("壞掉的過期週期應退回預設 7,實際 %d", a.lastExpiry())
	}
}
