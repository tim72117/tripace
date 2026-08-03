package store

import (
	"testing"

	"github.com/tim72117/tripace/internal/model"
)

// newTestEntry 建立一個測試用行程 + 條目,回傳條目 ID 供後續 CRUD 操作使用。
func newTestEntry(t *testing.T, s *Store, id string) string {
	t.Helper()
	tr, err := s.CreateTrip("tr_"+id, "test trip", model.User{ID: "usr_" + id, Name: "tester"})
	if err != nil {
		t.Fatalf("create trip: %v", err)
	}
	e := model.Entry{
		ID:        "ent_" + id,
		TripID:    tr.ID,
		Title:     "原始標題",
		Start:     "2026-07-31",
		StartTime: "09:00",
		Location:  "花蓮 光復橋",
	}
	if err := s.InsertEntry(e); err != nil {
		t.Fatalf("insert entry: %v", err)
	}
	return e.ID
}

// TestEntryCRUD 驗證 Entry 的新增/查詢/更新/刪除基本流程。
func TestEntryCRUD(t *testing.T) {
	s := newTestStore(t)
	id := newTestEntry(t, s, "crud")

	// 查詢:剛新增的條目應存在。
	exists, err := s.EntryExists(id)
	if err != nil {
		t.Fatalf("EntryExists: %v", err)
	}
	if !exists {
		t.Fatal("剛新增的 entry 應存在,卻回 false")
	}

	// 更新:改標題與地點。
	if err := s.UpdateEntry(id, "新標題", "", "", "", "", "花蓮 富興客棧", "", "", nil); err != nil {
		t.Fatalf("UpdateEntry: %v", err)
	}

	// 刪除:應能成功刪除,再次查詢應不存在。
	if err := s.DeleteEntry(id); err != nil {
		t.Fatalf("DeleteEntry: %v", err)
	}
	exists, err = s.EntryExists(id)
	if err != nil {
		t.Fatalf("EntryExists after delete: %v", err)
	}
	if exists {
		t.Fatal("刪除後的 entry 不應存在,卻回 true")
	}
}

// TestEntryUpdateDetail 驗證 UpdateEntry 寫入 detail(map[string]any)欄位不會出錯。
//
// 這是迴歸測試:UpdateEntry 原本用 map[string]any 呼叫 GORM 的 Updates(),
// entryRow.Detail 的 `serializer:json` tag 只在透過具名 struct 更新時生效,
// 用動態 map 呼叫時 GORM 無法從欄位名稱字串反查回 struct tag,會把原始 Go
// map 直接交給資料庫驅動編碼——SQLite 與 Postgres 驅動都會在這裡出錯,只是
// 錯誤訊息不同(SQLite:"unsupported type map[string]interface {}";
// Postgres:"unable to encode map[string]interface{} into text format"),
// 已實測確認修復前這裡在 SQLite 上就會直接失敗,不是只有 Postgres 環境才會
// 踩到,故這支測試在兩種資料庫上都是有效的迴歸測試。
func TestEntryUpdateDetail(t *testing.T) {
	s := newTestStore(t)
	id := newTestEntry(t, s, "detail")

	detail := map[string]any{
		"km":         10.5,
		"isStart":    true,
		"isFinish":   false,
		"dwellMin":   nil,
		"isLongRest": false,
	}
	if err := s.UpdateEntry(id, "", "", "", "", "", "", "", "", detail); err != nil {
		t.Fatalf("UpdateEntry with detail: %v", err)
	}

	got, err := s.GetEntry(id)
	if err != nil {
		t.Fatalf("GetEntry: %v", err)
	}
	if got.Detail == nil {
		t.Fatal("detail 應已寫入,卻讀回 nil")
	}
	if km, _ := got.Detail["km"].(float64); km != 10.5 {
		t.Fatalf("detail.km 應為 10.5,卻讀回 %v", got.Detail["km"])
	}
	if isStart, _ := got.Detail["isStart"].(bool); !isStart {
		t.Fatalf("detail.isStart 應為 true,卻讀回 %v", got.Detail["isStart"])
	}
}
