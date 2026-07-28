// TestAssist_MockLLMInference_QueriesEntries 是 POST /v1/channels/{id}/assist
// 這個端點的預設推論測試(無 build tag,go test ./... 就會跑):完整走過真實的
// HTTP → api.handleAssist → llm.WantPool.AssistForSession →
// llm.WantAnalyzer.Assist → want 真實 orchestrator(Submit → dispatch →
// RunAgent → 工具分派 → EventBus)→ entry_query 工具 → 真的查(記憶體)
// SQLite → 真的透過 Hub 廣播 entries_loaded 事件——與
// assist_inference_real_llm_test.go(//go:build real_llm)測的是同一條鏈路,
// 差別只在鏈路末端:那邊接真的 vLLM,這邊接一個 in-process 的
// internal/mockllm.Server(劇本驅動的假 vLLM 後端)。
//
// 為什麼這是預設版、真 LLM 版才需要額外 tag:mockllm.Server 讓 want 的整條
// 真實整合機制照常運作,唯一被替換的是「背後決定下一步的是不是一個真的語言
// 模型」,故足以驗證本測試在意的所有事(HTTP 層邏輯是否正確、want 有沒有真的
// 分派到 entry_query、entries_loaded 廣播內容是否正確),且完全不需要外部
// LLM 服務、免費、決定性(劇本固定,不像真模型輸出會變動)、秒級完成——這正是
// docs/brainstorm/want-onagent-applayer-mitigations.md M18 最終想要的效果。
// 真 LLM 版仍然保留,用來偶爾驗證「真實模型會不會照 prompt 指示正確判斷、
// 正確呼叫工具」這件事,mockllm 版驗證不到(劇本是寫死的,不測 LLM 的判斷力)。
//
// 為什麼要接一個真的 WS 監聽,而不只看 HTTP 回應的文字:同 real_llm 版的理由
// ——entry_query 改造後(assistant_agent.go 的 queryThought)結果只透過
// entries_loaded 廣播給前端,HTTP 回應的 answer 純粹是模型(或這裡的劇本)
// 自己的一句確認語,不保證包含任何可斷言的結構化資訊。
package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/mockllm"

	"nhooyr.io/websocket"
)

// setMockLLMProviderEnv 讓 llm.NewWant()(讀 os.Getenv 決定要連哪個 provider)
// 連到 mockBaseURL 這個 in-process 的 mockllm.Server,而非真的 vLLM。
// t.Cleanup 還原成呼叫前的值,避免污染同一個測試 process 裡其他測試
// (例如 assist_inference_real_llm_test.go,若以 -tags real_llm 一起編譯進
// 同一個測試 binary,理論上會依序執行,但仍以幹淨還原為原則,不依賴執行順序)。
func setMockLLMProviderEnv(t *testing.T, mockBaseURL string) {
	t.Helper()
	for k, v := range map[string]string{
		"AI_PROVIDER":   "vllm",
		"AI_MODEL":      "mockllm-test",
		"VLLM_BASE_URL": mockBaseURL,
	} {
		prev, had := os.LookupEnv(k)
		if err := os.Setenv(k, v); err != nil {
			t.Fatalf("set env %s: %v", k, err)
		}
		t.Cleanup(func() {
			if had {
				os.Setenv(k, prev)
			} else {
				os.Unsetenv(k)
			}
		})
	}
}

func TestAssist_MockLLMInference_QueriesEntries(t *testing.T) {
	// 劇本:唯一一步呼叫 entry_query 查「今天」的範圍,接一句確認語結束——
	// 對齊 real_llm 版問「今天晚上有什麼安排?」時,真實模型依 assistant_agent.go
	// 的 queryThought 指引會做的事(把時間範圍拆成 from/to 兩個英文時間語詞)。
	// 劇本不讀取請求裡的使用者文字(mockllm 完全不解析 messages 的語意內容,
	// 見 script.go 開頭說明),故 HTTP 請求要送什麼問題文字都不影響這裡的行為
	// ——固定照劇本走。
	steps := []mockllm.Step{
		{ToolName: "entry_query", Input: map[string]interface{}{"from": "today", "to": "today"}},
		{FinalText: "已經幫你查好了，請看下方表格。"},
	}
	engine := mockllm.NewEngine(steps, nil)
	mockSrv := mockllm.NewServer(engine)
	mockTS := httptest.NewServer(mockSrv.Handler())
	defer mockTS.Close()

	setMockLLMProviderEnv(t, mockTS.URL)

	srv, _, ch := newInferenceTestServer(t)
	ts := httptest.NewServer(srv.Routes())
	defer ts.Close()

	// ---- 先接上 WS,才能不錯過待會 entry_query 觸發的 entries_loaded 廣播 ----
	wsCtx, wsCancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer wsCancel()
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/v1/channels/" + ch.ID + "/ws"
	conn, _, err := websocket.Dial(wsCtx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial channel ws: %v", err)
	}
	defer conn.CloseNow()

	entriesLoaded := make(chan []map[string]any, 1)
	go func() {
		for {
			_, data, err := conn.Read(wsCtx)
			if err != nil {
				return
			}
			var msg struct {
				Event   string           `json:"event"`
				Entries []map[string]any `json:"entries"`
			}
			if json.Unmarshal(data, &msg) == nil && msg.Event == "entries_loaded" {
				entriesLoaded <- msg.Entries
				return
			}
		}
	}()

	// ---- 真的送一次 HTTP 請求,觸發真的(劇本驅動的)推論 ----
	reqBody, _ := json.Marshal(map[string]string{
		"text": "今天晚上有什麼安排?",
		"lang": "zh-TW",
	})
	req, err := http.NewRequest(http.MethodPost, ts.URL+"/v1/channels/"+ch.ID+"/assist", bytes.NewReader(reqBody))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	// 20 秒足夠:mockllm 是本機 HTTP 呼叫,沒有真實網路延遲或模型推論時間,
	// 正常應該在幾百毫秒內完成整輪(Submit → dispatch → 工具呼叫 → idle →
	// 1.5 秒 settle window)。給的餘裕遠低於 real_llm 版的 96 秒。
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("assist request failed: %v", err)
	}
	defer resp.Body.Close()

	var result struct {
		Kind   string `json:"kind"`
		Answer string `json:"answer"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("HTTP status = %d, want 200；kind=%q answer=%q", resp.StatusCode, result.Kind, result.Answer)
	}

	// 核心斷言一:劇本只呼叫 entry_query,EmitCount 應為 0,kind 應為 answer。
	// 劇本是決定性的,這裡可以(也應該)斷得比 real_llm 版更嚴格。
	if result.Kind != "answer" {
		t.Fatalf("kind = %q, want %q", result.Kind, "answer")
	}
	if result.Answer != "已經幫你查好了，請看下方表格。" {
		t.Fatalf("answer = %q, want 劇本裡設定的 FinalText(劇本決定性,應完全相符)", result.Answer)
	}

	// 核心斷言二:entry_query 真的查了 DB、真的透過 Hub 廣播了正確結果。
	select {
	case entries := <-entriesLoaded:
		found := false
		for _, e := range entries {
			if title, _ := e["title"].(string); title == seededEntryTitle {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("entries_loaded 廣播了 %d 筆，但沒有找到事先種入的 %q", len(entries), seededEntryTitle)
		}
	case <-wsCtx.Done():
		t.Fatal("等待 entries_loaded 廣播逾時——entry_query 可能沒有被呼叫，或呼叫了但查詢範圍沒蓋到今天")
	}
}
