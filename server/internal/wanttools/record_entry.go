// Package wanttools 提供註冊到 want 引擎的自訂 agent 工具。
// 被 blank import 時,init() 會把工具註冊進 want 的全域 toolbox,
// 之後 LLM agent 在推論時即可呼叫(general role 的 Tools: ["*"] 允許所有工具)。
package wanttools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"want/types"
)

// 條目寫入的檔名(位於 agent 工作目錄下)。
const entriesFileName = "entries.jsonl"

func init() {
	types.RegisterTool(RecordEntryDeclaration, func() types.ToolInterface {
		return &RecordEntryTool{}
	})
}

// RecordEntryDeclaration 是給 LLM 看的工具宣告。
// datetime 由 LLM 從使用者訊息「解析」出來(事件發生的時間);
// 系統另記錄 recorded_at(寫入當下時間)作為審計用。
var RecordEntryDeclaration = types.ToolDeclaration{
	Name: "record_entry",
	Description: "將一則項目記錄成帶有日期時間的條目,寫入記事檔。" +
		"當使用者想把訊息存成待辦、行程、備忘或日誌條目時使用。每呼叫一次新增一筆。" +
		"請從使用者訊息中解析出事件的時間並填入 datetime。",
	Type: "sync",
	Parameters: map[string]interface{}{
		"type": "OBJECT",
		"properties": map[string]interface{}{
			"item": map[string]interface{}{
				"type":        "STRING",
				"description": "要記錄的事項內容(去掉時間後的描述),例如:'開會討論 Q3 預算'",
			},
			"datetime": map[string]interface{}{
				"type": "STRING",
				"description": "從訊息解析出的事件日期時間,格式 'YYYY-MM-DD HH:MM'。" +
					"相對時間(如「明天」「週五早上十點」)請依提供的今天日期換算成絕對日期。" +
					"若只有日期沒有時刻,時間補 00:00。若訊息完全沒提到時間,留空字串。",
			},
		},
		"required": []string{"item"},
	},
}

type RecordEntryTool struct {
	types.BaseToolConfig
}

func (t *RecordEntryTool) Call(args types.ToolArguments, ctx types.ToolContext) (types.ToolCallResult, error) {
	return t.Execute(context.Background(), args, ctx)
}

func (t *RecordEntryTool) RenderToolUse(args types.ToolArguments) string {
	return fmt.Sprintf("正在記錄條目:%s", args.GetString("item"))
}

func (t *RecordEntryTool) RenderToolUseError(err error) string {
	return fmt.Sprintf("記錄條目失敗:%v", err)
}

func (t *RecordEntryTool) RenderToolResult(data map[string]interface{}) string {
	if msg, ok := data["message"].(string); ok {
		return msg
	}
	return "已記錄條目"
}

// entry 是寫入記事檔的一筆條目。
type entry struct {
	// Datetime 是 LLM 從訊息解析出的事件時間(YYYY-MM-DD HH:MM);訊息未提及時間則為空。
	Datetime string `json:"datetime"`
	// Item 是事項描述(去掉時間後)。
	Item string `json:"item"`
	// RecordedAt 是寫入當下的系統時間,審計用。
	RecordedAt string `json:"recorded_at"`
}

func (t *RecordEntryTool) Execute(_ context.Context, args types.ToolArguments, ctx types.ToolContext) (types.ToolCallResult, error) {
	item := args.GetString("item")
	if item == "" {
		return types.ToolCallResult{}, fmt.Errorf("item 不可為空")
	}

	// datetime 由 LLM 從使用者訊息解析(可能為空,表示訊息未提及時間)。
	eventTime := args.GetString("datetime")

	e := entry{
		Datetime:   eventTime,
		Item:       item,
		RecordedAt: time.Now().Format("2006-01-02 15:04:05"),
	}

	// 條目寫到 agent 工作目錄下的記事檔。
	dir := ctx.GetWorkingDirectory()
	if dir == "" {
		dir, _ = os.Getwd()
	}
	path := filepath.Join(dir, entriesFileName)

	// 一行一筆 JSON(用 encoder 確保特殊字元安全跳脫)。
	jsonBytes, err := json.Marshal(e)
	if err != nil {
		return types.ToolCallResult{}, fmt.Errorf("序列化條目失敗: %w", err)
	}

	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return types.ToolCallResult{}, fmt.Errorf("開啟記事檔失敗: %w", err)
	}
	defer f.Close()
	if _, err := f.Write(append(jsonBytes, '\n')); err != nil {
		return types.ToolCallResult{}, fmt.Errorf("寫入記事檔失敗: %w", err)
	}

	when := eventTime
	if when == "" {
		when = "(未指定時間)"
	}
	resultMsg := fmt.Sprintf("已記錄:%s %s", when, item)
	return types.ToolCallResult{
		Content: []types.ResultContentBlock{types.TextBlock(resultMsg)},
		ToolUseResult: map[string]interface{}{
			"message":  resultMsg,
			"datetime": eventTime,
			"item":     item,
			"file":     path,
		},
	}, nil
}
