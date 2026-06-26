// Package wanttools 提供註冊到 want 引擎的自訂 agent 工具。
// 被 blank import 時,init() 會把工具註冊進 want 的全域 toolbox,
// 之後 LLM agent 在推論時即可呼叫(general role 的 Tools: ["*"] 允許所有工具)。
package wanttools

import (
	"fmt"
	"strings"
	"time"

	"want/types"
)

func init() {
	types.RegisterTool(RecordEntryDeclaration, func() types.ToolInterface {
		return &RecordEntryTool{}
	})
}

// RecordEntryDeclaration 是給 LLM 看的工具宣告。
// 事件時間由 LLM 從訊息解析,支援單一時間點、時間範圍與全日事件;
// 系統另記錄 recorded_at(寫入當下時間)作為審計用。
var RecordEntryDeclaration = types.ToolDeclaration{
	Name: "record_entry",
	Description: "將一則項目記錄成帶有日期時間的條目並保存。" +
		"當使用者想把訊息存成待辦、行程、備忘或日誌條目時使用。每呼叫一次新增一筆。" +
		"請從訊息解析出事件的時間,可以是單一時間點、時間範圍或全日事件。",
	Type: "sync",
	Parameters: map[string]interface{}{
		"type": "OBJECT",
		"properties": map[string]interface{}{
			"item": map[string]interface{}{
				"type":        "STRING",
				"description": "要記錄的事項內容(去掉時間後的描述),例如:'開會討論 Q3 預算'",
			},
			"start": map[string]interface{}{
				"type": "STRING",
				"description": "事件【日期】,用英文自然語言語詞表達(只給日期,不含時刻),系統自動換算。" +
					"例如:'next Monday'、'tomorrow'、'this Friday'、'in 3 days'、'June 30'。" +
					"不要自己算日期。沒提到日期就留空字串。",
			},
			"startTime": map[string]interface{}{
				"type": "STRING",
				"description": "事件開始的時刻,24 小時制 'HH:MM'(如 '10:00'、'15:30')。" +
					"從使用者訊息直接取時刻,不要換算。沒提到時刻(全日事件)就留空字串。",
			},
			"end": map[string]interface{}{
				"type": "STRING",
				"description": "事件結束【日期】,格式同 start(英文日期語詞)。" +
					"只有表達日期範圍(如「6/30 到 7/2」)時才填,否則留空字串。",
			},
			"endTime": map[string]interface{}{
				"type": "STRING",
				"description": "事件結束的時刻,24 小時制 'HH:MM'。" +
					"只有表達時刻範圍(如「三點到五點」)時才填,否則留空字串。",
			},
		},
		"required": []string{"item"},
	},
}

type RecordEntryTool struct {
	types.BaseToolConfig
}

// Call 執行工具:回傳 []ResultContentBlock(want 新規格);
// 結果資料(原 ToolUseResult)改由 ctx.EmitToolResult 主動發送。
func (t *RecordEntryTool) Call(args types.ToolArguments, ctx types.ToolContext) ([]types.ResultContentBlock, error) {
	item := args.GetString("item")
	if item == "" {
		return nil, fmt.Errorf("item 不可為空")
	}

	// 事件時間:LLM 給「英文日期語詞」+「24h 時刻」。
	// when 只把日期語詞確定性換算成絕對日期(避免 LLM 算錯),時刻直接用 LLM 給的數字。
	now := time.Now()
	start := combineDateTime(args.GetString("start"), args.GetString("startTime"), now)
	end := combineDateTime(args.GetString("end"), args.GetString("endTime"), now)
	// 全日 = 有日期但沒時刻(start 只有 10 字 'YYYY-MM-DD')。
	allDay := len(start) == 10

	// 交給 sink 持久化(帶上當前記錄 context 的 channelID),取得新 entry ID。
	// tripID 一律留 nil(不自動歸組):歸組改由 LLM 判斷後呼叫 add_to_trip。
	entryID, err := emit(RecordedEntry{Item: item, Start: start, End: end, AllDay: allDay})
	if err != nil {
		return nil, fmt.Errorf("寫入條目失敗: %w", err)
	}

	resultMsg := fmt.Sprintf("已記錄(entryID=%s):%s %s", entryID, describeTime(start, end, allDay), item)

	// 查「時間區間符合」的候選 trip,列給 LLM 判斷是否歸入(後端不自動歸組)。
	suffix := tripCandidatesHint(entryID, start, end)
	if suffix != "" {
		resultMsg += "\n" + suffix
	}

	ctx.EmitToolResult(map[string]interface{}{
		"message": resultMsg,
		"entryID": entryID,
		"start":   start,
		"end":     end,
		"allDay":  allDay,
		"item":    item,
	})
	return []types.ResultContentBlock{types.TextBlock(resultMsg)}, nil
}

// tripCandidatesHint 查時間重疊的候選 trip,組成給 LLM 看的提示文字。
// 有候選時提示 LLM:可呼叫 add_to_trip 把這個 entry 歸入某個 trip(或新建)。
// 無候選 / store 未初始化 / 無時間,回空字串。
func tripCandidatesHint(entryID, start, end string) string {
	if entryStore == nil || start == "" {
		return ""
	}
	trips, err := entryStore.FindOverlappingTrips(CurrentChannel(), start, end)
	if err != nil || len(trips) == 0 {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("這個條目時間上可能屬於以下行程,若屬於其中之一,請呼叫 add_to_trip(entryID='")
	sb.WriteString(entryID)
	sb.WriteString("', tripID=...)歸入;若都不相關,可不歸入或新建:\n")
	for _, tr := range trips {
		rng := tr.Start
		if tr.End != "" {
			rng += " ~ " + tr.End
		}
		sb.WriteString("・tripID=" + tr.ID + " 「" + tr.Title + "」(" + rng + ")\n")
	}
	return strings.TrimRight(sb.String(), "\n")
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

// describeTime 把時間描述成人類可讀字串。
func describeTime(start, end string, allDay bool) string {
	switch {
	case start == "":
		return "(未指定時間)"
	case allDay && end != "":
		return start + " ~ " + end + "(全日)"
	case allDay:
		return start + "(全日)"
	case end != "":
		return start + " ~ " + end
	default:
		return start
	}
}
