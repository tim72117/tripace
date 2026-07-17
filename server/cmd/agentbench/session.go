// Session 是 agentbench 的核心資源:代表一次獨立的測試設定
// (帶著自己的 thought 文字、開放的工具清單、自己的 *wantorch.Orchestrator)。
//
// 隔離設計:每個 session 各自擁有一個獨立的 orchestrator 實例,而不是共用單一
// orchestrator 動態切換 prompt builder。理由(詳見調查結論):
//   - want 的 GlobalEngine(AI provider)/GlobalToolbox(工具註冊表)/
//     defaultAgentLoader(角色定義來源)雖是 process 級單例,但實際「這次推論該
//     用哪個 system prompt / 哪些工具」是透過 role 名稱(字串)當 key 查找
//     (loader.BuiltInAgents[role]),且每次 RunAgent 都重新查一次、不快取
//     built-in 定義。故只要每個 session 使用彼此不同的 role 名稱字串,
//     PATCH 一個 session 的 thought 只會覆寫該 session 自己的 role 定義,
//     不會影響其他 session。
//   - 每個 Orchestrator 有自己的 EventBus(orchestrator.go: NewOrchestrator
//     裡 EventBus: events.NewEventBus()),彼此的工具呼叫/文字/狀態事件
//     不會互相流竄。
//   - orch.SetPromptBuilder / orch.SetSessionEnvs 是 per-orchestrator 欄位,
//     多個 session 各自獨立呼叫不會互相覆寫。
//   - 這樣每個 session 可以真正同時、平行地各自送出 run 請求而不必共用一把鎖
//     序列化(共用單一 orchestrator 動態換 prompt 的做法,如
//     server/internal/llm/want_analyzer.go,則需要 mutex 序列化所有呼叫,
//     多個 session 無法真正同時推論)。
//   - 代價是每個 session 需要一個獨立的 role 名稱字串與 orchestrator 實例,
//     但建立成本低(NewOrchestrator 只是啟動幾個 goroutine/channel),
//     這是低流量開發工具,正確性與隔離性優先於這點額外成本。
package main

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	wantconfig "github.com/tim72117/want/config"
	wantorch "github.com/tim72117/want/orchestrator"

	"github.com/tim72117/want/pkg/agentreg"
)

// Session 代表一次獨立的測試設定。
type Session struct {
	ID      string
	Created time.Time

	// mu 序列化對這個 session 的操作(PATCH thought 與 run 之間、以及兩個並發
	// run 之間都不應該交錯:同一個 orchestrator 實例一次只處理一輪推論)。
	mu sync.Mutex

	role    string   // 這個 session 專屬的 want role 名稱(agentreg 註冊用的 key)
	thought string   // 目前生效的 system prompt 文字(對應 thoughtVersions[activeVersion-1].Thought)
	tools   []string // 目前開放給 LLM 呼叫的工具名稱清單

	// thoughtVersions 記錄這個 session 從建立以來所有 thought 版本,依序 append,
	// 版本號 = 在這個切片裡的索引 + 1(從 1 開始,不是 0-based,對外呈現的版本號
	// 更直覺)。建立 session 時的初始 thought 是版本 1;之後每次 PATCH(不論帶
	// thought 字串還是 officialThoughtLang)都追加一個新版本。
	//
	// activeVersion 是目前生效的版本號(對應 thoughtVersions 的某個索引+1)。
	// 正常情況下 activeVersion 永遠等於 len(thoughtVersions)(最新版本生效);
	// 呼叫「切換版本」API 後,activeVersion 可以指向較舊的版本號,此時
	// s.thought 會同步改成該版本的內容(重新註冊 AgentDefinition),但
	// thoughtVersions 本身不會被截斷或修改——「切回舊版」本身也不產生新版本,
	// 只是改變目前生效的指標。
	thoughtVersions []ThoughtVersion
	activeVersion   int

	// expected 是可選的「預期目標」設定:nil 表示這個 session 不做目標判斷,
	// 維持「只回傳完整 tool call 讓外部軟體自己判斷」的原始模式。
	expected *Expected

	// history 是這個 session 累積的完整推論歷程(含因未達成 expected 而
	// 自動觸發的追問輪),依發生順序附加。只存在記憶體裡,session 被刪除或
	// process 重啟就消失——這是開發用除錯工具,不需要真正的持久化儲存。
	history []HistoryEntry

	orch *wantorch.Orchestrator
}

