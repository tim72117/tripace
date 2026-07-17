// runInference 驅動一次完整推論並收集結果:依序發生的所有 tool call
// (工具名稱、完整輸入參數)、最終文字回應。
//
// 事件解析模式沿用 server/internal/llm/want_analyzer.go 已驗證過的做法:
// 訂閱 orchestrator 的 EventBus 的 "agent.inference" 主題,用
// want/ui.HandleInferenceMessage 解析各種事件型別,StatusViewModel{Status:"idle"}
// 表示本輪推論結束。
//
// 與 want_analyzer.go 的差異:want_analyzer.go 只需要最終文字(TextViewModel),
// 這裡額外需要「呼叫了哪些工具、參數是什麼」,故直接型別斷言原始的
// *types.ToolUseMessage(拿 Content.ToolUse.Name / .Input,Input 是
// types.ToolArguments = map[string]interface{},可直接序列化成 JSON),
// 不透過 ui.HandleInferenceMessage 轉成的 ToolUseViewModel(那只有渲染過的
// 文字描述,沒有結構化參數)。文字回應仍照 want_analyzer.go 的方式,靠
// HandleInferenceMessage 解析 TextViewModel 取得。
//
// 中間推理文字:調查 want/ui/handler.go 與 types/message.go 後確認,
// orchestrator 對外只公開「工具呼叫」「工具結果」「最終文字」「狀態」「錯誤」
// 「usage」幾種事件,沒有任何型別對應「LLM 思考過程」這種中間推理文字
// (want 目前的 provider 實作也未見有暴露 reasoning/thinking 內容的機制)。
// 故本檔案不嘗試補這塊,如需求所述,沒有就不做,不臆測。
package main

import (
	"encoding/json"
	"sync"
	"time"

	wantorch "github.com/tim72117/want/orchestrator"
	wanttypes "github.com/tim72117/want/types"
	wantui "github.com/tim72117/want/ui"
)

// ToolCall 是一次推論裡,agent 呼叫的其中一個工具:依發生順序記錄。
type ToolCall struct {
	Name  string                  `json:"name"`
	Input wanttypes.ToolArguments `json:"input"`
	// Result 是工具執行後的結果(來自 ctx.EmitToolResult 或 Call 回傳的錯誤描述)。
	// 保留供除錯參考;需求本身只要求 Name/Input,故容許為 nil。
	Result map[string]interface{} `json:"result,omitempty"`
	Error  string                 `json:"error,omitempty"`
}

// RunResult 是 POST /sessions/{id}/run 的核心內容:本次推論的完整結果。
type RunResult struct {
	ToolCalls []ToolCall `json:"toolCalls"`
	Text      string     `json:"text"`
	// TimedOut 表示等到逾時仍未收到 idle 狀態(可能 LLM provider 掛了或設定錯誤);
	// 此時 ToolCalls/Text 是逾時當下已收集到的部分結果。
	TimedOut bool `json:"timedOut"`
	// Error 是本次推論過程中 orchestrator 回報的錯誤訊息(如 provider 呼叫失敗);
	// 空字串表示沒有錯誤。
	Error string `json:"error,omitempty"`

	// GoalMet 是這次(原始推論,不含追問輪)有沒有達成 session 設定的 expected 目標。
	// session 沒有設定 expected 時固定為 nil(不做目標判斷,維持向後相容行為)。
	GoalMet *bool `json:"goalMet"`
	// FollowUp 是「未達成 expected 目標」時,agentbench 自動追加送出的追問輪結果。
	// 沒有觸發追問(session 未設定 expected,或原始推論已達成目標)時為 nil。
	FollowUp *FollowUpView `json:"followUp,omitempty"`
}

// FollowUpView 是自動追問輪的結果:問了什麼、LLM 怎麼回答。
type FollowUpView struct {
	Question string `json:"question"`
	Answer   string `json:"answer"`
}

// HistoryEntry 是 session 推論歷程裡的其中一輪紀錄(可能是使用者觸發的
// 原始 run,也可能是因未達成 expected 目標而自動觸發的追問輪)。
type HistoryEntry struct {
	Input      string     `json:"input"`
	ToolCalls  []ToolCall `json:"toolCalls"`
	Text       string     `json:"text"`
	GoalMet    *bool      `json:"goalMet"`
	IsFollowUp bool       `json:"isFollowUp"`
}

