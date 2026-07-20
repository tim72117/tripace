// 外部服務健康檢查(GET /admin/api/health/external)。列出這個系統依賴的
// 所有外部服務,逐項檢查健康狀態並回傳結果,供管理員手動觸發診斷用——不做
// 定時輪詢,只在管理員打開頁面/按下「重新檢查」時才會實際發出探測請求。
//
// 目前盤點到的外部依賴(來源皆已在程式碼中確認):
//   - PostgreSQL/SQLite 資料庫:internal/store,DATABASE_URL 未設時退回本機
//     SQLite 檔案。兩者都用同一個 store.Ping 檢查連線是否存活。
//   - LLM provider:internal/llm/want_analyzer.go 依 AI_PROVIDER 決定用
//     vllm(VLLM_BASE_URL,自架服務)還是 googleapis(GOOGLE_API_KEY,Gemini)。
//     依實際設定的 provider 只檢查對應那一個,不會兩個都打。
//   - Google Places API:internal/geo/places.go 與 internal/wanttools 的
//     geocode.go/recommend_nearby.go,金鑰來自 GOOGLE_PLACES_API_KEY(與
//     GOOGLE_API_KEY 是不同把 key,分別對應 Places 與 Gemini 兩個服務)。
package adminconsole

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/tim72117/tripace/internal/adminauth"
)

// 單項檢查的逾時,以及整體檢查(所有項目併發跑完)的逾時。個別檢查逾時只影響
// 該筆結果標記為 error,不影響其他項目。
const (
	perCheckTimeout = 5 * time.Second
	overallTimeout  = 8 * time.Second
)

// ExternalServiceStatus 是單一外部服務的健康檢查結果。
type ExternalServiceStatus struct {
	Name      string `json:"name"`      // 顯示名稱
	Kind      string `json:"kind"`      // db / llm / places
	Status    string `json:"status"`    // ok / error / skipped
	LatencyMs int64  `json:"latencyMs"` // 探測耗時(毫秒);skipped 時為 0
	Detail    string `json:"detail"`    // 錯誤訊息,或補充說明(如「未設定 XXX,略過」)
}

// healthCheck 是一項可執行的健康檢查:name/kind 是靜態描述,run 實際發出探測。
type healthCheck struct {
	name string
	kind string
	run  func(ctx context.Context) (status, detail string)
}

// listExternalHealth 回傳 GET /admin/api/health/external:併發執行所有已知
// 外部服務的健康檢查,單項逾時 perCheckTimeout,整體不超過 overallTimeout。
func (h *Handler) listExternalHealth(w http.ResponseWriter, r *http.Request, _ *adminauth.Admin) {
	checks := []healthCheck{
		{name: "PostgreSQL / SQLite 資料庫", kind: "db", run: h.checkDatabase},
		{name: llmCheckName(), kind: "llm", run: checkLLM},
		{name: "Google Places API", kind: "places", run: checkPlaces},
	}

	results := make([]ExternalServiceStatus, len(checks))
	var wg sync.WaitGroup

	overallCtx, cancel := context.WithTimeout(r.Context(), overallTimeout)
	defer cancel()

	for i, c := range checks {
		wg.Add(1)
		go func(i int, c healthCheck) {
			defer wg.Done()
			results[i] = runOne(overallCtx, c)
		}(i, c)
	}

	// 用 channel 包一層,讓「整體逾時」也能保護 handler 本身不被卡死
	// (理論上不會發生,因為每個 goroutine 各自也受 overallCtx 節制;
	// 這裡純粹是雙重保險,避免任何一項檢查的實作疏漏拖垮整支 API)。
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-overallCtx.Done():
	}

	writeJSON(w, http.StatusOK, results)
}

// runOne 執行單一檢查,套用單項逾時,並統一量測延遲、組裝回應格式。
func runOne(parent context.Context, c healthCheck) ExternalServiceStatus {
	ctx, cancel := context.WithTimeout(parent, perCheckTimeout)
	defer cancel()

	start := time.Now()
	status, detail := c.run(ctx)
	latency := time.Since(start).Milliseconds()

	// skipped 的情況(環境變數未設定)延遲沒有意義,固定為 0,避免誤導成
	// 「探測花了幾毫秒才判斷略過」。
	if status == "skipped" {
		latency = 0
	}
	return ExternalServiceStatus{Name: c.name, Kind: c.kind, Status: status, LatencyMs: latency, Detail: detail}
}

// --- 資料庫 ------------------------------------------------------------
//
// 檢查方式:直接用現有連線做 PingContext(等同一次輕量 SELECT/連線往返),
// 不建立新連線、不查任何資料表。免費、無額外成本。

