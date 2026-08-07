package model

import "encoding/json"

// PaceCheckpointDetail 是 Entry.Detail 這個泛用 map[string]any 欄位,在
// 「配速表」情境下實際承載的結構——這是目前唯一已知、真的有資料存在
// 資料庫裡的 Detail 用法(用 CLI/entry-update 手動標註,不是任何工具自動
// 產生),過去完全沒有 Go 端的顯式型別,前端 web/src/PaceChart.tsx 與
// web/src/PhoneScreens.tsx 各自獨立猜測了一份形狀,兩份定義已經因此
// 悄悄不同步(PhoneScreens.tsx 的版本缺了 IsLongRest)。這裡補上唯一的
// 權威定義,前端兩處都應該改成從這份形狀推導,不再自己維護一份。
//
// Entry.Detail 本身維持 map[string]any(不直接把型別換成
// *PaceCheckpointDetail)——這個欄位設計上是給不同 Kind 各自存放專屬
// 結構用的通用容器(見 server/internal/wanttools/kindspec.go 的
// KindSpec 介面設計),配速表只是目前唯一有實際資料的一種用法,未來其他
// kind(stay/flight/restaurant 等)可能會有各自的 Detail 形狀,不能把
// Entry.Detail 寫死成單一具體型別。改用下方 ToMap/ParsePaceCheckpointDetail
// 這組轉換函式,在「已知這筆 entry 是配速表檢查站」的呼叫端顯式轉換,
// 而不是讓 Detail 欄位本身失去彈性。
type PaceCheckpointDetail struct {
	// Km 是這個檢查站在路線上的累積公里數,沒有值(尚未量測/不適用里程
	// 的檢查站)時為 nil。
	Km *float64 `json:"km"`
	// IsStart/IsFinish 標記這個檢查站是不是整段路線的起點/終點,用於
	// PaceChart.tsx 判斷要不要疊加起點/終點的視覺樣式。
	IsStart  bool `json:"isStart,omitempty"`
	IsFinish bool `json:"isFinish,omitempty"`
	// DwellMin 是在這個檢查站停留的分鐘數,沒有停留(純途經點)時為 nil。
	DwellMin *int `json:"dwellMin"`
	// IsLongRest 標記這是不是一次長休息(如午餐),PaceChart.tsx 用警示
	// 色系另外標示——過去 PhoneScreens.tsx 的獨立型別漏了這個欄位,兩份
	// 定義不同步的具體症狀之一。
	IsLongRest bool `json:"isLongRest,omitempty"`
	// Tag 是選填的標籤文字(例如「補給站」),沒有則為空字串。
	Tag string `json:"tag,omitempty"`
	// DepartTime/ArriveTime 是離開/抵達這個檢查站的時刻('HH:MM'),沒有
	// 值時為 nil。
	DepartTime *string `json:"departTime"`
	ArriveTime *string `json:"arriveTime"`
	// Order 是這個檢查站在所屬 Segment 內的顯示順序,明確指定、不依賴
	// 資料庫查詢排序(見 PaceChart.tsx 對這個欄位的完整說明:同一天可能
	// 有多筆 start 日期相同的檢查站,得靠這個欄位決定先後)。
	Order int `json:"order"`
	// Segment 標記這個檢查站屬於路線的哪一段(任意行程自訂,不假設固定
	// 是 leg1~leg4)。
	Segment string `json:"segment"`
}

// ToMap 把這個結構轉成 Entry.Detail 欄位要求的 map[string]any 形狀,供
// 寫入資料庫前呼叫(目前唯一的寫入路徑是人工用 CLI entry-update 帶
// -detail JSON 字串,見 cmd/cli/main.go——這個函式讓「應該長什麼形狀」
// 有明確依據,不必憑記憶手刻 JSON)。
func (d PaceCheckpointDetail) ToMap() (map[string]any, error) {
	b, err := json.Marshal(d)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return m, nil
}

// ParsePaceCheckpointDetail 嘗試把 Entry.Detail 的內容解析成
// PaceCheckpointDetail——detail 為 nil,或缺少 Segment(判斷「這筆
// 資料是不是配速表檢查站」的必要欄位,理由同 web/src/PhoneScreens.tsx
// entryPaceDetail 既有的執行期防呆判斷)時回傳 (nil, false),不視為
// 錯誤:Entry.Detail 本來就可能是其他 kind 的專屬資料,不符合這個形狀
// 是正常情況。
func ParsePaceCheckpointDetail(detail map[string]any) (*PaceCheckpointDetail, bool) {
	if detail == nil {
		return nil, false
	}
	b, err := json.Marshal(detail)
	if err != nil {
		return nil, false
	}
	var d PaceCheckpointDetail
	if err := json.Unmarshal(b, &d); err != nil {
		return nil, false
	}
	if d.Segment == "" {
		return nil, false
	}
	return &d, true
}