// runTimeout 是單次推論等待完成的上限,同 want_analyzer.go 的 90 秒設定
// (LLM 呼叫 + 多輪工具呼叫在本機開發環境下應綽綽有餘)。
const runTimeout = 90 * time.Second

// idleGrace 是收到 idle 狀態後,額外等待「可能晚到的文字/工具事件」的緩衝時間,
// 同 want_analyzer.go 的做法與理由(事件順序可能是 ...→idle→文字才到)。
const idleGrace = 1500 * time.Millisecond

// runInference 送出 input 給 orch,同步阻塞等待這次推論完全結束,回傳完整結果。
// 呼叫端(session.go 的 Session.Run)需自行序列化同一個 orchestrator 的呼叫,
// 避免同一個 session 內兩個 run 交錯(見 Session.mu)。
func runInference(orch *wantorch.Orchestrator, input string) RunResult {
	state := wantui.NewCommonInferenceState()

	var mu sync.Mutex
	var calls []ToolCall
	// indexByID 記錄每個 callID 對應到 calls 裡的索引位置,供之後用 callID
	// 把結果併回對應的呼叫;工具呼叫(ToolUseMessage)與其結果
	// (ToolUseResultMessage/ToolUseErrorMessage)是兩個分開的事件,
	// 故先建立呼叫、事後補結果。
	indexByID := map[string]int{}
	var textBuilder []string
	var runErr string

	done := make(chan struct{})
	var once sync.Once
	finish := func() { once.Do(func() { close(done) }) }

	unsub := orch.EventBus.Subscribe("agent.inference", func(payload interface{}) {
		mu.Lock()
		defer mu.Unlock()

		// 先處理需要原始型別(而非 ui.HandleInferenceMessage 轉譯過的 ViewModel)
		// 才能取得的結構化資料:工具呼叫的完整輸入參數、工具結果/錯誤。
		switch raw := payload.(type) {
		case *wanttypes.ToolUseMessage:
			if raw.Content != nil && raw.Content.ToolUse != nil {
				tu := raw.Content.ToolUse
				indexByID[tu.ID] = len(calls)
				calls = append(calls, ToolCall{Name: tu.Name, Input: tu.Input})
			}
		case *wanttypes.ToolUseResultMessage:
			if idx, ok := indexByID[raw.CallID]; ok {
				calls[idx].Result = raw.Result
			}
		case *wanttypes.ToolUseErrorMessage:
			id := raw.Result.GetCallID()
			if idx, ok := indexByID[id]; ok {
				calls[idx].Error = raw.Result.GetToolName()
				if calls[idx].Error == "" {
					calls[idx].Error = "tool execution failed"
				}
			}
		case *wanttypes.AgentErrorMessage:
			runErr = raw.Error
		}

		// 再交給官方的 HandleInferenceMessage 取得文字回應與 idle 狀態
		// (同 want_analyzer.go 的用法;文字/狀態走這條路,不用自己重複解析)。
		result, handled := wantui.HandleInferenceMessage(payload, state)
		if !handled || result == nil {
			return
		}
		switch vm := result.(type) {
		case wantui.TextViewModel:
			if vm.Content != "" {
				textBuilder = append(textBuilder, vm.Content)
			}
		case wantui.StatusViewModel:
			if vm.Status == "idle" {
				go func() { time.Sleep(idleGrace); finish() }()
			}
		}
	})
	defer unsub()

	orch.Submit(input)

	timedOut := false
	select {
	case <-done:
	case <-time.After(runTimeout):
		timedOut = true
	}

	mu.Lock()
	defer mu.Unlock()

	text := ""
	for _, s := range textBuilder {
		text += s
	}

	// 確保 JSON 序列化時 toolCalls 是 []而非 null(沒呼叫任何工具時前端/呼叫端
	// 較容易處理一致的陣列型別,而不必額外判斷 null)。
	if calls == nil {
		calls = []ToolCall{}
	}

	return RunResult{
		ToolCalls: calls,
		Text:      text,
		TimedOut:  timedOut,
		Error:     runErr,
	}
}

// marshalIndent 是 handlers.go 共用的 JSON 輸出小工具(縮排方便人眼閱讀,
// 這是本機開發用的除錯工具,不追求最小 payload)。
func marshalIndent(v interface{}) ([]byte, error) {
	return json.MarshalIndent(v, "", "  ")
}
