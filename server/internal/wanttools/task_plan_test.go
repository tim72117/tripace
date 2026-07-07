package wanttools

import (
	"strings"
	"testing"

	"github.com/tim72117/want/types"
)

// fakeToolCtx 是 types.ToolContext 的測試假物件:只實作 task_plan 會用到的
// GetSessionEnvs(供 ChannelFrom 取 channelID)與 EmitToolResult(記下最後結果供斷言),
// 其餘 interface 方法一律 no-op / 回傳零值。
type fakeToolCtx struct {
	envs       map[string]string
	lastResult map[string]interface{}
}

func (c *fakeToolCtx) GetSessionEnvs() map[string]string            { return c.envs }
func (c *fakeToolCtx) EmitToolResult(result map[string]interface{}) { c.lastResult = result }

// 以下為滿足 types.ToolContext interface 的其餘方法(task_plan 不使用)。
func (c *fakeToolCtx) AddMessage(string, types.Experience)                        {}
func (c *fakeToolCtx) CommitToolResult(*types.ToolUse, ...types.Experience)       {}
func (c *fakeToolCtx) GetAgentID() string                                         { return "" }
func (c *fakeToolCtx) GetWorkingDirectory() string                               { return "" }
func (c *fakeToolCtx) SetWorkingDirectory(string)                                 {}
func (c *fakeToolCtx) GetAppState() types.AppState                                { return types.AppState{} }
func (c *fakeToolCtx) SetAppState(func(types.AppState) types.AppState)            {}
func (c *fakeToolCtx) GetLastSnapshotFile() string                                { return "" }
func (c *fakeToolCtx) SetLastSnapshotFile(string)                                 {}
func (c *fakeToolCtx) SetSessionEnvs(map[string]string)                           {}
func (c *fakeToolCtx) GetReadFileState() interface{}                              { return nil }
func (c *fakeToolCtx) GetStagedChanges() interface{}                              { return nil }
func (c *fakeToolCtx) GetExposedTools() []string                                  { return nil }
func (c *fakeToolCtx) SetExposedTools([]string)                                   {}
func (c *fakeToolCtx) EmitEvent(interface{})                                      {}
func (c *fakeToolCtx) EmitError(error)                                            {}
func (c *fakeToolCtx) RequestInteraction(map[string]interface{}) (interface{}, error) {
	return nil, nil
}

// newTaskCtx 建立綁定指定 channelID 的假 context。
func newTaskCtx(channelID string) *fakeToolCtx {
	return &fakeToolCtx{envs: map[string]string{"channelID": channelID}}
}

// callCreate 用 items 物件陣列呼叫 task_plan 的 create,回傳建立後該頻道的任務清單。
// 每個 item 是 map,對齊工具真正收到的 JSON 反序列化型別(map[string]interface{})。
func callCreate(t *testing.T, ch string, items []map[string]interface{}) []Task {
	t.Helper()
	raw := make([]interface{}, len(items))
	for i, it := range items {
		raw[i] = it
	}
	tool := &TaskPlanTool{}
	args := types.ToolArguments{"action": "create", "items": raw}
	if _, err := tool.Call(args, newTaskCtx(ch)); err != nil {
		t.Fatalf("create 失敗: %v", err)
	}
	return tasks.List(ch)
}

// TestTaskPlanCreateAssignsIncrementingIDs 是本次核心:驗證 task_plan create
// 用 items 一次寫入多筆時,每筆各自拿到「頻道內遞增」的 id(1,2,3...),
// 且欄位(text/date/kind)正確落到對應的那筆。
func TestTaskPlanCreateAssignsIncrementingIDs(t *testing.T) {
	ch := "ch_ids"
	tasks.Clear(ch)
	t.Cleanup(func() { tasks.Clear(ch) })

	list := callCreate(t, ch, []map[string]interface{}{
		{"text": "訂機票", "date": "2026-06-29", "kind": "add"},
		{"text": "確認飯店", "kind": "update"},
		{"text": "整理行李"},
	})

	if len(list) != 3 {
		t.Fatalf("應建立 3 筆任務,實得 %d", len(list))
	}

	// id 應為頻道內遞增序號 1,2,3。
	for i, tk := range list {
		wantID := i + 1
		if tk.ID != wantID {
			t.Errorf("第 %d 筆 id = %d, want %d", i, tk.ID, wantID)
		}
	}

	// 欄位應對齊各自那筆(不因批次而錯位)。
	if list[0].Text != "訂機票" || list[0].Date != "2026-06-29" || list[0].Kind != "add" {
		t.Errorf("第 1 筆欄位不符: %+v", list[0])
	}
	if list[1].Text != "確認飯店" || list[1].Date != "" || list[1].Kind != "update" {
		t.Errorf("第 2 筆欄位不符: %+v", list[1])
	}
	if list[2].Text != "整理行李" || list[2].Date != "" || list[2].Kind != "" {
		t.Errorf("第 3 筆欄位不符: %+v", list[2])
	}
}

