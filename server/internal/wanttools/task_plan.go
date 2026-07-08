package wanttools

import (
	"fmt"
	"strings"

	"github.com/tim72117/want/types"
)

// TaskPlanDeclaration 是 task_plan 工具:讓 agent 規劃並追蹤多步驟任務。
// 任務存於記憶體(per-channel),供 agent 在處理複雜請求時:先列計畫、逐步完成、
// 全部完成後清除。用 action 分派各種操作,避免工具清單膨脹。
var TaskPlanDeclaration = types.ToolDeclaration{
	Name: "task_plan",
	Description: "規劃並追蹤多步驟任務(待辦清單,存於本頻道記憶體)。處理需要多步驟的複雜請求時," +
		"先用 create 列出計畫,完成一步就 complete 標記,全部完成後用 clear 清除。以 action 指定操作。",
	Type: "sync",
	Parameters: map[string]interface{}{
		"type": "OBJECT",
		"properties": map[string]interface{}{
			"action": map[string]interface{}{
				"type": "STRING",
				"description": "操作類型:" +
					"'create'(新增任務;用 items 一次列出整個計畫,或 text 加單筆)| " +
					"'list'(列出全部任務)| " +
					"'update'(改任務欄位,需 id,text/date/kind 擇一或多個要改的欄位)| " +
					"'complete'(標記完成,需 id)| " +
					"'delete'(刪除一筆,需 id)| " +
					"'clear'(清空全部任務)。",
			},
			"items": map[string]interface{}{
				"type": "ARRAY",
				"items": map[string]interface{}{
					"type": "OBJECT",
					"properties": map[string]interface{}{
						"text": map[string]interface{}{
							"type":        "STRING",
							"description": "任務描述。",
						},
						"date": map[string]interface{}{
							"type":        "STRING",
							"description": "任務日期'YYYY-MM-DD',不指定就留空字串。",
						},
						"kind": map[string]interface{}{
							"type":        "STRING",
							"description": "分類:'add'(這步是新增)| 'update'(這步是更新)| 留空字串表示不分類。",
						},
						"parentID": map[string]interface{}{
							"type":        "INTEGER",
							"description": "所屬第一層條目的 id;這批是某條目底下的施作步驟時填,第一層條目本身不填(或填 0)。",
						},
					},
					"required": []string{"text"},
				},
				"description": "多筆任務(action=create 時一次寫入),每筆是 {text, date, kind, parentID} 物件。" +
					"第一層條目留空 parentID,如 [{text:'訂希爾頓', date:'2026-06-29', kind:'add'}];" +
					"某條目底下的施作步驟則整批帶同一 parentID,如 [{text:'查是否已存在', parentID:1}, {text:'查 geo 座標', parentID:1}]。",
			},
			"text": map[string]interface{}{
				"type":        "STRING",
				"description": "單筆任務描述(action=create 加單筆、或 action=update 時使用)。",
			},
			"date": map[string]interface{}{
				"type":        "STRING",
				"description": "單筆任務日期'YYYY-MM-DD'(action=create 加單筆、或 action=update 時使用)。",
			},
			"kind": map[string]interface{}{
				"type":        "STRING",
				"description": "單筆任務分類:'add' | 'update'(action=create 加單筆、或 action=update 時使用)。",
			},
			"parentID": map[string]interface{}{
				"type":        "INTEGER",
				"description": "單筆 create 時,若這是某第一層條目底下的施作步驟,填該條目的 id;第一層條目本身不填。",
			},
			"id": map[string]interface{}{
				"type":        "INTEGER",
				"description": "任務序號(action=update/complete/delete 時需要;由 create/list 回傳)。",
			},
		},
		"required": []string{"action"},
	},
}

type TaskPlanTool struct {
	types.BaseToolConfig
}

