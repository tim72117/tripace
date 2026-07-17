// HTTP handler:純本機開發用途,不考慮認證/加密(同 CLAUDE.md 需求所述)。
// 每個 handler 只負責 JSON 編解碼與呼叫 SessionManager 的對應方法,
// 商業邏輯(session 建立/patch/run)都在 session.go。
package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// writeJSON 統一輸出 JSON 回應(縮排格式,方便用 curl 除錯時人眼閱讀)。
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	b, err := marshalIndent(v)
	if err != nil {
		// 序列化本身失敗是很罕見的內部錯誤(不是使用者輸入問題),
		// 此時 header 已經寫出去,只能盡量把錯誤原因寫進 body。
		w.Write([]byte(`{"error":"failed to encode response"}`))
		return
	}
	w.Write(b)
}

// writeError 用一致的 {"error": "..."} 格式回報錯誤。
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// cutMiddle 把 s 依第一個出現的 sep 切成前後兩段(前段當 {id}、後段當
// {version} 這類路徑參數),兩段都必須非空字串才視為成功匹配——用於解析
// "/sessions/{id}/thought-versions/{version}/activate" 這類「路徑參數夾在
// 中間」的路由(與 strings.CutSuffix 處理「路徑參數在尾端」互補)。
func cutMiddle(s, sep string) (before, after string, ok bool) {
	i := strings.Index(s, sep)
	if i < 0 {
		return "", "", false
	}
	before, after = s[:i], s[i+len(sep):]
	if before == "" || after == "" {
		return "", "", false
	}
	return before, after, true
}

// registerRoutes 掛載 agentbench 的所有路由。
func registerRoutes(mux *http.ServeMux, mgr *SessionManager) {
	mux.HandleFunc("/sessions", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			handleCreateSession(w, r, mgr)
		default:
			writeError(w, http.StatusMethodNotAllowed, "only POST is supported on /sessions")
		}
	})

	// /sessions/{id} 與 /sessions/{id}/run 共用同一個前綴,依路徑尾端與 method 分派。
	mux.HandleFunc("/sessions/", func(w http.ResponseWriter, r *http.Request) {
		rest := strings.TrimPrefix(r.URL.Path, "/sessions/")
		rest = strings.Trim(rest, "/")
		if rest == "" {
			writeError(w, http.StatusNotFound, "missing session id")
			return
		}

		if id, ok := strings.CutSuffix(rest, "/run"); ok {
			if r.Method != http.MethodPost {
				writeError(w, http.StatusMethodNotAllowed, "only POST is supported on /sessions/{id}/run")
				return
			}
			handleRunSession(w, r, mgr, id)
			return
		}

		// /sessions/{id}/thought-versions/{version}/activate:切換 session
		// 目前生效的 thought 版本。{version} 是路徑參數,跟 {id} 一樣手動解析
		// (mux 本身不支援路徑參數擷取)。
		if withoutSuffix, ok := strings.CutSuffix(rest, "/activate"); ok {
			if id, versionStr, ok := cutMiddle(withoutSuffix, "/thought-versions/"); ok {
				if r.Method != http.MethodPost {
					writeError(w, http.StatusMethodNotAllowed, "only POST is supported on /sessions/{id}/thought-versions/{version}/activate")
					return
				}
				version, err := strconv.Atoi(versionStr)
				if err != nil {
					writeError(w, http.StatusBadRequest, "invalid version in path: "+versionStr)
					return
				}
				handleActivateThoughtVersion(w, r, mgr, id, version)
				return
			}
		}

		id := rest
		switch r.Method {
		case http.MethodGet:
			handleGetSession(w, r, mgr, id)
		case http.MethodPatch:
			handlePatchSession(w, r, mgr, id)
		case http.MethodDelete:
			handleDeleteSession(w, r, mgr, id)
		default:
			writeError(w, http.StatusMethodNotAllowed, "supported methods: GET, PATCH, DELETE")
		}
	})
}

// handleCreateSession 處理 POST /sessions:建立一個新 session。
//
// thought 內容的必填檢查交給 mgr.Create → resolveThought 統一處理
// (thought 與 officialThoughtLang 至少需要一個;officialThoughtLang 有值時
// 會觸發 fetchOfficialThought 子程序呼叫取得正式 thought),這裡不重複驗證,
// 避免兩處驗證邏輯不同步。
func handleCreateSession(w http.ResponseWriter, r *http.Request, mgr *SessionManager) {
	var in CreateSessionInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}

	s, err := mgr.Create(in)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, s.View())
}

// handleGetSession 處理 GET /sessions/{id}:查詢目前狀態/thought 內容。
func handleGetSession(w http.ResponseWriter, r *http.Request, mgr *SessionManager, id string) {
	s, ok := mgr.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "session not found: "+id)
		return
	}
	writeJSON(w, http.StatusOK, s.View())
}

// handlePatchSession 處理 PATCH /sessions/{id}:更新 thought 與/或工具清單。
func handlePatchSession(w http.ResponseWriter, r *http.Request, mgr *SessionManager, id string) {
	s, ok := mgr.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "session not found: "+id)
		return
	}

	var in PatchInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}

	if err := s.Patch(in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.View())
}

// handleActivateThoughtVersion 處理
// POST /sessions/{id}/thought-versions/{version}/activate:
// 把 session 目前生效的 thought 切換回歷史版本清單裡 version 這個版本號的內容
// (不新增版本,只改變目前生效的指標)。version 不存在時回傳 400。
func handleActivateThoughtVersion(w http.ResponseWriter, r *http.Request, mgr *SessionManager, id string, version int) {
	s, ok := mgr.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "session not found: "+id)
		return
	}

	if err := s.ActivateVersion(version); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.View())
}

// handleDeleteSession 處理 DELETE /sessions/{id}:結束/清除 session。
func handleDeleteSession(w http.ResponseWriter, r *http.Request, mgr *SessionManager, id string) {
	if !mgr.Delete(id) {
		writeError(w, http.StatusNotFound, "session not found: "+id)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// runInput 是 POST /sessions/{id}/run 的 request body。
type runInput struct {
	Input string `json:"input"`
}

// handleRunSession 處理 POST /sessions/{id}/run:觸發一次推論,
// 同步阻塞等待完整結果後回傳(不用 WebSocket/SSE 串流,一次回傳完整 JSON)。
func handleRunSession(w http.ResponseWriter, r *http.Request, mgr *SessionManager, id string) {
	s, ok := mgr.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "session not found: "+id)
		return
	}

	var in runInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	if strings.TrimSpace(in.Input) == "" {
		writeError(w, http.StatusBadRequest, "input is required")
		return
	}

	result := s.Run(in.Input)
	writeJSON(w, http.StatusOK, result)
}
