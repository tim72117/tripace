// Package onagenttools 收斂 onagent 平台 BackendDispatch 型工具的伺服器端
// 執行邏輯——跟 internal/api 分開,理由同 internal/wanttools 跟 internal/api
// 分開的既有慣例:單一工具的業務邏輯(參數解析、驗證、實際查詢)不該混進
// api package 裡跟一般 HTTP handler 並列,應該獨立成專屬套件,api 層只負責
// 掛路由、轉發 request/response。
//
// 每個工具各自一個檔案(recommend_nearby.go、geocode.go、…),這個檔案只放
// 所有工具共用的 BackendDispatch request/response 協定形狀,見
// server/tools/onagent-tools.yaml 的 backendDispatch 欄位、
// docs/backend-dispatch-integration-guide-2026-08-10.md 與
// docs/backend-tool-dispatch-design-2026-08-08.md(皆在 onagent repo,
// c:\www\my\agent——這個套件只存在於 tripace 這側,故不重複那些文件)。
//
// # 這批 BackendDispatch 工具的刻意限縮範圍
//
//   - 沒有簽章驗證。設計文件 §3/§5(HMAC-SHA256 + Key-Id 雙金鑰輪替)這裡
//     沒有實作,因為 onagent 平台那側目前也還沒實作——依 operator 指南,
//     目前的 onagent build 送出的是明文、未簽章的請求(「完全沒有認證/
//     簽章」)。針對 onagent 根本不會送的 header 寫驗證程式碼只會是永遠
//     測不到的死碼。待辦:onagent 實際送出 X-Onagent-Signature 等 header
//     後,再補上 HMAC 驗證。
//   - 沿用跟對應 want 工具舊版(internal/wanttools/*.go)完全相同的底層
//     查詢邏輯(同一套 geo.Client + GOOGLE_PLACES_API_KEY 呼叫、同樣的
//     結果形狀),只是 transport/觸發方式不同(onagent HTTP dispatch,而非
//     want 的行程內工具呼叫)。
package onagenttools

import (
	"encoding/json"
	"net/http"
)

// DispatchRequest mirrors the BackendDispatch request body shape from the
// integration guide: {"toolName":"...", "args": {...}}.
type DispatchRequest struct {
	ToolName string                 `json:"toolName"`
	Args     map[string]interface{} `json:"args"`
}

// decodeJSON 是每個 Handle* 共用的請求解析步驟——沒有 toolName 路由邏輯
// (見 api.go 直接把各工具的路由指到各自的 Handle* handler,不透過一個
// 共用的 dispatch 函式依 toolName 分派,故這裡不需要檢查 body.ToolName)。
func decodeJSON(r *http.Request, dst *DispatchRequest) error {
	return json.NewDecoder(r.Body).Decode(dst)
}

// writeOK/writeErr follow the BackendDispatch response contract verbatim
// (see the integration guide's "Response" sections) —
// {"ok":true,"result":...} / {"ok":false,"error":"..."}. This is a
// different shape from internal/api's own writeErr ({"error":{"code",
// "message"}}), so it can't reuse that helper; onagent parses its own
// dispatch responses against its own contract, not tripace's.
func writeOK(w http.ResponseWriter, result any) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "result": result})
}

func writeErr(w http.ResponseWriter, code int, message string) {
	writeJSON(w, code, map[string]any{"ok": false, "error": message})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