func (t *TaskPlanTool) ValidateInput(args types.ToolArguments, ctx types.ToolContext) error {
	action := args.GetString("action")
	switch action {
	case "create":
		inputs := collectTaskInputs(args)
		if len(inputs) == 0 {
			return fmt.Errorf("action=create 需要 text 或 texts")
		}
		if err := validateParentIDs(ChannelFrom(ctx), inputs); err != nil {
			return err
		}
	case "update":
		if args.GetInt("id") == 0 {
			return fmt.Errorf("action=update 需要 id")
		}
		in := singleTaskInput(args)
		if in.Text == "" && in.Date == "" && in.Kind == "" {
			return fmt.Errorf("action=update 需要至少一個要修改的欄位(text/date/kind)")
		}
	case "complete", "delete":
		if args.GetInt("id") == 0 {
			return fmt.Errorf("action=%s 需要 id", action)
		}
	case "list", "clear":
		// 無額外必填
	default:
		return fmt.Errorf("不支援的 action %q(可用:create/list/update/complete/delete/clear)", action)
	}
	return nil
}

func (t *TaskPlanTool) Call(args types.ToolArguments, ctx types.ToolContext) ([]types.ResultContentBlock, error) {
	ch := ChannelFrom(ctx)
	action := args.GetString("action")

	var msg string
	switch action {
	case "create":
		inputs := collectTaskInputs(args)
		// 與 ValidateInput 同樣的檢查在此重複一次(縱深防禦):Call 不假設引擎
		// 必然先呼叫 ValidateInput 才呼叫 Call,避免任何繞過驗證的呼叫路徑
		// 寫入指向不存在或超過兩層的 parentID。
		if err := validateParentIDs(ch, inputs); err != nil {
			return nil, err
		}
		created := tasks.CreateMany(ch, inputs)
		for _, t := range created {
			// 只有第一層條目(ParentID=0)在前端插入「新增中」佔位卡;
			// 施作步驟(查存在、查 geo 等)是執行細節,不需對應卡片。
			if t.ParentID == 0 {
				NotifyTaskCreated(ch, t.ID, t.Date, t.Text, t.Kind)
			}
		}
		if len(created) == 1 {
			msg = fmt.Sprintf("已新增任務 #%d:%s", created[0].ID, taskLabel(created[0]))
		} else {
			msg = fmt.Sprintf("已新增 %d 筆任務", len(created))
		}
	case "update":
		id := args.GetInt("id")
		if err := tasks.Update(ch, id, singleTaskInput(args)); err != nil {
			return nil, err
		}
		msg = fmt.Sprintf("已更新任務 #%d", id)
	case "complete":
		id := args.GetInt("id")
		if err := tasks.Complete(ch, id); err != nil {
			return nil, err
		}
		msg = fmt.Sprintf("已標記任務 #%d 完成", id)
		if tasks.AllDone(ch) {
			msg += "(所有任務皆已完成,可呼叫 action=clear 清除)"
		}
	case "delete":
		id := args.GetInt("id")
		if err := tasks.Delete(ch, id); err != nil {
			return nil, err
		}
		msg = fmt.Sprintf("已刪除任務 #%d", id)
	case "clear":
		tasks.Clear(ch)
		msg = "已清除所有任務"
	case "list":
		msg = renderTaskList(tasks.List(ch))
	}

	// list 本身已回傳完整清單,不需再附加;clear 之後清單必空,附加無意義。
	if action != "list" && action != "clear" {
		msg += "\n" + renderTaskList(tasks.List(ch))
	}

	ctx.EmitToolResult(map[string]interface{}{"message": msg})
	return []types.ResultContentBlock{types.TextBlock(msg)}, nil
}

// validateParentIDs 檢查每筆 input 的 ParentID(若非 0)是否指向該頻道內一筆
// 已存在、且本身是第一層(ParentID==0)的任務。拒絕:
//   - 指向不存在的 id(可能是 LLM 記錯/用了另一頻道的 id)
//   - 指向另一筆第二層任務(避免超過兩層的鏈式 parent,設計上只允許兩層)
//
// create 尚未寫入任何一筆前就驗證完畢,不合法時整批拒絕,避免部分寫入的
// 不一致狀態(例如 3 筆裡 1 筆 parentID 有誤,不應該讓另外 2 筆先寫入)。
// 同一批次(inputs 內)彼此之間不可能有合法的 parentID 引用,因為新 id
// 要等寫入後才會產生;parentID 因此只能指向「已存在於 store 的舊資料」。
func validateParentIDs(channelID string, inputs []TaskInput) error {
	var existing []Task
	for _, in := range inputs {
		if in.ParentID == 0 {
			continue
		}
		if existing == nil {
			existing = tasks.List(channelID)
		}
		var parent *Task
		for i := range existing {
			if existing[i].ID == in.ParentID {
				parent = &existing[i]
				break
			}
		}
		if parent == nil {
			return fmt.Errorf("parentID=%d 不存在", in.ParentID)
		}
		if parent.ParentID != 0 {
			return fmt.Errorf("parentID=%d 本身是施作步驟,不能再掛子步驟(只允許兩層)", in.ParentID)
		}
	}
	return nil
}

