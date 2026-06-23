package llm

import (
	"encoding/json"
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
	// LLM 失敗時的後備,確保收訊息流程不中斷。
	fallback RuleBasedAnalyzer
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

// RecordForMessage 讓 agent 處理一則訊息,自主決定是否用 record_entry 記成條目。
// 條目由 emit 同步寫入(entry 為主體);跑完後透過 linkEntries 把本次寫入的
// entry 與來源 messageID 建立多對多關聯(此訊息已先寫入)。
// linkEntries 由呼叫端提供(持有 store);傳 nil 表示不建立關聯。
// 跑完整 agent 流程(允許工具呼叫),以 idle 為完成訊號。非阻塞收訊息主流程時應放 goroutine。
func (w *WantAnalyzer) RecordForMessage(channelID, messageID, text string, linkEntries func(entryIDs []string) error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	// 全域序列化記錄流程,並設定本次條目要關聯的訊息(工具透過 context 取得)。
	wanttools.RecordLock()
	defer wanttools.RecordUnlock()
	wanttools.SetContext(messageID, channelID)
	defer wanttools.ClearContext()

	state := wantui.NewCommonInferenceState()
	done := make(chan struct{})
	var once sync.Once
	finish := func() { once.Do(func() { close(done) }) }

	unsub := w.coord.EventBus.Subscribe("agent.inference", func(payload interface{}) {
		result, handled := wantui.HandleInferenceMessage(payload, state)
		if !handled || result == nil {
			return
		}
		if vm, ok := result.(wantui.StatusViewModel); ok && vm.Status == "idle" {
			// 給工具呼叫後可能緊接的事件一點窗口再結束。
			go func() { time.Sleep(1500 * time.Millisecond); finish() }()
		}
	})
	defer unsub()

	w.coord.Submit(buildRecordPrompt(text))

	select {
	case <-done:
	case <-time.After(90 * time.Second):
		fmt.Printf("[want] RecordIfRelevant 逾時\n")
	}

	// agent 跑完:把本次同步寫入的 entry 關聯到來源 message(此訊息已先寫入)。
	if linkEntries != nil {
		if ids := wanttools.EmittedIDs(); len(ids) > 0 {
			if err := linkEntries(ids); err != nil {
				fmt.Printf("[want] 關聯 entry↔message 失敗: %v\n", err)
			}
		}
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
	Kind    string        // "recorded" | "answer"
	Text    string        // agent 的文字回應(已記錄時為確認語;回答時為答案)
	Logged  int           // 本次記錄的條目數
	Entries []AssistEntry // agent 用 present_entries 輸出的展示條目(供前端列表顯示)
}

// Assist 統一處理 owner 的輸入:在同一次完整 agent 推論裡,讓 LLM 自主決定
// 「這是提問就回答、是要記的事項就呼叫 record_entry」。
// 合併 generate(收集文字回應)與 RecordForMessage(設 context、允許工具、等 idle):
//   - 設 record context → agent 若 call record_entry,Entry 自動關聯到 messageID
//   - 跑完後以 wanttools.EmitCount() 判斷究竟記錄了還是只回答了
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
		// agent 記錄了條目:條目已由 emit 同步寫入(entry 為主體,獨立落庫)。
		// 此處只需寫入來源 message,並把它與本次寫入的 entry 建立關聯。
		// linkMessage 由呼叫端(api)提供:寫 message + 對 entryIDs 逐一 LinkEntryMessage。
		// 仍持有 RecordLock,EmittedIDs 有效。
		if linkMessage != nil {
			if err := linkMessage(wanttools.EmittedIDs()); err != nil {
				return AssistResult{Kind: "error", Text: "寫入訊息/關聯失敗: " + err.Error()}
			}
		}
		return AssistResult{Kind: "recorded", Text: answer, Logged: logged, Entries: presented}
	}
	return AssistResult{Kind: "answer", Text: answer, Logged: 0, Entries: presented}
}

// Classify 請 LLM 對訊息做分類/標注。LLM 失敗或無法解析時退回規則式。
func (w *WantAnalyzer) Classify(text string) Annotation {
	raw, err := w.generate(buildClassifyPrompt(text))
	if err != nil {
		fmt.Printf("[want] Classify 失敗,改用規則式: %v\n", err)
		return w.fallback.Classify(text)
	}
	ann, ok := parseClassifyJSON(raw)
	if !ok {
		fmt.Printf("[want] Classify 回應無法解析,改用規則式。原始: %s\n", truncate(raw, 200))
		return w.fallback.Classify(text)
	}
	return ann
}

