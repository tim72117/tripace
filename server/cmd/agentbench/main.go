// Command agentbench 是一個獨立的開發輔助工具:用來反覆測試 LLM agent 的
// system prompt(thought)推論能不能達成特定目標(例如「有沒有正確呼叫某個
// tool call」),透過本機 HTTP API 讓外部推論軟體(如 Claude Code)連接、
// 驅動測試、取得結果,還能中途調整測試設定反覆試驗。
//
// 這不是 shuttle 產品本身要對外提供的功能,也不是 want 套件
// (github.com/tim72117/want)內建的工具——是一個完全獨立的 cmd,
// 用來除錯 server/internal/llm/assistant_agent.go 定義的那份 thought。
//
// 執行方式:
//
//	go run ./cmd/agentbench
//
// 監聽位址預設 :8090(刻意跟主要的 cmd/server 預設 :8080 錯開,避免衝突),
// 可用 -addr flag 或 AGENTBENCH_ADDR 環境變數覆寫。
//
// LLM provider 設定沿用主要 server 同一套環境變數(AI_PROVIDER/AI_MODEL/
// VLLM_BASE_URL/OLLAMA_URL/GOOGLE_API_KEY/ANTHROPIC_API_KEY),
// 可直接複用 server/.env(啟動時會嘗試載入同目錄下的 .env,找不到不算錯誤)。
package main

import (
	"flag"
	"log"
	"net/http"
	"os"

	wantconfig "github.com/tim72117/want/config"
	wanttypes "github.com/tim72117/want/types"

	"github.com/joho/godotenv"
)

func main() {
	// 載入 .env(若存在):同 cmd/server/main.go 的做法,讓 AI_PROVIDER 等
	// 環境變數免手動 export,可直接複用 server/.env。找不到不算錯誤。
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		log.Printf("載入 .env: %v", err)
	}

	addr := flag.String("addr", ":8090", "HTTP 監聽位址(預設 :8090,避開 cmd/server 的 :8080)")
	flag.Parse()

	if v := os.Getenv("AGENTBENCH_ADDR"); v != "" {
		*addr = v
	}

	// want 需要 InitialWorkingDir 才能定位 .agents 目錄(掃描磁碟版角色定義)
	// 與預設 workspace;同 llm.NewWant() 的做法。
	wd, _ := os.Getwd()
	wanttypes.InitialWorkingDir = wd

	// 所有 session 共用同一份 LLM provider 設定(來自環境變數),
	// 同 server/internal/llm/want_analyzer.go NewWant() 的組裝方式。
	settings := &wantconfig.Settings{
		Provider:        os.Getenv("AI_PROVIDER"),
		Model:           os.Getenv("AI_MODEL"),
		VLLMBaseURL:     os.Getenv("VLLM_BASE_URL"),
		OllamaURL:       os.Getenv("OLLAMA_URL"),
		GoogleAPIKey:    os.Getenv("GOOGLE_API_KEY"),
		AnthropicAPIKey: os.Getenv("ANTHROPIC_API_KEY"),
	}

	if settings.Provider == "" {
		log.Printf("警告:未設定 AI_PROVIDER,建立 session 時 want 引擎初始化可能會失敗。" +
			"請設定 AI_PROVIDER/AI_MODEL 等環境變數(可複用 server/.env)。")
	}

	mgr := NewSessionManager(settings)

	mux := http.NewServeMux()
	registerRoutes(mux, mgr)

	log.Printf("agentbench 監聽 %s(provider=%s, model=%s)", *addr, settings.Provider, settings.Model)
	if err := http.ListenAndServe(*addr, mux); err != nil {
		log.Fatalf("agentbench server: %v", err)
	}
}
