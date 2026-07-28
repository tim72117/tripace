//go:build real_llm

// TestAssist_RealInference_QueriesEntries 是 POST /v1/channels/{id}/assist 這個
// 端點的「不用 mock」推論測試:完整走過真實的 HTTP → api.handleAssist →
// llm.WantPool.AssistForSession → llm.WantAnalyzer.Assist → want orchestrator
// → 真正的 vLLM provider(見 server/.env 的 AI_PROVIDER=vllm/VLLM_BASE_URL)
// → entry_query 工具 → 真的查(記憶體)SQLite → 真的透過 Hub 廣播
// entries_loaded 事件——這條鏈路上沒有任何一段是假的,除了 DB 用 in-memory
// SQLite(換掉 Postgres 純粹是測試環境考量)。
//
// 為什麼測「查詢」而非「記錄」:記錄流程(trip_entry_add)已改造成透過
// clienttools WebSocket 轉發到瀏覽器分頁執行(見 internal/clienttools/tool.go
// 的 forwardingTool),沒有一個活的「假瀏覽器」回應器,工具呼叫必定失敗
// (已實測驗證:LLM 正確嘗試呼叫 trip_entry_add,但因無 WS asker 註冊而報
// tool error,最終退回 answer)。entry_query 不同:它是 fire-and-forget 對
// Hub 廣播 entries_loaded(見 entry_query.go 的 Call 實作),不等待、也不需要
// 任何人在監聽就會成功,故可以在沒有 clienttools mock 的情況下端對端驗證。
//
// 為什麼要接一個真的 WS 監聽,而不只看 HTTP 回應的文字:entry_query 改造後
// (assistant_agent.go 的 queryThought)刻意不讓查詢結果流回 LLM 自己的文字
// 回覆——結果只透過 entries_loaded 廣播給前端,HTTP 回應的 answer 純粹是
// LLM 自己重新措辭的一句確認語(不保證包含任何可斷言的結構化資訊)。要證明
// 「entry_query 真的查到正確資料」,唯一確定性(不受 LLM 措辭影響)的信號
// 就是攔截這個廣播本身、比對其 payload。這裡接的是一個被動監聽的 WS
// client(用跟伺服器端相同的 nhooyr.io/websocket 函式庫直接連
// GET /v1/channels/{id}/ws),不是在扮演 clienttools 那種需要雙向應答的
// 「假瀏覽器」,複雜度跟 trip_entry_add 需要的 mock 不是同一個量級。
//
// 這是一個外部整合測試(依賴真的、可能是自架的 LLM 服務),用 //go:build
// real_llm 隔離,預設 go test ./... 不會編譯、更不會執行本檔案——避免在沒有
// 真實 provider 可用的機器/CI 上意外打真的網路呼叫。要跑本測試,明確帶
// go test -tags real_llm ./internal/api/...。同目的的預設(免外部依賴、快、
// 決定性)版本見 assist_inference_mockllm_test.go。
//
//   - AI_PROVIDER 未設定(.env 沒有配置真實 provider 的環境)時整個跳過,
//     即使帶了 -tags real_llm,也不讓沒配置的機器測試失敗。
//   - go test -short 時也跳過:一次推論含真實網路呼叫,耗時數秒到數十秒,
//     不適合放進快速迴圈。
//   - 斷言刻意避開 LLM 生成文字的具體內容(不可預期),只鎖兩件事:
//     (1) kind 是否為 answer(LLM 有沒有把提問正確判斷成查詢而非記錄),
//     (2) entries_loaded 廣播裡是否真的包含事先寫入的那筆已知 entry
//     (entry_query 有沒有真的查對資料)。
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

	"github.com/joho/godotenv"
	"nhooyr.io/websocket"
)

func TestAssist_RealInference_QueriesEntries(t *testing.T) {
	if testing.Short() {
		t.Skip("跳過:真實推論呼叫耗時數秒到數十秒，不適合 -short")
	}

	// go test 的工作目錄是套件自己的目錄(internal/api/)，不是 server/(main.go
	// 用 go run/建置後執行時的慣例工作目錄)，故不能像 main.go 一樣裸呼叫
	// godotenv.Load()，得明確指到 server/.env 的相對路徑。找不到檔案不算
	// 錯誤，同 main.go 的容忍策略——可能是透過其他方式(如 CI secret)注入。
	if err := godotenv.Load("../../.env"); err != nil && !os.IsNotExist(err) {
		t.Logf("載入 .env: %v", err)
	}
	if os.Getenv("AI_PROVIDER") == "" {
		t.Skip("跳過:未設定 AI_PROVIDER，這台機器沒有配置可用的真實 LLM provider")
	}

	srv, _, ch := newInferenceTestServer(t)
	ts := httptest.NewServer(srv.Routes())
	defer ts.Close()

	// ---- 先接上 WS,才能不錯過待會 entry_query 觸發的 entries_loaded 廣播 ----
	wsCtx, wsCancel := context.WithTimeout(context.Background(), 96*time.Second)
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

	// ---- 真的送一次 HTTP 請求，觸發真的推論 ----
	reqBody, _ := json.Marshal(map[string]string{
		"text": "今天晚上有什麼安排?",
		"lang": "zh-TW",
	})
	req, err := http.NewRequest(http.MethodPost, ts.URL+"/v1/channels/"+ch.ID+"/assist", bytes.NewReader(reqBody))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	// 96 秒:略高於 want_analyzer.go Assist 自身的 90 秒逾時上限，讓伺服器端的
	// 逾時邏輯(而非 client 端的 timeout)決定這次呼叫怎麼結束。
	client := &http.Client{Timeout: 96 * time.Second}
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

	// 核心斷言一:LLM 真的判斷這是「提問」，走 entry_query 而非誤判成記錄。
	// 不斷言 result.Answer 的具體內容(LLM 輸出不可預期，見檔案開頭說明)。
	if result.Kind != "answer" {
		t.Fatalf("kind = %q, want %q(LLM 未能把提問判斷為查詢；這是真實推論行為，可能反映 prompt 或模型本身的問題，非測試基礎設施錯誤)", result.Kind, "answer")
	}

	// 核心斷言二:entry_query 真的查了 DB、真的透過 Hub 廣播了正確結果——
	// 這個訊號完全繞過 LLM 自己的措辭，直接看工具實際執行的產出。
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
