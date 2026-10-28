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
		Editable bool `json:"editable"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	info, err := s.store.GetPublicLink(id)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		token, err := s.store.CreatePublicLink(id, user.ID, body.Editable)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "create_failed", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"linkToken": token, "editable": body.Editable})
		return
	}
	// 已存在：若 editable 有變更則更新
	if info.Editable != body.Editable {
		if err := s.store.SetPublicLinkEditable(id, body.Editable); err != nil {
			writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
			return
		}
		info.Editable = body.Editable
	}
	writeJSON(w, http.StatusOK, map[string]any{"linkToken": info.Token, "editable": info.Editable})
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
	writeJSON(w, http.StatusOK, map[string]any{"linkToken": info.Token, "editable": info.Editable})
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
		"entries":  entries,
	})
}
