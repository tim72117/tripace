package wanttools

import (
	"fmt"

	"want/types"
)

type AddToTripTool struct {
	types.BaseToolConfig
}

// ValidateInput 在執行前驗證:entryID 不可為空。
func (t *AddToTripTool) ValidateInput(args types.ToolArguments, _ types.ToolContext) error {
	if args.GetString("entryID") == "" {
		return fmt.Errorf("entryID 不可為空")
	}
	return nil
}

// Call 把 entry 歸入行程:有 tripID 則加入該既有行程;
// 無 tripID 則新建一個行程(用 entry 的時間範圍當初值)再加入。
// 回傳 []ResultContentBlock(want 新規格),結果 map 以 ctx.EmitToolResult 發送。
func (t *AddToTripTool) Call(args types.ToolArguments, ctx types.ToolContext) ([]types.ResultContentBlock, error) {
	if tripService == nil {
		return nil, fmt.Errorf("行程服務未初始化")
	}
	entryID := args.GetString("entryID")
	// 歸入/新建邏輯統一由 tripsvc 處理(與 CLI 共用);tripID 留空則新建,
	// tripTitle 為新建時的行程名(留空則 tripsvc 用 entry.Item)。
	tripID, _, err := tripService.AddToTrip(entryID, args.GetString("tripID"), args.GetString("tripTitle"))
	if err != nil {
		return nil, fmt.Errorf("歸入行程失敗: %w", err)
	}

	msg := fmt.Sprintf("已把條目 %s 歸入行程 %s", entryID, tripID)
	ctx.EmitToolResult(map[string]interface{}{
		"message": msg,
		"entryID": entryID,
		"tripID":  tripID,
	})
	return []types.ResultContentBlock{types.TextBlock(msg)}, nil
}

func (t *AddToTripTool) RenderToolUse(args types.ToolArguments) string {
	if args.GetString("tripID") == "" {
		return fmt.Sprintf("正在為條目 %s 新建行程", args.GetString("entryID"))
	}
	return fmt.Sprintf("正在把條目 %s 歸入行程 %s", args.GetString("entryID"), args.GetString("tripID"))
}

func (t *AddToTripTool) RenderToolUseError(err error) string {
	return fmt.Sprintf("歸入行程失敗:%v", err)
}

func (t *AddToTripTool) RenderToolResult(data map[string]interface{}) string {
	if msg, ok := data["message"].(string); ok {
		return msg
	}
	return "已歸入行程"
}

// AddToTripDeclaration 是給 LLM 看的工具宣告。
// 在 record_entry 列出候選行程後,由 LLM 判斷該條目屬於哪個行程時呼叫。
var AddToTripDeclaration = types.ToolDeclaration{
	Name: "add_to_trip",
	Description: "把一個已記錄的條目歸入某個行程(Trip),用於把同一趟旅程/連續安排的條目串在一起。" +
		"當 record_entry 列出了時間相符的候選行程、且你判斷該條目確實屬於其中之一時呼叫;" +
		"若都不相關但仍想成組,可不指定 tripID 以新建行程。",
	Type: "sync",
	Parameters: map[string]interface{}{
		"type": "OBJECT",
		"properties": map[string]interface{}{
			"entryID": map[string]interface{}{
				"type":        "STRING",
				"description": "要歸入行程的條目 ID(record_entry 結果中提供的 entryID,如 'ent_xxxx')。",
			},
			"tripID": map[string]interface{}{
				"type": "STRING",
				"description": "要歸入的既有行程 ID(record_entry 候選清單中提供的 tripID,如 'trip_xxxx')。" +
					"留空字串表示新建一個行程。",
			},
			"tripTitle": map[string]interface{}{
				"type":        "STRING",
				"description": "新建行程時的行程名(僅 tripID 留空時使用),如 '東京旅遊'。留空則用條目描述。",
			},
		},
		"required": []string{"entryID"},
	},
}

func init() {
	types.RegisterTool(AddToTripDeclaration, func() types.ToolInterface {
		return &AddToTripTool{}
	})
}
