package llm

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/channel/server/internal/model"
	// 自訂 want 工具(record_entry):init() 註冊工具,並提供記錄 context/sink。
	"github.com/channel/server/internal/wanttools"

	wantorch "want/orchestrator"
	wanttypes "want/types"
	wantui "want/ui"
)

// WantAnalyzer 用 want 的 orchestrator(會自行載入 provider)實作 Analyzer。
// orchestrator 是事件驅動的:Submit 送出 prompt,透過 EventBus 收回應,
// 這裡把它包成同步的「prompt → text」。
type WantAnalyzer struct {
	coord *wantorch.Orchestrator
	// orchestrator 共享單一 agent 狀態,序列化呼叫避免交錯。
	mu sync.Mutex
}

// NewWant 用 want 的設定(server/configs/settings.json,啟動目錄須為 server)初始化 orchestrator。
// 初始化方式對齊 want/web/server.go。
func NewWant() (*WantAnalyzer, error) {
	wd, _ := os.Getwd()
	wanttypes.InitialWorkingDir = wd

	// 空 provider/model => 用 settings.json。
	// role 用 "assistant",want 會從 InitialWorkingDir/.agents/assistant.md 載入
	// (啟動目錄須為 server,故為 server/.agents/assistant.md)。
	coord := wantorch.Setup("", "", "", "assistant")
	coord.OnError(func(err error) {
		fmt.Printf("[want] 🔴 Agent Error: %v\n", err)
	})

	// 掛載各工具自帶的服務路由(同 web/server.go)。
	wanttypes.MountServices()

	return &WantAnalyzer{coord: coord}, nil
}

// generate 送一個 prompt,收集本次推論的完整文字回應。
// 事件解析沿用 want 官方的 ui.HandleInferenceMessage(與 web/server.go 一致):
// TextViewModel 為 assistant 文字;StatusViewModel{Status:"idle"} 表示推論結束。
func (w *WantAnalyzer) generate(prompt string) (string, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	state := wantui.NewCommonInferenceState()
	var mu sync.Mutex
	var sb strings.Builder
	done := make(chan struct{})
	var once sync.Once
	finish := func() { once.Do(func() { close(done) }) }

	unsub := w.coord.EventBus.Subscribe("agent.inference", func(payload interface{}) {
		mu.Lock()
		defer mu.Unlock()

		result, handled := wantui.HandleInferenceMessage(payload, state)
		if !handled || result == nil {
			return
		}
		switch vm := result.(type) {
		case wantui.TextViewModel:
			// 收到 assistant 文字即視為拿到答案。
			// (事件順序可能是 ...→idle→AgentMessage,文字會晚於 idle 到達。)
			if vm.Content != "" {
				sb.WriteString(vm.Content)
				finish()
			}
		case wantui.StatusViewModel:
			// idle 表示推論結束;但文字可能緊接其後才到,
			// 故延遲一小段再結束,給文字事件到達窗口。
			if vm.Status == "idle" {
				go func() {
					time.Sleep(1500 * time.Millisecond)
					finish()
				}()
			}
		}
	})
	defer unsub()

	w.coord.Submit(prompt)

	select {
	case <-done:
		mu.Lock()
		defer mu.Unlock()
		return sb.String(), nil
	case <-time.After(90 * time.Second):
		return "", fmt.Errorf("want 推論逾時")
	}
}

// AssistEntry 是 agent 用 present_entries 輸出、要展示給使用者的條目。
// 與 wanttools.PresentedEntry 同形,但定義在 llm 層,讓 api 不需依賴 wanttools。
type AssistEntry struct {
	Item   string `json:"item"`
	Start  string `json:"start"`
	End    string `json:"end"`
	AllDay bool   `json:"allDay"`
}

// AssistResult 是 owner 統一輸入的處理結果。
// Kind: "recorded"(agent 記錄了條目)或 "answer"(agent 回答了問題)。
type AssistResult struct {
	Kind     string        // "recorded" | "answer"
	Text     string        // agent 的文字回應(已記錄時為確認語;回答時為答案)
	Logged   int           // 本次記錄的條目數
	EntryIDs []string      // 本次記錄時 emit 同步寫入的 entry ID(供前端關聯/更新顯示)
	Entries  []AssistEntry // agent 用 present_entries 輸出的展示條目(供前端列表顯示)
}

