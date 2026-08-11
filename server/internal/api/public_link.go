package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/tim72117/tripace/internal/store"
)

// POST /v1/trips/{id}/public-link — 建立（或取得已有）公開連結。
func (s *Server) handleCreatePublicLink(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	user := s.userFor(r)
	if !s.requireEditor(w, id, user.ID) {
		return
	}
	var body struct {
		Editable bool   `json:"editable"`
		ViewMode string `json:"viewMode,omitempty"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	info, err := s.store.GetPublicLink(id)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		token, err := s.store.CreatePublicLink(id, user.ID, body.Editable, body.ViewMode)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "create_failed", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"linkToken": token, "editable": body.Editable, "viewMode": normalizeViewModeAPI(body.ViewMode)})
		return
	}
	// 已存在：若 editable／viewMode 有變更則更新
	if info.Editable != body.Editable {
		if err := s.store.SetPublicLinkEditable(id, body.Editable); err != nil {
			writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
			return
		}
		info.Editable = body.Editable
	}
	if wantMode := normalizeViewModeAPI(body.ViewMode); wantMode != info.ViewMode {
		if err := s.store.SetPublicLinkViewMode(id, wantMode); err != nil {
			writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
			return
		}
		info.ViewMode = wantMode
	}
	writeJSON(w, http.StatusOK, map[string]any{"linkToken": info.Token, "editable": info.Editable, "viewMode": info.ViewMode})
}

// normalizeViewModeAPI 收斂 request body 的 viewMode 欄位：只接受
// "pace"，其餘（含空字串／未知值）一律當成預設的 "timeline"，跟
// store.normalizeViewMode 對齊，避免前端傳錯值時把資料存成非法狀態。
func normalizeViewModeAPI(v string) string {
	if v == "pace" {
		return "pace"
	}
	return "timeline"
}

// GET /v1/trips/{id}/public-link — 查詢行程的公開連結。
func (s *Server) handleGetPublicLink(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.requireMember(w, id, s.userFor(r).ID) {
		return
	}
	info, err := s.store.GetPublicLink(id)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not_found", "此行程尚未建立公開連結")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"linkToken": info.Token, "editable": info.Editable, "viewMode": info.ViewMode})
}

// DELETE /v1/trips/{id}/public-link — 刪除公開連結（撤銷分享）。
func (s *Server) handleDeletePublicLink(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.requireEditor(w, id, s.userFor(r).ID) {
		return
	}
	if err := s.store.DeletePublicLink(id); err != nil {
		writeErr(w, http.StatusInternalServerError, "delete_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// GET /v1/public/{token} — 無需登入，讀取公開分享的行程資料。
func (s *Server) handlePublicView(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	info, err := s.store.GetPublicLinkTrip(token)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not_found", "找不到此分享連結")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}

	tripName, err := s.store.GetTripName(info.TripID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "trip_failed", err.Error())
		return
	}
	entries, err := s.store.ListEntriesByTrip(info.TripID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "entries_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"tripID":   info.TripID,
		"tripName": tripName,
		"editable": info.Editable,
		"viewMode": info.ViewMode,
		"entries":  entries,
	})
}

// POST /v1/public/{token}/compute-route — 無需登入，替分享頁訪客算路線。
//
// 對應登入後正式介面用的 POST /internal/entries/compute-route
// (handleComputeRouteFromEntries,entry_geocode.go)：那支端點掛在
// internalAuth 之後，靠「必須帶有效 JWT」擋著，本身完全不檢查 entryIDs
// 是否屬於同一個行程。這支端點刻意不登入即可呼叫（公開分享頁的訪客沒有
// JWT），因此改用 token 反查行程、並要求所有 entryIDs 都屬於這個行程
// (見 computeRouteForEntries 的 scopeTripID 參數)——避免任何人只要
// 知道一個分享連結，就能拿它當免驗證跳板去查詢/觸發其他行程 entry 的
// 路線計算（entry 存不存在、座標為何都會透過錯誤訊息/成功結果洩漏）。
func (s *Server) handlePublicComputeRoute(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	info, err := s.store.GetPublicLinkTrip(token)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not_found", "找不到此分享連結")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}

	var body struct {
		EntryIDs []string `json:"entryIDs"`
	}
	if !decode(w, r, &body) {
		return
	}
	if len(body.EntryIDs) < 2 {
		writeErr(w, http.StatusBadRequest, "invalid_input", "entryIDs 至少需要 2 筆(起點+終點)")
		return
	}

	resp, cerr := s.computeRouteForEntries(r.Context(), body.EntryIDs, info.TripID)
	if cerr != nil {
		writeErr(w, cerr.status, cerr.code, cerr.message)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}
