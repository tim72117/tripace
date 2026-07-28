// runInference 驅動一次完整推論並收集結果:依序發生的所有 tool call
// (工具名稱、參數摘要)、最終文字回應。
//
// 事件解析模式沿用 server/internal/llm/want_analyzer.go 已驗證過的做法:
// 訂閱 orchestrator 的 "agent.inference" 主題,用
// want/ui.HandleInferenceMessage 解析各種事件型別,StatusViewModel{Status:"idle"}
// 表示本輪推論結束。
//
// 與 want_analyzer.go 的差異(want v0.2.0 起的能力落差,非本檔案疏漏):
// 原本這裡直接型別斷言 *types.ToolUseMessage 讀 Content.ToolUse.Input(結構化
// 參數,types.ToolArguments),取得「呼叫了哪個工具、參數是什麼」。want
// v0.2.0 把 ToolUseMessage/ToolUseResultMessage/ToolUseErrorMessage/
// AgentErrorMessage 這幾個事件型別移入 internal/types,模組外部已無法再對
// orchestrator 事件 payload 做這些具體型別斷言。改用官方建議的
// ui.HandleInferenceMessage 取得 ToolUseViewModel 後,發現該 ViewModel 只帶
// RenderToolUse(args) 渲染過的文字描述(ToolUse string 欄位),沒有任何欄位
// 攜帶原始結構化參數——已確認整個 want v0.2.0 模組沒有其他公開 API 能取得
// 這份資料(不是這裡沒找到,是上游這個版本真的沒有對外公開)。故
// ToolCall.Input 這次改動後恆為 nil(見該欄位的欄位註解),goal.go 的比對
// 邏輯也相應降級為只比對工具名稱、不再比對參數值。
//
// ToolUseViewModel 是「同一個 CallID 的呼叫在整個生命週期裡的同一份、逐步
// 補完」的物件(want ui/handler.go 內部用 InferenceState 依 CallID 累積):
// 初次出現時只有 Name/ToolUse(渲染後的呼叫描述)有值;結果或錯誤事件到達時
// 同一個 CallID 的 vm 會補上 Result/Data——成功結果 Data 非 nil(內容即
// ctx.EmitToolResult 給的那份 map,與改動前 ToolCall.Result 語意完全相同);
// 錯誤時 Data 明確設為 nil、Result 帶渲染後的錯誤文字(見 want
// ui/handler.go 對 ToolUseErrorMessage 的處理)。本函式靠 Data 是否為 nil
// 分辨「成功」與「錯誤」,是目前唯一可用的公開訊號,略脆弱(依賴 want ui
// 套件目前的實作細節,而非型別系統保證),但已確認 tripace 與 agentbench
// 註冊的所有工具都一律用非 nil 的 map[string]interface{} 呼叫
// EmitToolResult,實務上可靠。
//
// AgentErrorMessage(整輪推論失敗,非個別工具呼叫失敗)在新版 ui/handler.go
// 裡被轉成一個 CallID 固定為 "SYSTEM" 的合成 ToolUseViewModel(Result 帶
// 渲染後的錯誤文字,含 ANSI 顏色碼)——本函式用這個固定 CallID 識別,取代
// 原本直接讀 *types.AgentErrorMessage.Error 的做法。
//
// 中間推理文字:調查 want/ui/handler.go 與 types/message.go 後確認,
// orchestrator 對外只公開「工具呼叫」「工具結果」「最終文字」「狀態」「錯誤」
// 「usage」幾種事件,沒有任何型別對應「LLM 思考過程」這種中間推理文字
// (want 目前的 provider 實作也未見有暴露 reasoning/thinking 內容的機制)。
// 故本檔案不嘗試補這塊,如需求所述,沒有就不做,不臆測。
package main

import (
	"encoding/json"
	"strings"
	"sync"
	"time"

	wantorch "github.com/tim72117/want/orchestrator"
	wantui "github.com/tim72117/want/ui"
)

// ToolCall 是一次推論裡,agent 呼叫的其中一個工具:依發生順序記錄。
type ToolCall struct {
	Name string `json:"name"`
	// Input 保留欄位形狀(向後相容既有回應格式的消費端),但 want v0.2.0 起
	// 恆為 nil——上游已不再對外公開工具呼叫的原始結構化參數,只剩渲染過的
	// 文字描述,見本檔案頂部的說明。若未來 want 補回公開 API,這裡應優先復原。
	Input map[string]interface{} `json:"input"`
	// Result 是工具執行後的結果(來自 ctx.EmitToolResult)。
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

// stripANSI 去掉 want ui/handler.go 對錯誤文字固定加上的兩段顏色碼
// (\x1b[31m/\x1b[0m,見該檔案對 AgentErrorMessage/ToolUseErrorMessage 的
// 處理),讓寫進 JSON 回應的錯誤訊息維持改動前的乾淨字串,不含終端機控制碼。
// 只處理這兩個已知的固定序列,不是通用 ANSI stripper。
func stripANSI(s string) string {
	s = strings.ReplaceAll(s, "\x1b[31m", "")
	s = strings.ReplaceAll(s, "\x1b[0m", "")
	return s
}

// runInference 送出 input 給 orch,同步阻塞等待這次推論完全結束,回傳完整結果。
// 呼叫端(session.go 的 Session.Run)需自行序列化同一個 orchestrator 的呼叫,
// 避免同一個 session 內兩個 run 交錯(見 Session.mu)。
func runInference(orch *wantorch.Orchestrator, input string) RunResult {
	state := wantui.NewCommonInferenceState()

	var mu sync.Mutex
	var calls []ToolCall
	// indexByID 記錄每個 CallID 對應到 calls 裡的索引位置:同一個 CallID 的
	// ToolUseViewModel 會在其生命週期內收到多次回呼(初次呼叫→結果/錯誤,
	// 見本檔案頂部說明),用這個 map 判斷是否已經有對應的 ToolCall
	// (有則更新 Result/Error,沒有則新增)。
	indexByID := map[string]int{}
	var textBuilder []string
	var runErr string

	done := make(chan struct{})
	var once sync.Once
	finish := func() { once.Do(func() { close(done) }) }

	unsub := orch.Subscribe("agent.inference", func(payload interface{}) {
		mu.Lock()
		defer mu.Unlock()

		result, handled := wantui.HandleInferenceMessage(payload, state)
		if !handled || result == nil {
			return
		}
		switch vm := result.(type) {
		case wantui.TextViewModel:
			if vm.Content != "" {
				textBuilder = append(textBuilder, vm.Content)
			}
		case wantui.ToolUseViewModel:
			if vm.CallID == "SYSTEM" {
				// AgentErrorMessage 的合成 ViewModel(見本檔案頂部說明)。
				runErr = stripANSI(vm.Result)
				return
			}
			idx, ok := indexByID[vm.CallID]
			if !ok {
				idx = len(calls)
				indexByID[vm.CallID] = idx
				calls = append(calls, ToolCall{Name: vm.Name})
			}
			switch {
			case vm.Data != nil:
				// 成功結果:Data 即 ctx.EmitToolResult 給的原始 map,
				// 與改動前 ToolCall.Result 語意完全相同。
				calls[idx].Result = vm.Data
			case vm.Result != "":
				// Data 明確為 nil 且 Result 非空:錯誤事件(見 want
				// ui/handler.go 對 ToolUseErrorMessage 的處理)。
				calls[idx].Error = vm.Result
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
