package wanttools

import (
	"context"
	"fmt"

	"want/types"
)

func init() {
	types.RegisterTool(PresentEntriesDeclaration, func() types.ToolInterface {
		return &PresentEntriesTool{}
	})
}

// PresentEntriesDeclaration 是給 LLM 看的工具宣告。
// 把「要展示給使用者的一筆條目」輸出,前端用條目卡片顯示。
// 一次只傳一筆;要展示多筆就多次呼叫(multi tool call),參數刻意扁平,
// 小模型容易正確填寫(對齊 record_entry 的扁平參數)。
var PresentEntriesDeclaration = types.ToolDeclaration{
	Name: "present_entries",
	Description: "把一筆要展示給使用者的條目加入展示清單。" +
		"回答查詢、列出安排/待辦/行程時,每一筆條目呼叫一次此工具(有幾筆就呼叫幾次)," +
		"前端會把這些條目用卡片列表顯示,比純文字更清楚。",
	Type: "sync",
	Parameters: map[string]interface{}{
		"type": "OBJECT",
		"properties": map[string]interface{}{
			"item": map[string]interface{}{
				"type":        "STRING",
				"description": "事項描述,例如 '開會討論 Q3 預算'。",
			},
			"start": map[string]interface{}{
				"type":        "STRING",
				"description": "開始時間,'YYYY-MM-DD HH:MM' 或全日 'YYYY-MM-DD'。直接用查到的條目時間,不要自己換算。",
			},
			"end": map[string]interface{}{
				"type":        "STRING",
				"description": "結束時間,格式同 start;無則留空字串。",
			},
			"allDay": map[string]interface{}{
				"type":        "BOOLEAN",
				"description": "是否為全日事件。",
			},
		},
		"required": []string{"item"},
	},
}

type PresentEntriesTool struct {
	types.BaseToolConfig
}

func (t *PresentEntriesTool) Call(args types.ToolArguments, ctx types.ToolContext) (types.ToolCallResult, error) {
	return t.Execute(context.Background(), args, ctx)
}

// ValidateInput 在執行前驗證:item 不可為空(扁平參數,同 record_entry)。
func (t *PresentEntriesTool) ValidateInput(args types.ToolArguments, _ types.ToolContext) error {
	if args.GetString("item") == "" {
		return fmt.Errorf("item 不可為空")
	}
	return nil
}

func (t *PresentEntriesTool) RenderToolUse(args types.ToolArguments) string {
	return fmt.Sprintf("正在展示條目:%s", args.GetString("item"))
}

func (t *PresentEntriesTool) RenderToolUseError(err error) string {
	return fmt.Sprintf("展示條目失敗:%v", err)
}

func (t *PresentEntriesTool) RenderToolResult(data map[string]interface{}) string {
	if msg, ok := data["summary"].(string); ok {
		return msg
	}
	return "已加入展示"
}

func (t *PresentEntriesTool) Execute(_ context.Context, args types.ToolArguments, _ types.ToolContext) (types.ToolCallResult, error) {
	// 一次一筆;多筆由 agent 多次呼叫(multi tool call),addPresented 累積成清單。
	e := PresentedEntry{
		Item:   args.GetString("item"),
		Start:  args.GetString("start"),
		End:    args.GetString("end"),
		AllDay: args.GetBool("allDay"),
	}
	addPresented([]PresentedEntry{e})

	summary := fmt.Sprintf("已加入展示:%s", e.Item)
	return types.ToolCallResult{
		Content:       []types.ResultContentBlock{types.TextBlock(summary)},
		ToolUseResult: map[string]interface{}{"summary": summary},
	}, nil
}
