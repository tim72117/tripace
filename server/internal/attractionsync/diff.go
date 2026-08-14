// Package attractionsync 實作景點資料同步機制的三層比對 + 交握式傳輸
// 核心邏輯（見 docs/ATTRACTION_SYNC_DESIGN.md）。這個 package 刻意不碰
// HTTP/DB——不管在 push 情境下被本機呼叫、還是在 pull 情境下被正式站
// 呼叫，用的都是同一份程式碼（見設計文件「三、架構」：比對邏輯必須寫成
// 兩邊 server 都能執行的共用邏輯）。呼叫端負責把資料從 DB/HTTP 撈出來、
// 餵給這裡的函式，不在這裡處理 I/O。
package attractionsync

import (
	"strconv"
	"time"

	"github.com/tim72117/tripace/internal/model"
)

// FreshnessProbe 是第零層新鮮度探測的內容：筆數 + 最新一筆的
// UpdatedAt/ID。帶 ID 是為了在時間戳記剛好相同的邊界情況下，仍能確認
// 雙方看到的「最新一筆」是否真的是同一筆資料（見設計文件「二、傳輸
// 流程」）。
type FreshnessProbe struct {
	Count           int
	LatestUpdatedAt time.Time
	LatestID        string
}

// NeedsSync 判斷來源方是否有比「上次同步完成時目的方記錄的最新狀態」
// 更新的資料。時間戳記相同但 ID 不同也視為需要繼續比對——代表兩邊看到
// 的「最新一筆」實際上不是同一筆資料。
//
// Count 不同也視為需要同步：只比「最新一筆的 UpdatedAt」會漏掉「目的方
// 最新一筆時間比來源方晚，但筆數少很多」的情況——例如目的方有人透過
// attraction-add 新增了一筆（UpdatedAt 變成現在），此時來源方即使還有
// 一大批更早的資料沒同步過去，光看最新一筆時間會誤判成「已經是最新，
// 不需要同步」，導致那批資料被靜默漏掉、且使用者從回應完全看不出來
// （見 docs/ATTRACTION_SYNC_SECURITY_REVIEW.md 風險 #3，這是上線前
// 複查時發現並實際重現過的既有缺陷）。Count 不同就代表雙方資料集大小
// 不一致，不論最新一筆時間先後，都值得讓後續的第一層清單 diff 去確認
// 真正的差異在哪，而不是在這裡就提早放行。
func NeedsSync(source, lastKnownDest FreshnessProbe) bool {
	if source.LatestUpdatedAt.After(lastKnownDest.LatestUpdatedAt) {
		return true
	}
	if source.LatestUpdatedAt.Equal(lastKnownDest.LatestUpdatedAt) && source.LatestID != lastKnownDest.LatestID {
		return true
	}
	if source.Count != lastKnownDest.Count {
		return true
	}
	return false
}

// LiteRecord 是第一層清單比對用的最小欄位集合——只含 ID+UpdatedAt，
// 不含 Name/Summary/PhotoURL 等完整欄位，用來壓低「要不要繼續比對」
// 判斷本身的傳輸成本。
type LiteRecord struct {
	ID        string
	UpdatedAt time.Time
}

// ListDiff 是 DiffLite 的輸出：只在來源方 / 只在目的方 / 兩邊都有
// （交集）三個 ID 集合。
type ListDiff struct {
	OnlyInSource []string
	OnlyInDest   []string
	Intersection []string
}

// DiffLite 比較兩份輕量清單，算出三個集合。回傳的切片依輸入清單的
// 走訪順序，不額外保證排序（呼叫端若需要穩定順序，自行排序）。
func DiffLite(source, dest []LiteRecord) ListDiff {
	sourceByID := make(map[string]bool, len(source))
	for _, r := range source {
		sourceByID[r.ID] = true
	}
	destByID := make(map[string]bool, len(dest))
	for _, r := range dest {
		destByID[r.ID] = true
	}

	diff := ListDiff{
		OnlyInSource: []string{},
		OnlyInDest:   []string{},
		Intersection: []string{},
	}
	for id := range sourceByID {
		if destByID[id] {
			diff.Intersection = append(diff.Intersection, id)
		} else {
			diff.OnlyInSource = append(diff.OnlyInSource, id)
		}
	}
	for id := range destByID {
		if !sourceByID[id] {
			diff.OnlyInDest = append(diff.OnlyInDest, id)
		}
	}
	return diff
}