func (h *Handler) checkDatabase(ctx context.Context) (status, detail string) {
	if err := h.Store.Ping(ctx); err != nil {
		return "error", err.Error()
	}
	return "ok", ""
}

// --- LLM provider --------------------------------------------------------
//
// 依 AI_PROVIDER 決定檢查哪一個(與 want_analyzer.go NewWant() 讀的是同一組
// 環境變數,確保「健康檢查打的服務」與「實際服務請求會用到的服務」一致)。
//
//   - vllm:GET {VLLM_BASE_URL}/v1/models——OpenAI 相容的 models 列表端點,
//     純 metadata 查詢,不觸發任何推論,免費。
//   - googleapis(Gemini):GET https://generativelanguage.googleapis.com/
//     v1beta/models?key=...——Gemini API 的 ListModels 端點,同樣是純
//     metadata 查詢(列出可用模型),不消耗任何生成 token,Google 官方文件
//     未將其列入計費項目,故本檢查方式免費。刻意不呼叫任何 generateContent
//     端點(那才會計費/耗用 token)。
//   - 其他/未知 AI_PROVIDER 值:視為未設定,回 skipped。
func llmCheckName() string {
	switch os.Getenv("AI_PROVIDER") {
	case "vllm":
		return "LLM Provider (vLLM)"
	case "googleapis":
		return "LLM Provider (Gemini / googleapis)"
	default:
		return "LLM Provider"
	}
}

func checkLLM(ctx context.Context) (status, detail string) {
	provider := os.Getenv("AI_PROVIDER")
	switch provider {
	case "vllm":
		base := os.Getenv("VLLM_BASE_URL")
		if base == "" {
			return "skipped", "未設定 VLLM_BASE_URL,略過"
		}
		return probeGET(ctx, base+"/v1/models", nil)
	case "googleapis":
		key := os.Getenv("GOOGLE_API_KEY")
		if key == "" {
			return "skipped", "未設定 GOOGLE_API_KEY,略過"
		}
		url := "https://generativelanguage.googleapis.com/v1beta/models?key=" + key
		return probeGET(ctx, url, nil)
	case "":
		return "skipped", "未設定 AI_PROVIDER,略過"
	default:
		return "skipped", fmt.Sprintf("未知的 AI_PROVIDER=%q,略過", provider)
	}
}

// --- Google Places API -----------------------------------------------------
//
// 檢查方式:呼叫 Places API (New) 的 Text Search(POST
// https://places.googleapis.com/v1/places:searchText),與 internal/geo/
// places.go 用的是同一支端點——Google 並未提供不計費的探測/ping 端點。
// 為把成本壓到最低:
//   - fieldMask 只要 "places.id"(Essentials 等級中最小的欄位),對應 Google
//     公告的 Essentials IDs Only 費率,是該端點目前費用最低的呼叫方式。
//   - pageSize=1、textQuery 用固定的通用地標字串("Taipei 101"),每次檢查
//     只送出一次請求。
//
// 成本說明:這會產生「每次手動按下健康檢查都呼叫一次 Places Text Search
// (Essentials 等級)」的微量費用。因為此檢查刻意不做定時輪詢、只在管理員
// 手動觸發時執行,故該費用可接受,但**不是完全免費**,與 DB/vLLM/Gemini
// ListModels 的檢查方式不同,在此明確標註。
func checkPlaces(ctx context.Context) (status, detail string) {
	key := os.Getenv("GOOGLE_PLACES_API_KEY")
	if key == "" {
		return "skipped", "未設定 GOOGLE_PLACES_API_KEY,略過"
	}

	body := []byte(`{"textQuery":"Taipei 101","pageSize":1}`)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://places.googleapis.com/v1/places:searchText", bytes.NewReader(body))
	if err != nil {
		return "error", err.Error()
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", key)
	// 只要 place id:Places API (New) 最低費率的欄位遮罩(Essentials IDs Only),
	// 比 places.go 平常用的 displayName/formattedAddress/location 遮罩更省。
	req.Header.Set("X-Goog-FieldMask", "places.id")

	client := &http.Client{Timeout: perCheckTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return "error", err.Error()
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "error", fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	return "ok", "已呼叫 Places Text Search(Essentials 等級,產生微量費用)"
}

// --- 共用小工具 --------------------------------------------------------

// probeGET 對 url 發一個輕量 GET,只看是否連得上、回應碼是否為 2xx,不解析
// body(健康檢查不需要內容,只需要「服務有沒有回應」)。
func probeGET(ctx context.Context, url string, headers map[string]string) (status, detail string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "error", err.Error()
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	client := &http.Client{Timeout: perCheckTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return "error", err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "error", fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	return "ok", ""
}