// ThoughtVersion 是這個 session 曾經生效過的一個 thought 版本快照。
// Version 從 1 開始,對應 Session.thoughtVersions 切片裡「索引+1」的位置。
type ThoughtVersion struct {
	Version int       `json:"version"`
	Thought string    `json:"thought"`
	Created time.Time `json:"created"`
}

// SessionManager 管理所有 session(記憶體內,process 存活期間有效;
// 沒有任何持久化,重啟 agentbench 就會清空——這是純開發用的除錯工具,
// 不需要跨重啟保存測試設定)。
type SessionManager struct {
	mu       sync.Mutex
	sessions map[string]*Session
	nextID   int

	settings *wantconfig.Settings // 所有 session 共用的 LLM provider 設定(來自環境變數)
}

// NewSessionManager 用給定的 LLM provider 設定建立一個空的 session 管理器。
func NewSessionManager(settings *wantconfig.Settings) *SessionManager {
	return &SessionManager{
		sessions: make(map[string]*Session),
		settings: settings,
	}
}

// CreateSessionInput 是 POST /sessions 的 request body。
// Expected 為可選欄位:不帶就代表這次 session 不做目標判斷。
//
// Thought 與 OfficialThoughtLang 是取得 thought 內容的兩種擇一方式:
//   - Thought 有值 → 直接採用(維持原本手動貼字串的行為不變,向後相容)。
//   - Thought 為空、OfficialThoughtLang 有值 → 透過 officialthought.go 的
//     子程序機制取得 shuttle 正式 LLM agent 的 system prompt,存進 session
//     內部的 thought 欄位(見 Session.thought)。之後這個 session 的
//     thought 就是這份存好的副本,不會每次都重新呼叫子程序——只有建立時
//     (這裡)與明確 PATCH 時(見 PatchInput)才會觸發子程序呼叫。
//   - 兩者都空 → 視為錯誤(沒有可用的 thought 內容)。
type CreateSessionInput struct {
	Thought             string    `json:"thought"`
	OfficialThoughtLang string    `json:"officialThoughtLang"`
	Tools               []string  `json:"tools"`
	Expected            *Expected `json:"expected"`
}

// resolveThought 依 CreateSessionInput/PatchInput 共通的「Thought 優先、
// 否則若有語言代碼就呼叫子程序取得正式 thought」規則,決定這次要採用的
// thought 字串。thought 有值時 lang 會被忽略(不觸發子程序呼叫)。
//
// thought、lang 都是空字串時回傳錯誤——沒有任何可用的 thought 來源。
func resolveThought(thought, lang string) (string, error) {
	if strings.TrimSpace(thought) != "" {
		return thought, nil
	}
	if strings.TrimSpace(lang) == "" {
		return "", errors.New("thought 與 officialThoughtLang 至少需要提供一個")
	}
	return fetchOfficialThought(lang)
}

// SessionView 是回給呼叫端看的 session 狀態(GET /sessions/{id} 與建立後的回應共用)。
// History 讓外部推論軟體不需要自己手動記錄/拼接每輪 run 的結果,
// 隨時查詢就能拿到這個 session 到目前為止累積的完整歷程。
//
// Thought 保留(等於目前生效版本的內容),向後相容既有呼叫端;
// ThoughtVersions/ActiveVersion 是新增的版本歷史清單與目前生效版本號。
type SessionView struct {
	ID              string           `json:"id"`
	Created         time.Time        `json:"created"`
	Thought         string           `json:"thought"`
	ThoughtVersions []ThoughtVersion `json:"thoughtVersions"`
	ActiveVersion   int              `json:"activeVersion"`
	Tools           []string         `json:"tools"`
	Expected        *Expected        `json:"expected"`
	History         []HistoryEntry   `json:"history"`
}

