package llm

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/channel/server/internal/model"

	// blank import:觸發自訂 want 工具的 init() 註冊(record_entry 等)。
	_ "github.com/channel/server/internal/wanttools"

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

// RecordIfRelevant 讓 agent 處理一則訊息,自主決定是否用 record_entry 記成條目。
// 跑完整 agent 流程(允許工具呼叫),以 idle 為完成訊號。非阻塞收訊息主流程時應放 goroutine。
func (w *WantAnalyzer) RecordIfRelevant(text string) {
	w.mu.Lock()
	defer w.mu.Unlock()

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
- datetime:從訊息中解析出的事件時間,格式 'YYYY-MM-DD HH:MM'。相對時間(如「明天」「週五早上十點」)請依今天日期換算成絕對日期。訊息沒提到時間就留空字串。

如果只是閒聊、問句或沒有可記錄的具體事項,就不要呼叫工具,直接簡短回覆即可。

使用者訊息:%s`, today, weekday, text)
}

func weekdayZH(d time.Weekday) string {
	names := [...]string{"星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"}
	return names[d]
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
