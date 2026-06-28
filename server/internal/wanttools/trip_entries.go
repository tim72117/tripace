package wanttools

import (
	"fmt"
	"strings"

	"github.com/tim72117/want/types"
)

var TripEntriesDeclaration = types.ToolDeclaration{
	Name:        "trip_entries",
	Description: "列出指定行程（Trip）下的所有條目，包含時間、地點與類型。需先透過 list_trips 取得 tripID。",
	Type:        "sync",
	Parameters: map[string]interface{}{
		"type": "OBJECT",
		"properties": map[string]interface{}{
			"tripID": map[string]interface{}{
				"type":        "STRING",
				"description": "行程 ID（如 'trip_xxxx'）。",
			},
		},
		"required": []string{"tripID"},
	},
}

type TripEntriesTool struct {
	types.BaseToolConfig
}

func (t *TripEntriesTool) Call(args types.ToolArguments, ctx types.ToolContext) ([]types.ResultContentBlock, error) {
	if tripService == nil {
		return nil, fmt.Errorf("行程服務未初始化")
	}
	tripID := args.GetString("tripID")
	if tripID == "" {
		return nil, fmt.Errorf("tripID 不可為空")
	}
	entries, err := tripService.ListTripEntries(CurrentChannel(), tripID)
	if err != nil {
		return nil, fmt.Errorf("查詢條目失敗: %w", err)
	}
	if len(entries) == 0 {
		msg := fmt.Sprintf("行程 %s 下沒有條目", tripID)
		ctx.EmitToolResult(map[string]interface{}{"message": msg, "entries": []interface{}{}})
		return []types.ResultContentBlock{types.TextBlock(msg)}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("行程 %s 共 %d 筆條目：\n", tripID, len(entries)))
	entryList := make([]map[string]interface{}, 0, len(entries))
	for _, e := range entries {
		line := fmt.Sprintf("・%s", e.Item)
		if e.Start != "" {
			line += fmt.Sprintf("（%s", e.Start)
			if e.End != "" && e.End != e.Start {
				line += " ~ " + e.End
			}
			line += "）"
		}
		if e.Location != "" {
			line += " @ " + e.Location
		}
		sb.WriteString(line + "\n")
		entryList = append(entryList, map[string]interface{}{
			"entryID":  e.ID,
			"item":     e.Item,
			"start":    e.Start,
			"end":      e.End,
			"location": e.Location,
			"kind":     e.Kind,
		})
	}
	msg := strings.TrimRight(sb.String(), "\n")
	ctx.EmitToolResult(map[string]interface{}{"message": msg, "entries": entryList})
	return []types.ResultContentBlock{types.TextBlock(msg)}, nil
}

func (t *TripEntriesTool) RenderToolUse(args types.ToolArguments) string {
	return fmt.Sprintf("正在查詢行程 %s 的條目...", args.GetString("tripID"))
}

func (t *TripEntriesTool) RenderToolUseError(err error) string {
	return fmt.Sprintf("查詢條目失敗：%v", err)
}

func (t *TripEntriesTool) RenderToolResult(data map[string]interface{}) string {
	if msg, ok := data["message"].(string); ok {
		return msg
	}
	return "已取得行程條目"
}

func init() {
	types.RegisterTool(TripEntriesDeclaration, func() types.ToolInterface {
		return &TripEntriesTool{}
	})
}