// unknownToolError 讓呼叫端清楚知道打錯字的工具名稱,而不是悄悄被忽略。
type unknownToolError struct{ name string }

func (e *unknownToolError) Error() string {
	return fmt.Sprintf("unknown tool %q; available: %v", e.name, mockToolNames)
}

// validateTools 檢查 names 裡每個工具名稱是否都是 agentbench 已註冊的 mock 工具,
// 避免使用者拼錯工具名稱時,agent 端只是默默拿不到該工具、卻毫無提示。
func validateTools(names []string) error {
	known := make(map[string]bool, len(mockToolNames))
	for _, n := range mockToolNames {
		known[n] = true
	}
	for _, n := range names {
		if !known[n] {
			return &unknownToolError{name: n}
		}
	}
	return nil
}

// Create 建立一個新 session:分配一個全新、僅供這個 session 使用的 role 名稱,
// 用 agentreg.Register 註冊對應的 AgentDefinition(Thought/Tools),
// 再用 wantorch.SetupWith 建立這個 session 專屬的 orchestrator。
//
// thought 內容依 resolveThought 規則決定:in.Thought 有值就直接採用;
// 否則若 in.OfficialThoughtLang 有值,觸發一次 fetchOfficialThought 子程序
// 呼叫取得正式 thought,把結果存進這個 session 的內部欄位(s.thought)。
// 這是「只有第一次載入才呼叫子程序」的唯一觸發點之一(另一處是 Patch)。
func (m *SessionManager) Create(in CreateSessionInput) (*Session, error) {
	if err := validateTools(in.Tools); err != nil {
		return nil, err
	}

	thought, err := resolveThought(in.Thought, in.OfficialThoughtLang)
	if err != nil {
		return nil, err
	}

	m.mu.Lock()
	m.nextID++
	id := fmt.Sprintf("sess_%d", m.nextID)
	m.mu.Unlock()

	// role 名稱只在本 process 內部當 registry key 用,不會對外曝光,
	// 用 session id 當字尾確保每個 session 彼此不同、不會互相覆寫對方的定義。
	role := "agentbench_" + id

	registerAgentDefinition(role, thought, in.Tools)

	orch := wantorch.SetupWith(m.settings, role)

	created := time.Now()
	s := &Session{
		ID:      id,
		Created: created,
		role:    role,
		thought: thought,
		tools:   in.Tools,
		thoughtVersions: []ThoughtVersion{
			{Version: 1, Thought: thought, Created: created},
		},
		activeVersion: 1,
		expected:      in.Expected,
		orch:          orch,
	}

	m.mu.Lock()
	m.sessions[id] = s
	m.mu.Unlock()

	return s, nil
}

// Get 依 id 取回 session;找不到回 nil, false。
func (m *SessionManager) Get(id string) (*Session, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	return s, ok
}

// Delete 移除 session。want 的 orchestrator 沒有提供顯式的「關閉/釋放」方法
// (背景 goroutine 是 for range channel,without Close 也不會忙等 CPU;
// 讓它們保持存活、只是不再被任何 map 引用,GC 之後會回收),故這裡只需要
// 把 session 從 map 移除即可,不需要額外呼叫 orch 的任何清理方法。
func (m *SessionManager) Delete(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.sessions[id]; !ok {
		return false
	}
	delete(m.sessions, id)
	return true
}

