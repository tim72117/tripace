package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/tim72117/tripace/internal/store"
	"github.com/tim72117/tripace/internal/tripsvc"
)

// handleInternalListTrips GET /internal/trips
func (s *Server) handleInternalListTrips(w http.ResponseWriter, r *http.Request) {
	trips, err := s.store.ListAllTrips()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"trips": trips})
}

// handleInternalListEntries GET /internal/trips/{id}/entries
// 列出行程的所有 entry。與 /v1 版本(handleListEntries)共用同一個
// writeEntries,差別只在信任邊界:/v1 走 requireMember 檢查呼叫者是不是
// 這個行程的成員,/internal 靠的是 internalAuth 那把 JWT 本身(見
// middleware.go),與同檔案其餘 handleInternal* 系列一致。
func (s *Server) handleInternalListEntries(w http.ResponseWriter, r *http.Request) {
	s.writeEntries(w, r.PathValue("id"))
}

// handleInternalRecord POST /internal/trips/{id}/entries
// 寫入一筆 entry，回傳 entryID。
func (s *Server) handleInternalRecord(w http.ResponseWriter, r *http.Request) {
	tripID := r.PathValue("id")
	var body struct {
		Title     string `json:"title"`
		Start     string `json:"start"`
		StartTime string `json:"startTime"`
		End       string `json:"end"`
		EndTime   string `json:"endTime"`
		Location  string `json:"location"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Title == "" {
		writeErr(w, http.StatusBadRequest, "invalid_body", "title 必填")
		return
	}
	svc := tripsvc.New(s.store, nil)
	res, err := svc.Record(tripsvc.RecordInput{
		TripID:    tripID,
		Title:     body.Title,
		Start:     body.Start,
		StartTime: body.StartTime,
		End:       body.End,
		EndTime:   body.EndTime,
		Location:  body.Location,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "record_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, res)
}

// handleInternalUpdateEntry PATCH /internal/entries/{id}
// 更新 entry 的可編輯欄位。
func (s *Server) handleInternalUpdateEntry(w http.ResponseWriter, r *http.Request) {
	entryID := r.PathValue("id")
	var body struct {
		Title     string         `json:"title"`
		Start     string         `json:"start"`
		StartTime string         `json:"startTime"`
		End       string         `json:"end"`
		EndTime   string         `json:"endTime"`
		Location  string         `json:"location"`
		Note      string         `json:"note"`
		Kind      string         `json:"kind"`
		Detail    map[string]any `json:"detail"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	svc := tripsvc.New(s.store, nil)
	if err := svc.UpdateEntry(tripsvc.UpdateEntryInput{
		ID:        entryID,
		Title:     body.Title,
		Start:     body.Start,
		StartTime: body.StartTime,
		End:       body.End,
		EndTime:   body.EndTime,
		Location:  body.Location,
		Note:      body.Note,
		Kind:      body.Kind,
		Detail:    body.Detail,
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"updated": entryID})
}

// handleInternalDeleteEntry DELETE /internal/entries/{id}
// 刪除單一 entry。不像 /v1/trips/{id}/entries/{entryID} 版本
// (handleDeleteTripEntry)需要路徑上的 tripID 來源比對——這裡的信任邊界
// 是 internalAuth 這把 JWT 本身,不是「呼叫端剛好也知道正確的 tripID」,
// 與同檔案其餘 handleInternal* 系列(如 handleInternalUpdateEntry)的作法
// 一致。先查一次 entry 只是為了拿 TripID 供下面 broadcast 使用。
func (s *Server) handleInternalDeleteEntry(w http.ResponseWriter, r *http.Request) {
	entryID := r.PathValue("id")
	entry, err := s.store.GetEntry(entryID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "entry_not_found", "條目不存在")
			return
		}
		writeErr(w, http.StatusInternalServerError, "lookup_failed", err.Error())
		return
	}
	if err := s.store.DeleteEntry(entryID); err != nil {
		writeErr(w, http.StatusInternalServerError, "delete_failed", err.Error())
		return
	}
	s.hub.Broadcast(entry.TripID, map[string]any{"event": "entries_updated", "tripID": entry.TripID})
	writeJSON(w, http.StatusOK, map[string]string{"deleted": entryID})
}

// handleInternalSetLatLng PATCH /internal/entries/{id}/latlng
func (s *Server) handleInternalSetLatLng(w http.ResponseWriter, r *http.Request) {
	entryID := r.PathValue("id")
	var body struct {
		Lat float64 `json:"lat"`
		Lng float64 `json:"lng"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := s.store.SetEntryLatLng(entryID, body.Lat, body.Lng); err != nil {
		writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"updated": entryID})
}

// handleInternalReset DELETE /internal/trips/{id}/entries
func (s *Server) handleInternalReset(w http.ResponseWriter, r *http.Request) {
	s.resetTrip(w, r.PathValue("id"))
}