// collectTaskInputs 蒐集 create 要新增的任務:優先取 items[](批次,每筆是 {text,date,kind}
// 物件),否則退回 text/date/kind(單筆)。跳過文字為空白的項目。
func collectTaskInputs(args types.ToolArguments) []TaskInput {
	raw, _ := args["items"].([]interface{})
	if len(raw) == 0 {
		if single := args.GetString("text"); single != "" {
			return []TaskInput{singleTaskInput(args)}
		}
		return nil
	}

	var out []TaskInput
	for _, item := range raw {
		obj, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		in := singleTaskInput(types.ToolArguments(obj))
		if strings.TrimSpace(in.Text) == "" {
			continue
		}
		out = append(out, in)
	}
	return out
}

// singleTaskInput 取單筆操作(create 單筆 / update)用的 text/date/kind/parentID 欄位。
func singleTaskInput(args types.ToolArguments) TaskInput {
	return TaskInput{
		Text:     args.GetString("text"),
		Date:     args.GetString("date"),
		Kind:     args.GetString("kind"),
		ParentID: args.GetInt("parentID"),
	}
}

// taskLabel 組出單一任務的顯示文字(含日期、分類標記)。
func taskLabel(t Task) string {
	label := t.Text
	if t.Date != "" {
		label = fmt.Sprintf("%s [%s]", label, t.Date)
	}
	if t.Kind != "" {
		label = fmt.Sprintf("%s (%s)", label, t.Kind)
	}
	return label
}

// renderTaskList 把任務清單排成給 agent 閱讀的文字(含完成狀態勾選、日期、分類)。
// 兩層階層:先列第一層條目(ParentID=0),每個條目底下縮排列出其施作步驟。
// 找不到父項的孤兒步驟(父項已被刪除)仍以頂層列出,避免遺漏。
func renderTaskList(list []Task) string {
	if len(list) == 0 {
		return "(目前沒有任務)"
	}

	// 依 parentID 分組子步驟;同時記錄哪些 id 存在,判斷孤兒。
	children := map[int][]Task{}
	exists := map[int]bool{}
	for _, t := range list {
		exists[t.ID] = true
		if t.ParentID != 0 {
			children[t.ParentID] = append(children[t.ParentID], t)
		}
	}

	var sb strings.Builder
	sb.WriteString("目前任務:")
	writeLine := func(t Task, indent string) {
		box := "[ ]"
		if t.Done {
			box = "[x]"
		}
		sb.WriteString(fmt.Sprintf("\n%s%s #%d %s", indent, box, t.ID, taskLabel(t)))
	}
	for _, t := range list {
		// 只從頂層(ParentID=0 或父項不存在的孤兒)展開,子步驟由父項那圈縮排列出。
		if t.ParentID != 0 && exists[t.ParentID] {
			continue
		}
		writeLine(t, "")
		for _, c := range children[t.ID] {
			writeLine(c, "  ")
		}
	}
	return sb.String()
}

func (t *TaskPlanTool) RenderToolUse(args types.ToolArguments) string {
	return fmt.Sprintf("task_plan: %s", args.GetString("action"))
}

func (t *TaskPlanTool) RenderToolUseError(err error) string {
	return fmt.Sprintf("task_plan failed: %v", err)
}

func (t *TaskPlanTool) RenderToolResult(data map[string]interface{}) string {
	if msg, ok := data["message"].(string); ok {
		return msg
	}
	return "task_plan done"
}

func init() {
	types.RegisterTool(TaskPlanDeclaration, func() types.ToolInterface {
		return &TaskPlanTool{}
	})
}