// View 把 Session 轉成回應用的 SessionView(含目前累積的完整推論歷程)。
func (s *Session) View() SessionView {
	s.mu.Lock()
	defer s.mu.Unlock()
	return SessionView{
		ID:              s.ID,
		Created:         s.Created,
		Thought:         s.thought,
		ThoughtVersions: append([]ThoughtVersion{}, s.thoughtVersions...),
		ActiveVersion:   s.activeVersion,
		Tools:           append([]string{}, s.tools...),
		Expected:        s.expected,
		History:         append([]HistoryEntry{}, s.history...),
	}
}

// PatchInput 是 PATCH /sessions/{id} 的 request body。
// Thought 為 nil 表示不修改 thought;Tools 為 nil 表示不修改工具清單;
// Expected 為 nil 表示不修改預期目標設定(用指標/nil slice 判斷是否有帶欄位,
// 而非用空字串/空陣列——避免「使用者故意清空」與「沒有帶這個欄位」無法區分)。
//
// Thought 與 OfficialThoughtLang 同 CreateSessionInput 的擇一規則:
//   - Thought 非 nil → 直接採用它的值(不論 OfficialThoughtLang 是否也有帶,
//     Thought 優先),不觸發子程序呼叫。
//   - Thought 為 nil、OfficialThoughtLang 非 nil → 重新呼叫一次子程序取得
//     最新的正式 thought,更新這個 session 內部存的字串。這是「重新整理」
//     的概念:每次 PATCH 帶 OfficialThoughtLang 才會真的重新問一次子程序,
//     並非每次 run 都問。
//   - 兩者皆為 nil → 不修改 thought(維持原本行為)。
type PatchInput struct {
	Thought             *string   `json:"thought"`
	OfficialThoughtLang *string   `json:"officialThoughtLang"`
	Tools               []string  `json:"tools"`
	Expected            *Expected `json:"expected"`
}

// Patch 更新這個 session 的 thought / 工具清單 / 預期目標設定,重新註冊
// AgentDefinition。不需要重建 orchestrator:want 的 AgentLoader.GetAgent
// 對 built-in 角色定義每次都重新查 map(不快取),故下一次 Submit 就會立刻
// 套用新定義(見 want/internal/loader.go GetAgent:磁碟找不到對應
// .agents/<role>.md 檔案時一定會落到 `if hasBuiltIn { return builtIn, nil }`
// 這條路徑,不經過 cache)。
//
// thought 版本記錄規則:只有這次 PATCH 有帶 Thought 或 OfficialThoughtLang
// (亦即確實算出一個要套用的 newThought)才會把 newThought 追加成
// thoughtVersions 的新一筆,並把 activeVersion 指向它;沒帶任何 thought
// 相關欄位時,newThought 等於 s.thought 不變,不新增版本(hasNewThought 判斷)。
func (s *Session) Patch(in PatchInput) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	newThought := s.thought
	hasNewThought := in.Thought != nil || in.OfficialThoughtLang != nil
	switch {
	case in.Thought != nil:
		newThought = *in.Thought
	case in.OfficialThoughtLang != nil:
		// 只有明確帶 officialThoughtLang(且沒帶 thought)才重新呼叫子程序,
		// 取得最新的正式 thought 內容,更新這個 session 存的副本。
		t, err := fetchOfficialThought(*in.OfficialThoughtLang)
		if err != nil {
			return err
		}
		newThought = t
	}

	newTools := s.tools
	if in.Tools != nil {
		if err := validateTools(in.Tools); err != nil {
			return err
		}
		newTools = in.Tools
	}

	registerAgentDefinition(s.role, newThought, newTools)

	s.thought = newThought
	s.tools = newTools
	if hasNewThought {
		s.thoughtVersions = append(s.thoughtVersions, ThoughtVersion{
			Version: len(s.thoughtVersions) + 1,
			Thought: newThought,
			Created: time.Now(),
		})
		s.activeVersion = len(s.thoughtVersions)
	}
	if in.Expected != nil {
		s.expected = in.Expected
	}
	return nil
}

