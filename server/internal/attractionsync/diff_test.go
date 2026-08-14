package attractionsync

// diff_test.go 定義「三層比對」核心邏輯的預期行為（見
// docs/ATTRACTION_SYNC_DESIGN.md「二、傳輸流程」）。此時 diff.go 尚未
// 實作——這份測試是先寫好的規格,等所有測試案例確認涵蓋設計文件裡的
// 規則後,才動手補齊實作讓測試通過(TDD)。
//
// 這個 package 刻意不碰 HTTP/DB——三層比對是純函式邏輯,不管在 push 情境
// 下被本機呼叫、還是在 pull 情境下被正式站呼叫,用的都是同一份程式碼
// (見設計文件「三、架構」的「比對邏輯必須寫成兩邊 server 都能執行的
// 共用邏輯」)。呼叫端(本機 server 的 push handler / 正式站的 pull
// 比對 endpoint)負責把資料從 DB/HTTP 撈出來、餵給這裡的函式,不在這裡
// 處理。

import (
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/model"
)

func ts(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

func strPtr(s string) *string { return &s }

// attr 是測試裡快速組一筆 model.Attraction 的 helper——只填測試會用到
// 的欄位,其餘用零值,可讀性優先於嚴謹。
func attr(id, name string, updatedAt time.Time) model.Attraction {
	return model.Attraction{
		ID: id, Name: name, CityName: "台北",
		Lat: 25.03, Lng: 121.56, Level: 3,
		UpdatedAt: updatedAt,
	}
}

// ---- 第零層：新鮮度探測 ----

// FreshnessProbe 是第零層探測回傳的內容——筆數 + 最新一筆的
// UpdatedAt/ID(見設計文件:「回傳筆數與 ID 是為了在時間戳記剛好相同的
// 邊界情況下,仍能確認雙方看到的『最新一筆』是否真的是同一筆資料」)。
func TestNeedsSync_SourceHasNewerData(t *testing.T) {
	// 來源方最新一筆的時間比「上次同步完成時目的方記錄的最新一筆時間」
	// 還新 → 需要繼續比對。
	source := FreshnessProbe{Count: 12, LatestUpdatedAt: ts("2026-08-13T10:00:00Z"), LatestID: "lmk_new"}
	lastKnownDest := FreshnessProbe{Count: 10, LatestUpdatedAt: ts("2026-08-12T00:00:00Z"), LatestID: "lmk_old"}

	if !NeedsSync(source, lastKnownDest) {
		t.Error("來源方有更新的資料，NeedsSync 應該回傳 true")
	}
}

func TestNeedsSync_NoNewData(t *testing.T) {
	// 來源方最新一筆的時間沒有比目的方記錄的還新，且筆數/ID 都相符
	// → 不需要進入第一層，省下整批清單/欄位比對的成本。
	same := FreshnessProbe{Count: 10, LatestUpdatedAt: ts("2026-08-12T00:00:00Z"), LatestID: "lmk_old"}

	if NeedsSync(same, same) {
		t.Error("雙方最新狀態相同，NeedsSync 應該回傳 false")
	}
}

func TestNeedsSync_SameTimestampDifferentID(t *testing.T) {
	// 時間戳記剛好相同、但 ID 不同 —— 代表兩邊「最新一筆」其實不是同一筆
	// 資料(邊界情況，見設計文件對 LatestID 存在理由的說明)，必須視為
	// 需要繼續比對，不能只看時間戳記就判定「相同」。
	source := FreshnessProbe{Count: 10, LatestUpdatedAt: ts("2026-08-12T00:00:00Z"), LatestID: "lmk_a"}
	lastKnownDest := FreshnessProbe{Count: 10, LatestUpdatedAt: ts("2026-08-12T00:00:00Z"), LatestID: "lmk_b"}

	if !NeedsSync(source, lastKnownDest) {
		t.Error("時間戳記相同但 ID 不同，應視為需要繼續比對")
	}
}

// TestNeedsSync_CountDiffersDespiteOlderTimestamp 針對上線前複查發現的
// 靜默失效缺陷(見 docs/ATTRACTION_SYNC_SECURITY_REVIEW.md 風險 #3)：
// 目的方最新一筆時間比來源方新(例如目的方剛透過 attraction-add 手動
// 新增一筆),但來源方筆數遠多於目的方——代表來源方還有一大批更早的
// 資料沒同步過去。只看最新一筆時間會誤判成「已經是最新」，必須靠 Count
// 不同這個訊號才能正確判斷仍需要同步。
func TestNeedsSync_CountDiffersDespiteOlderTimestamp(t *testing.T) {
	source := FreshnessProbe{Count: 5, LatestUpdatedAt: ts("2026-08-01T00:00:00Z"), LatestID: "lmk_old"}
	lastKnownDest := FreshnessProbe{Count: 1, LatestUpdatedAt: ts("2026-08-09T00:00:00Z"), LatestID: "lmk_manual"}

	if !NeedsSync(source, lastKnownDest) {
		t.Error("來源方筆數(5)多於目的方(1)，即使目的方最新一筆時間較新，仍應視為需要同步")
	}
}

// ---- 第一層：輕量清單比對 ----

// LiteRecord 是第一層清單比對用的最小欄位集合(只含 ID+UpdatedAt，不含
// 完整內容——見設計文件「輕量清單比對」)。
func TestDiffLite_Categorizes(t *testing.T) {
	sourceList := []LiteRecord{
		{ID: "lmk_1", UpdatedAt: ts("2026-08-01T00:00:00Z")}, // 只在來源方 → 新增
		{ID: "lmk_2", UpdatedAt: ts("2026-08-05T00:00:00Z")}, // 兩邊都有，這層還不知道內容是否相同
	}
	destList := []LiteRecord{
		{ID: "lmk_2", UpdatedAt: ts("2026-08-02T00:00:00Z")},
		{ID: "lmk_3", UpdatedAt: ts("2026-08-03T00:00:00Z")}, // 只在目的方 → 依 allowDelete 決定
	}

	got := DiffLite(sourceList, destList)

	if got.OnlyInSource == nil || len(got.OnlyInSource) != 1 || got.OnlyInSource[0] != "lmk_1" {
		t.Errorf("OnlyInSource = %v，預期 [lmk_1]", got.OnlyInSource)
	}
	if len(got.OnlyInDest) != 1 || got.OnlyInDest[0] != "lmk_3" {
		t.Errorf("OnlyInDest = %v，預期 [lmk_3]", got.OnlyInDest)
	}
	if len(got.Intersection) != 1 || got.Intersection[0] != "lmk_2" {
		t.Errorf("Intersection = %v，預期 [lmk_2]", got.Intersection)
	}
}

func TestDiffLite_EmptyBothSides(t *testing.T) {
	got := DiffLite(nil, nil)
	if len(got.OnlyInSource) != 0 || len(got.OnlyInDest) != 0 || len(got.Intersection) != 0 {
		t.Errorf("兩邊都空，預期三個集合皆為空，得到 %+v", got)
	}
}

// ---- 第二層：完整欄位比對 ----

// FieldDiff 是單筆記錄的欄位級差異——供 dry-run 報告顯示「哪個欄位不同」
// (見設計文件的 dry-run 報告範例："Summary 不同、PhotoURL 不同")。
func TestCompareFields_Identical(t *testing.T) {
	a := attr("lmk_1", "清水寺", ts("2026-08-01T00:00:00Z"))
	b := attr("lmk_1", "清水寺", ts("2026-08-05T00:00:00Z")) // UpdatedAt 不同，但不參與內容比對

	diffs := CompareFields(a, b)
	if len(diffs) != 0 {
		t.Errorf("8 個比對欄位皆相同（UpdatedAt 不計入），預期沒有差異，得到 %v", diffs)
	}
}

func TestCompareFields_UpdatedAtNeverCounted(t *testing.T) {
	// 明確覆蓋設計文件的規則：「UpdatedAt 不參與『內容是否不同』的判斷」
	// ——這是本測試檔案裡最容易被後續實作不小心破壞的規則，特別獨立成
	// 一個測試案例，不跟 TestCompareFields_Identical 合併。
	a := attr("lmk_1", "清水寺", ts("2000-01-01T00:00:00Z"))
	b := attr("lmk_1", "清水寺", ts("2099-01-01T00:00:00Z"))

	if diffs := CompareFields(a, b); len(diffs) != 0 {
		t.Errorf("僅 UpdatedAt 不同，其餘 8 欄位相同，預期沒有差異，得到 %v", diffs)
	}
}

func TestCompareFields_DetectsFieldChanges(t *testing.T) {
	a := attr("lmk_1", "清水寺", ts("2026-08-01T00:00:00Z"))
	a.Summary = strPtr("原始介紹")
	a.PhotoURL = strPtr("https://example.com/old.jpg")

	b := a
	b.Summary = strPtr("更新後的介紹")
	b.PhotoURL = strPtr("https://example.com/new.jpg")

	diffs := CompareFields(a, b)
	wantFields := map[string]bool{"Summary": true, "PhotoURL": true}
	if len(diffs) != len(wantFields) {
		t.Fatalf("差異欄位數 = %d，預期 %d（%v）", len(diffs), len(wantFields), diffs)
	}
	for _, d := range diffs {
		if !wantFields[d.Field] {
			t.Errorf("非預期的差異欄位: %s", d.Field)
		}
	}
}

func TestCompareFields_PhotoURLParticipates(t *testing.T) {
	// 明確覆蓋設計文件的決策：「PhotoURL 雖然常是自動查詢帶入的，仍一視
	// 同仁納入比對」——不因為它常是自動填入的就被排除在比對範圍外。
	a := attr("lmk_1", "清水寺", ts("2026-08-01T00:00:00Z"))
	a.PhotoURL = strPtr("https://example.com/a.jpg")
	b := a
	b.PhotoURL = strPtr("https://example.com/b.jpg")

	diffs := CompareFields(a, b)
	if len(diffs) != 1 || diffs[0].Field != "PhotoURL" {
		t.Errorf("CompareFields = %v，預期只有 PhotoURL 一項差異", diffs)
	}
}

func TestCompareFields_NilVsNonNilSummary(t *testing.T) {
	// Summary/PhotoURL 是 *string（可能是 nil）——nil 對非 nil 也要能
	// 正確判定為「不同」，不能直接對指標做比較或在解參考時 panic。
	a := attr("lmk_1", "清水寺", ts("2026-08-01T00:00:00Z"))
	a.Summary = nil
	b := a
	b.Summary = strPtr("新增的介紹")

	diffs := CompareFields(a, b)
	if len(diffs) != 1 || diffs[0].Field != "Summary" {
		t.Errorf("CompareFields = %v，預期偵測到 Summary 從 nil 變成有值", diffs)
	}
}

// ---- allow-delete 語意 ----

// PlanActions 把 DiffLite 的結果轉成「實際要做的動作」清單，套用
// allow-delete 規則（見設計文件「一、比對模型」的動作表格）。
func TestPlanActions_OnlyInDestDefaultsToKeep(t *testing.T) {
	diff := ListDiff{OnlyInSource: []string{"lmk_1"}, OnlyInDest: []string{"lmk_2"}}

	actions := PlanActions(diff, nil, false /* allowDelete */)

	wantCreate := false
	wantDelete := false
	for _, a := range actions {
		if a.ID == "lmk_1" && a.Kind == ActionCreate {
			wantCreate = true
		}
		if a.ID == "lmk_2" && a.Kind == ActionDelete {
			wantDelete = true
		}
	}
	if !wantCreate {
		t.Error("只在來源方的記錄，預期產生 ActionCreate")
	}
	if wantDelete {
		t.Error("未帶 allow-delete，只在目的方的記錄不該產生 ActionDelete（應保留）")
	}
}

func TestPlanActions_OnlyInDestWithAllowDelete(t *testing.T) {
	diff := ListDiff{OnlyInDest: []string{"lmk_2"}}

	actions := PlanActions(diff, nil, true /* allowDelete */)

	if len(actions) != 1 || actions[0].ID != "lmk_2" || actions[0].Kind != ActionDelete {
		t.Errorf("PlanActions = %+v，預期只有一筆 lmk_2 的 ActionDelete", actions)
	}
}

func TestPlanActions_ChangedFieldsBecomeUpdate(t *testing.T) {
	diff := ListDiff{Intersection: []string{"lmk_1"}}
	fieldDiffs := map[string][]FieldDiff{
		"lmk_1": {{Field: "Summary", Source: "新", Dest: "舊"}},
	}

	actions := PlanActions(diff, fieldDiffs, false)

	if len(actions) != 1 || actions[0].ID != "lmk_1" || actions[0].Kind != ActionUpdate {
		t.Errorf("PlanActions = %+v，預期一筆 lmk_1 的 ActionUpdate", actions)
	}
}

func TestPlanActions_IntersectionNoFieldDiffProducesNoAction(t *testing.T) {
	// 兩邊都有、但內容完全相同（不在 fieldDiffs map 裡）→ 不產生任何動作。
	diff := ListDiff{Intersection: []string{"lmk_1"}}

	actions := PlanActions(diff, map[string][]FieldDiff{}, false)

	if len(actions) != 0 {
		t.Errorf("內容相同的交集記錄不該產生動作，得到 %+v", actions)
	}
}