// Answer 請 LLM 依頻道訊息回答自然語言查詢。
func (w *WantAnalyzer) Answer(question string, pool []model.Message) model.SearchAnswer {
	raw, err := w.generate(buildAnswerPrompt(question, pool))
	if err != nil {
		fmt.Printf("[want] Answer 失敗,改用規則式: %v\n", err)
		return w.fallback.Answer(question, pool)
	}
	// 回答為自由文字;引用來源沿用規則式檢索結果以提供 citedMessageIDs。
	cited := w.fallback.Answer(question, pool).CitedMessageIDs
	conf := 0.85
	return model.SearchAnswer{
		Answer:          strings.TrimSpace(raw),
		CitedMessageIDs: cited,
		Confidence:      &conf,
	}
}

// ---- prompt 與解析 ----

func buildRecordPrompt(text string) string {
	now := time.Now()
	today := now.Format("2006-01-02")
	weekday := weekdayZH(now.Weekday())
	return fmt.Sprintf(`今天是 %s(%s)。

以下是使用者在頻道發送的訊息。
如果訊息包含值得記錄的待辦、行程、會議、提醒或具體事項,請呼叫 record_entry 工具把它記錄成條目:
- item:簡潔的事項描述(去掉時間部分)。
- 事件時間請依下列三種情況填寫,相對時間(如「明天」「週五」)依今天日期換算成絕對日期:
  1. 單一時間點(如「下午三點開會」):start='YYYY-MM-DD HH:MM',allDay=false,end 留空。
  2. 時間範圍(如「三點到五點開會」「6/30 到 7/2 出差」):start 與 end 都填,有時刻用 'YYYY-MM-DD HH:MM',只有日期用 'YYYY-MM-DD'。
  3. 全日事件(只有日期、沒有時刻,如「6月30號休假」):start='YYYY-MM-DD',allDay=true。
  訊息完全沒提到時間:start 留空字串。

如果只是閒聊、問句或沒有可記錄的具體事項,就不要呼叫工具,直接簡短回覆即可。

使用者訊息:%s`, today, weekday, text)
}

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

func buildClassifyPrompt(text string) string {
	return fmt.Sprintf(`你是訊息分類助手。請閱讀以下訊息,只輸出 JSON(不要其他文字、不要 markdown):
{"category":"分類","tags":["標籤1","標籤2"],"summary":"一句話摘要或空字串"}

分類請從這幾種擇一:會議、任務、問題、公告、閒聊。
tags 為 0~4 個關鍵字。summary 僅在訊息較長時提供,否則空字串。

訊息:%s`, text)
}

func buildAnswerPrompt(question string, pool []model.Message) string {
	var sb strings.Builder
	sb.WriteString("你是頻道訊息查詢助手。以下是頻道中的訊息,請依據它們回答使用者的問題。\n\n訊息列表:\n")
	for _, m := range pool {
		sb.WriteString("・")
		sb.WriteString(m.AuthorName)
		sb.WriteString(": ")
		sb.WriteString(m.Text)
		sb.WriteString("\n")
	}
	sb.WriteString("\n使用者問題: ")
	sb.WriteString(question)
	sb.WriteString("\n\n請用繁體中文簡潔回答,只根據上述訊息,不要編造。")
	return sb.String()
}

// parseClassifyJSON 從 LLM 回應中抽出 JSON 並解析為 Annotation。
func parseClassifyJSON(raw string) (Annotation, bool) {
	start := strings.Index(raw, "{")
	end := strings.LastIndex(raw, "}")
	if start < 0 || end < 0 || end <= start {
		return Annotation{}, false
	}
	var parsed struct {
		Category string   `json:"category"`
		Tags     []string `json:"tags"`
		Summary  string   `json:"summary"`
	}
	if err := json.Unmarshal([]byte(raw[start:end+1]), &parsed); err != nil {
		return Annotation{}, false
	}
	ann := Annotation{Tags: parsed.Tags}
	if parsed.Category != "" {
		ann.Category = &parsed.Category
	}
	if s := strings.TrimSpace(parsed.Summary); s != "" {
		ann.Summary = &s
	}
	if ann.Tags == nil {
		ann.Tags = []string{}
	}
	return ann, true
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}