// FieldDiff 是單筆記錄的欄位級差異——供 dry-run 報告顯示「哪個欄位
// 不同」。Source/Dest 存字串化後的值，方便直接顯示，不需要呼叫端自己
// 對每種欄位型別做字串轉換。
type FieldDiff struct {
	Field  string
	Source string
	Dest   string
}

// compareFieldSpecs 集中定義「哪些欄位參與內容比對」與「怎麼取值」——
// 新增/移除比對欄位只需要改這裡一處，CompareFields 本身不需要跟著改。
// UpdatedAt 刻意不在這個清單裡：GORM 的 UPDATE 會無條件更新 UpdatedAt，
// 不保證欄位值真的不同，不能拿來判斷內容是否變更（見設計文件「一、
// 比對模型」）。
var compareFieldSpecs = []struct {
	name string
	get  func(model.Attraction) string
}{
	{"Name", func(a model.Attraction) string { return a.Name }},
	{"CityName", func(a model.Attraction) string { return a.CityName }},
	{"Lat", func(a model.Attraction) string { return strconv.FormatFloat(a.Lat, 'f', -1, 64) }},
	{"Lng", func(a model.Attraction) string { return strconv.FormatFloat(a.Lng, 'f', -1, 64) }},
	{"Level", func(a model.Attraction) string { return strconv.Itoa(a.Level) }},
	{"RadiusMeters", func(a model.Attraction) string { return strconv.Itoa(a.RadiusMeters) }},
	{"Summary", func(a model.Attraction) string { return derefStr(a.Summary) }},
	{"PhotoURL", func(a model.Attraction) string { return derefStr(a.PhotoURL) }},
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// CompareFields 比對兩筆記錄的 8 個內容欄位（見 compareFieldSpecs），
// 回傳有差異的欄位清單。欄位順序固定依 compareFieldSpecs 的宣告順序，
// 方便測試斷言與呈現時的穩定性。nil 對非 nil 的 *string 欄位（Summary/
// PhotoURL）視為與空字串比較，能正確判定為「不同」。
func CompareFields(a, b model.Attraction) []FieldDiff {
	var diffs []FieldDiff
	for _, spec := range compareFieldSpecs {
		av, bv := spec.get(a), spec.get(b)
		if av != bv {
			diffs = append(diffs, FieldDiff{Field: spec.name, Source: av, Dest: bv})
		}
	}
	return diffs
}

// ActionKind 是 PlanActions 產生的動作種類。
type ActionKind int

const (
	ActionCreate ActionKind = iota
	ActionUpdate
	ActionDelete
)

// Action 是「要對目的方做的一件事」——PlanActions 的輸出，也是交握式
// 傳輸階段實際要執行的工作清單。
type Action struct {
	ID   string
	Kind ActionKind
}

// PlanActions 把 DiffLite 的結果轉成「實際要做的動作」清單，套用
// allow-delete 規則（見設計文件「一、比對模型」的動作表格）：
//   - 只在來源方 → 一律 ActionCreate。
//   - 只在目的方 → allowDelete 為 false 時忽略（保留，安全預設值）；
//     為 true 時才產生 ActionDelete。
//   - 交集且有欄位差異（出現在 fieldDiffs 裡）→ ActionUpdate；沒有欄位
//     差異 → 不產生任何動作。
func PlanActions(diff ListDiff, fieldDiffs map[string][]FieldDiff, allowDelete bool) []Action {
	var actions []Action
	for _, id := range diff.OnlyInSource {
		actions = append(actions, Action{ID: id, Kind: ActionCreate})
	}
	if allowDelete {
		for _, id := range diff.OnlyInDest {
			actions = append(actions, Action{ID: id, Kind: ActionDelete})
		}
	}
	for _, id := range diff.Intersection {
		if len(fieldDiffs[id]) > 0 {
			actions = append(actions, Action{ID: id, Kind: ActionUpdate})
		}
	}
	return actions
}