// TestTaskPlanCreateIDsContinueAcrossCalls 驗證 id 是「持續遞增」而非每次 create 重置:
// 第二次 create 的 id 應接續第一次(不從 1 重來),這樣 complete/delete 用的 id 才不會撞號。
func TestTaskPlanCreateIDsContinueAcrossCalls(t *testing.T) {
	ch := "ch_ids_seq"
	tasks.Clear(ch)
	t.Cleanup(func() { tasks.Clear(ch) })

	callCreate(t, ch, []map[string]interface{}{{"text": "步驟1"}, {"text": "步驟2"}})
	list := callCreate(t, ch, []map[string]interface{}{{"text": "步驟3"}})

	if len(list) != 3 {
		t.Fatalf("兩次 create 後應共 3 筆,實得 %d", len(list))
	}
	if got := list[2].ID; got != 3 {
		t.Errorf("第二次 create 的任務 id = %d, want 3(應接續遞增)", got)
	}
}

// TestTaskPlanCreateIDsPerChannel 驗證 id 是「per-channel」獨立計數:
// 不同頻道各自從 1 開始,互不影響。
func TestTaskPlanCreateIDsPerChannel(t *testing.T) {
	chA, chB := "ch_a_ids", "ch_b_ids"
	tasks.Clear(chA)
	tasks.Clear(chB)
	t.Cleanup(func() { tasks.Clear(chA); tasks.Clear(chB) })

	callCreate(t, chA, []map[string]interface{}{{"text": "A1"}, {"text": "A2"}})
	listB := callCreate(t, chB, []map[string]interface{}{{"text": "B1"}})

	if got := listB[0].ID; got != 1 {
		t.Errorf("chB 首筆 id = %d, want 1(各頻道獨立計數)", got)
	}
}

// TestTaskPlanCreateSingleText 驗證退回路徑:沒有 items、只給單筆 text 時,
// 仍建立 1 筆且 id = 1。
func TestTaskPlanCreateSingleText(t *testing.T) {
	ch := "ch_single"
	tasks.Clear(ch)
	t.Cleanup(func() { tasks.Clear(ch) })

	tool := &TaskPlanTool{}
	args := types.ToolArguments{"action": "create", "text": "只有一筆"}
	if _, err := tool.Call(args, newTaskCtx(ch)); err != nil {
		t.Fatalf("create 單筆失敗: %v", err)
	}

	list := tasks.List(ch)
	if len(list) != 1 || list[0].ID != 1 || list[0].Text != "只有一筆" {
		t.Fatalf("單筆 create 結果不符: %+v", list)
	}
}

// TestTaskPlanCreateIgnoresCallerID 鎖死關鍵保證:id 一律由 tool 產生,不論單筆或批次,
// 即使呼叫端(LLM)在 create 時硬塞 id,也會被忽略、改用工具自己遞增的 id。
func TestTaskPlanCreateIgnoresCallerID(t *testing.T) {
	ch := "ch_ignore_id"
	tasks.Clear(ch)
	t.Cleanup(func() { tasks.Clear(ch) })

	// 單筆:args 帶了 id=999,期望被忽略,實得工具產生的 id=1。
	tool := &TaskPlanTool{}
	single := types.ToolArguments{"action": "create", "text": "單筆", "id": 999}
	if _, err := tool.Call(single, newTaskCtx(ch)); err != nil {
		t.Fatalf("單筆 create 失敗: %v", err)
	}

	// 批次:每個 item 都塞 id,同樣期望被忽略,實得接續遞增的 2,3。
	batchList := callCreate(t, ch, []map[string]interface{}{
		{"text": "批次A", "id": 100},
		{"text": "批次B", "id": 200},
	})

	if len(batchList) != 3 {
		t.Fatalf("應共 3 筆,實得 %d", len(batchList))
	}
	for i, tk := range batchList {
		wantID := i + 1
		if tk.ID != wantID {
			t.Errorf("第 %d 筆 id = %d, want %d(呼叫端傳的 id 應被忽略)", i, tk.ID, wantID)
		}
	}
}

// callCreateRaw 用已備妥的 items([]interface{},元素為 map)直接呼叫 create,
// 供需要帶 parentID 等額外欄位的測試使用。回傳該頻道建立後的完整任務清單。
func callCreateRaw(t *testing.T, ch string, raw []interface{}) []Task {
	t.Helper()
	tool := &TaskPlanTool{}
	args := types.ToolArguments{"action": "create", "items": raw}
	if _, err := tool.Call(args, newTaskCtx(ch)); err != nil {
		t.Fatalf("create 失敗: %v", err)
	}
	return tasks.List(ch)
}

