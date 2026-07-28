package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/tim72117/tripace/internal/store"
	"github.com/tim72117/tripace/internal/tripsvc"
)

// handleInternalListChannels GET /internal/channels
func (s *Server) handleInternalListChannels(w http.ResponseWriter, r *http.Request) {
	channels, err := s.store.ListAllChannels()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"channels": channels})
}

// handleInternalRecord POST /internal/channels/{id}/entries
// 寫入一筆 entry，回傳 entryID 與候選行程。
func (s *Server) handleInternalRecord(w http.ResponseWriter, r *http.Request) {
	channelID := r.PathValue("id")
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
		ChannelID: channelID,
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

// handleInternalAddToTrip POST /internal/entries/{id}/trip
// 把 entry 歸入行程（留空 tripID 則新建）。
func (s *Server) handleInternalAddToTrip(w http.ResponseWriter, r *http.Request) {
	entryID := r.PathValue("id")
	var body struct {
		TripID string `json:"tripID"`
		Title  string `json:"title"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	svc := tripsvc.New(s.store, nil)
	tripID, channelID, err := svc.AddToTrip(entryID, body.TripID, body.Title)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "add_to_trip_failed", err.Error())
		return
	}
	s.hub.Broadcast(channelID, map[string]any{"event": "entries_updated", "channelID": channelID})
	writeJSON(w, http.StatusOK, map[string]string{"entryID": entryID, "tripID": tripID})
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
// 刪除單一 entry。不像 /v1/channels/{id}/entries/{entryID} 版本
// (handleDeleteTripEntry)需要路徑上的 channelID 來源比對——這裡的信任邊界
// 是 internalAuth 這把 JWT 本身,不是「呼叫端剛好也知道正確的 channelID」,
// 與同檔案其餘 handleInternal* 系列(如 handleInternalUpdateEntry)的作法
// 一致。先查一次 entry 只是為了拿 ChannelID 供下面 broadcast 使用。
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
	s.hub.Broadcast(entry.ChannelID, map[string]any{"event": "entries_updated", "channelID": entry.ChannelID})
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

// handleInternalListTrips GET /internal/channels/{id}/trips
func (s *Server) handleInternalListTrips(w http.ResponseWriter, r *http.Request) {
	s.writeTrips(w, r.PathValue("id"))
}

// handleInternalTripEntries GET /internal/channels/{id}/trips/{tripID}/entries
func (s *Server) handleInternalTripEntries(w http.ResponseWriter, r *http.Request) {
	s.writeTripEntries(w, r.PathValue("id"), r.PathValue("tripID"))
}

// handleInternalReset DELETE /internal/channels/{id}/entries
func (s *Server) handleInternalReset(w http.ResponseWriter, r *http.Request) {
	s.resetChannel(w, r.PathValue("id"))
}