// Assist 統一處理 owner 的輸入:在同一次完整 agent 推論裡,讓 LLM 自主決定
// 「這是提問就回答、是要記的事項就呼叫 record_entry」。
// 合併 generate(收集文字回應)與 RecordForMessage(設 context、允許工具、等 idle):
//   - 設 record context → agent 若 call record_entry,Entry 自動關聯到 messageID
//   - 跑完後以 wanttools.EmitCount() 判斷究竟記錄了還是只回答了
//
// linkMessage:agent 記錄了條目時,寫入來源 message 並把它與本次 emit 的
// entry(參數 entryIDs)建立多對多關聯。只回答時不呼叫。由 api 層提供(持有 store)。
func (w *WantAnalyzer) Assist(channelID, messageID, text string, linkMessage func(entryIDs []string) error) AssistResult {
	w.mu.Lock()
	defer w.mu.Unlock()

	wanttools.RecordLock()
	defer wanttools.RecordUnlock()
	wanttools.SetContext(messageID, channelID)
	defer wanttools.ClearContext()

	state := wantui.NewCommonInferenceState()
	var mu sync.Mutex
	var sb strings.Builder
	done := make(chan struct{})
	var once sync.Once
	finish := func() { once.Do(func() { close(done) }) }

	unsub := w.coord.EventBus.Subscribe("agent.inference", func(payload interface{}) {
		mu.Lock()
		defer mu.Unlock()
		result, handled := wantui.HandleInferenceMessage(payload, state)
		if !handled || result == nil {
			return
		}
		switch vm := result.(type) {
		case wantui.TextViewModel:
			if vm.Content != "" {
				sb.WriteString(vm.Content)
			}
		case wantui.StatusViewModel:
			// idle 表示推論結束;給工具呼叫/文字事件一點到達窗口再結束。
			if vm.Status == "idle" {
				go func() { time.Sleep(1500 * time.Millisecond); finish() }()
			}
		}
	})
	defer unsub()

	w.coord.Submit(buildAssistPrompt(text))

	select {
	case <-done:
	case <-time.After(90 * time.Second):
		fmt.Printf("[want] Assist 逾時\n")
	}

	mu.Lock()
	answer := strings.TrimSpace(sb.String())
	mu.Unlock()

	// 把 wanttools 的展示條目轉成 llm 層型別(讓 api 不需依賴 wanttools)。
	var presented []AssistEntry
	for _, e := range wanttools.Presented() {
		presented = append(presented, AssistEntry{
			Item: e.Item, Start: e.Start, End: e.End, AllDay: e.AllDay,
		})
	}

	logged := wanttools.EmitCount()
	if logged > 0 {
		// agent 記錄了條目:條目已由 emit 同步寫入(entry 為主體,獨立落庫於後端)。
		// 原話(message)不存後端,由前端存進裝置端 DB,故此處不寫 message。
		// linkMessage 保留為相容參數:若呼叫端提供(目前傳 nil),仍可建立關聯;
		// 預設不呼叫。回傳本次寫入的 entry ID 供前端更新顯示。
		ids := wanttools.EmittedIDs()
		if linkMessage != nil {
			if err := linkMessage(ids); err != nil {
				return AssistResult{Kind: "error", Text: "寫入訊息/關聯失敗: " + err.Error()}
			}
		}
		return AssistResult{Kind: "recorded", Text: answer, Logged: logged, EntryIDs: ids, Entries: presented}
	}
	return AssistResult{Kind: "answer", Text: answer, Logged: 0, Entries: presented}
}

// Answer 請 LLM 依頻道的 entry(事件/條目)回答自然語言查詢。
// LLM 失敗時回傳帶錯誤說明的 SearchAnswer(不再退回規則式)。
// 引用來源以輕量檢索(citeEntries)挑出相關 entry ID。
func (w *WantAnalyzer) Answer(question string, pool []model.Entry) model.SearchAnswer {
	raw, err := w.generate(buildAnswerPrompt(question, pool))
	if err != nil {
		fmt.Printf("[want] Answer 失敗: %v\n", err)
		conf := 0.0
		return model.SearchAnswer{
			Answer:          "查詢暫時無法完成,請稍後再試。",
			CitedMessageIDs: []string{},
			Confidence:      &conf,
		}
	}
	conf := 0.85
	return model.SearchAnswer{
		Answer:          strings.TrimSpace(raw),
		CitedMessageIDs: citeEntries(question, pool),
		Confidence:      &conf,
	}
}

// ---- prompt 與解析 ----


func weekdayZH(d time.Weekday) string {
	names := [...]string{"星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"}
	return names[d]
}

// buildAssistPrompt 給 owner 統一輸入用。
// 判斷「記錄 vs 回答」的指引在 assistant role(.agents/assistant.md)的 system prompt。
// 這裡只提供今天的日期與 owner 的輸入;頻道既有條目不再塞進 prompt——
// 提問時由 agent 自己呼叫 query_entries 工具查(可指定時間範圍)。
func buildAssistPrompt(text string) string {
	now := time.Now()
	today := now.Format("2006-01-02")
	weekday := weekdayZH(now.Weekday())
	return fmt.Sprintf("今天是 %s(%s)。\n\n使用者的輸入:%s", today, weekday, text)
}

func buildAnswerPrompt(question string, pool []model.Entry) string {
	var sb strings.Builder
	sb.WriteString("你是頻道條目查詢助手。以下是頻道中記錄的事件/條目,請依據它們回答使用者的問題。\n\n條目列表:\n")
	for _, e := range pool {
		sb.WriteString("・")
		sb.WriteString(e.Item)
		if e.Start != "" {
			sb.WriteString("(")
			sb.WriteString(e.Start)
			if e.End != "" {
				sb.WriteString(" ~ ")
				sb.WriteString(e.End)
			}
			sb.WriteString(")")
		}
		if e.Location != "" {
			sb.WriteString(" @")
			sb.WriteString(e.Location)
		}
		sb.WriteString("\n")
	}
	sb.WriteString("\n使用者問題: ")
	sb.WriteString(question)
	sb.WriteString("\n\n請用繁體中文簡潔回答,只根據上述條目,不要編造。")
	return sb.String()
}