// TestTaskPlanTwoLayerParentID 驗證兩層結構:先建第一層條目拿到 id,再帶 parentID
// 建立其底下的施作步驟,子步驟的 ParentID 應正確指回第一層條目的 id。
func TestTaskPlanTwoLayerParentID(t *testing.T) {
	ch := "ch_two_layer"
	tasks.Clear(ch)
	t.Cleanup(func() { tasks.Clear(ch) })

	// 第一層:兩筆確定要新增的條目(無 parentID)。
	first := callCreate(t, ch, []map[string]interface{}{
		{"text": "訂希爾頓", "date": "2026-06-29", "kind": "add"},
		{"text": "回程機票", "date": "2026-07-01", "kind": "add"},
	})
	if len(first) != 2 || first[0].ID != 1 || first[1].ID != 2 {
		t.Fatalf("第一層建立不符: %+v", first)
	}
	if first[0].ParentID != 0 || first[1].ParentID != 0 {
		t.Fatalf("第一層條目 ParentID 應為 0: %+v", first)
	}

	// 第二層:掛在條目 #1(訂希爾頓)底下的施作步驟。
	list := callCreateRaw(t, ch, []interface{}{
		map[string]interface{}{"text": "查是否已存在", "parentID": 1},
		map[string]interface{}{"text": "查 geo 座標", "parentID": 1},
	})

	if len(list) != 4 {
		t.Fatalf("兩層共應 4 筆,實得 %d", len(list))
	}
	// id 3、4 應是施作步驟,ParentID 指回 1。
	for _, tk := range list {
		if tk.ID == 3 || tk.ID == 4 {
			if tk.ParentID != 1 {
				t.Errorf("施作步驟 #%d 的 ParentID = %d, want 1", tk.ID, tk.ParentID)
			}
		}
	}
}

// TestTaskPlanSecondLayerNoPlaceholder 驗證只有第一層條目會發 NotifyTaskCreated
// (前端佔位卡);第二層施作步驟是執行細節,不應觸發佔位卡廣播。
func TestTaskPlanSecondLayerNoPlaceholder(t *testing.T) {
	ch := "ch_layer_notify"
	tasks.Clear(ch)
	t.Cleanup(func() { tasks.Clear(ch); BindTaskCreated(nil) })

	var notified []int // 收到廣播的 taskID
	BindTaskCreated(func(_ string, taskID int, _, _, _ string) {
		notified = append(notified, taskID)
	})

	// 第一層一筆(id=1)→ 應廣播;第二層兩筆(id=2,3, parentID=1)→ 不應廣播。
	callCreate(t, ch, []map[string]interface{}{{"text": "訂希爾頓", "kind": "add"}})
	callCreateRaw(t, ch, []interface{}{
		map[string]interface{}{"text": "查是否已存在", "parentID": 1},
		map[string]interface{}{"text": "查 geo", "parentID": 1},
	})

	if len(notified) != 1 || notified[0] != 1 {
		t.Fatalf("應只廣播第一層條目 #1,實得 %v", notified)
	}
}

// TestRenderTaskListIndentsChildren 驗證 renderTaskList 以縮排呈現兩層:
// 第一層頂格、施作步驟縮排(前綴兩個空格),且子步驟緊接在父項之後。
func TestRenderTaskListIndentsChildren(t *testing.T) {
	list := []Task{
		{ID: 1, Text: "訂希爾頓", Kind: "add"},
		{ID: 2, Text: "查是否已存在", ParentID: 1},
		{ID: 3, Text: "查 geo 座標", ParentID: 1},
	}
	got := renderTaskList(list)

	// 第一層應頂格(換行後直接 "[ ] #1")。
	if !strings.Contains(got, "\n[ ] #1 訂希爾頓") {
		t.Errorf("第一層條目應頂格顯示,實得:\n%s", got)
	}
	// 施作步驟應縮排兩空格。
	if !strings.Contains(got, "\n  [ ] #2 查是否已存在") {
		t.Errorf("施作步驟 #2 應縮排,實得:\n%s", got)
	}
	if !strings.Contains(got, "\n  [ ] #3 查 geo 座標") {
		t.Errorf("施作步驟 #3 應縮排,實得:\n%s", got)
	}
}

// TestTaskPlanCreateNotifiesWithKind 驗證 create 會透過 NotifyTaskCreated 廣播,
// 且帶出每筆的 id/date/text/kind(前端佔位卡靠 kind 顯示「新增中」/「更新中」)。
func TestTaskPlanCreateNotifiesWithKind(t *testing.T) {
	ch := "ch_notify"
	tasks.Clear(ch)
	t.Cleanup(func() { tasks.Clear(ch); BindTaskCreated(nil) })

	type evt struct {
		taskID           int
		date, text, kind string
	}
	var got []evt
	BindTaskCreated(func(channelID string, taskID int, date, text, kind string) {
		got = append(got, evt{taskID, date, text, kind})
	})

	callCreate(t, ch, []map[string]interface{}{
		{"text": "訂機票", "date": "2026-06-29", "kind": "add"},
		{"text": "改時間", "kind": "update"},
	})

	if len(got) != 2 {
		t.Fatalf("應廣播 2 次 task_created,實得 %d", len(got))
	}
	want := []evt{
		{1, "2026-06-29", "訂機票", "add"},
		{2, "", "改時間", "update"},
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("第 %d 次廣播 = %+v, want %+v", i, got[i], want[i])
		}
	}
}