// ActivateVersion 把 session 目前生效的 thought 切換成 thoughtVersions 裡
// 版本號為 version 的內容(不追加新版本,只改變 activeVersion 指標與
// s.thought,並重新註冊 AgentDefinition 讓下一次 Run 生效)。
// version 超出範圍(< 1 或 > len(thoughtVersions))回傳清楚的錯誤。
func (s *Session) ActivateVersion(version int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if version < 1 || version > len(s.thoughtVersions) {
		return fmt.Errorf("thought version %d 不存在;目前共有 %d 個版本(1-%d)", version, len(s.thoughtVersions), len(s.thoughtVersions))
	}

	target := s.thoughtVersions[version-1]

	registerAgentDefinition(s.role, target.Thought, s.tools)

	s.thought = target.Thought
	s.activeVersion = version
	return nil
}

// Run 送出一次輸入文字,同步阻塞等待這次推論完全結束後回傳完整結果。
// mu 確保同一個 session 不會被兩個並發的 run 交錯呼叫(不同 session 之間
// 各自有獨立的 orchestrator,可以真正同時執行、互不阻塞)。
//
// 若這個 session 設定了 expected 且原始這輪沒有達成,會在同一次呼叫內
// 自動對同一個 orchestrator 再送出一則追問文字(見 goal.go
// followUpQuestion),觸發它再推論一次取得說明——呼叫端不需要另外觸發。
// 追問輪與原始輪都會附加進 s.history。
func (s *Session) Run(input string) RunResult {
	s.mu.Lock()
	defer s.mu.Unlock()

	result := runInference(s.orch, input)

	outcome := evaluateGoal(result.ToolCalls, s.expected)
	var met *bool
	if outcome != nil {
		m := outcome.Met
		met = &m
	}
	result.GoalMet = met

	s.history = append(s.history, HistoryEntry{
		Input:      input,
		ToolCalls:  result.ToolCalls,
		Text:       result.Text,
		GoalMet:    met,
		IsFollowUp: false,
	})

	// 只有「有設定 expected 且原始這輪未達成」才觸發追問;
	// session 沒設定 expected(met == nil)或已達成(*met == true)都不追問,
	// 維持向後相容:沒設定 expected 時,整段追問邏輯完全不會執行。
	if met != nil && !*met {
		question := followUpQuestion(s.expected, outcome)

		followUpResult := runInference(s.orch, question)

		s.history = append(s.history, HistoryEntry{
			Input:      question,
			ToolCalls:  followUpResult.ToolCalls,
			Text:       followUpResult.Text,
			GoalMet:    nil, // 追問輪本身不重新判斷 goalMet:goalMet 只反映原始推論
			IsFollowUp: true,
		})

		result.FollowUp = &FollowUpView{Question: question, Answer: followUpResult.Text}
	}

	return result
}

// registerAgentDefinition 把 role/thought/tools 註冊(或覆寫)進 want 的
// process 級預設 AgentLoader(agentreg.DefaultLoader())。
//
// PromptBuilder 刻意採用「方式 C:閉包當策略,完全取代」(同
// server/internal/llm/assistant_agent.go 的做法):system prompt 只等於
// 這個 role 的 Thought 本身,不串接 want 的通用段落(header/工作目錄/
// 工具使用規則等)。這樣「PATCH thought 後重跑」才能精準對應「使用者這次
// 提供的 thought 文字」,不會被其他隱藏的 prompt 片段干擾測試結果的判斷。
func registerAgentDefinition(role, thought string, tools []string) {
	agentreg.Register(agentreg.DefaultLoader(), role, &agentreg.AgentDefinition{
		Role:    role,
		Tools:   tools,
		Thought: thought,
		PromptBuilder: agentreg.PromptBuilderFunc(func(a *agentreg.Agent, c *agentreg.ToolUseContext) string {
			return a.SystemPrompt
		}),
	})
}
