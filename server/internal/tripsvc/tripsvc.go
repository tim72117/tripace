// Package tripsvc 是 entry 的「行程服務層」:把記錄、更新條目的邏輯集中於此,
// 作為單一真實來源。
//
// 設計原則:LLM 工具(wanttools)與 CLI 都只薄薄呼叫本層,不各自重刻。
package tripsvc

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"time"

	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/store"
)

func nowUTC() time.Time { return time.Now().UTC() }

// Service 持有 store,提供 entry 的行程操作。
type Service struct {
	st  *store.Store
	geo *geo.Client
}

// New 建立服務。
func New(st *store.Store, geoClient *geo.Client) *Service {
	return &Service{st: st, geo: geoClient}
}

// newEntryID 產生 entry ID(對齊既有 ent_ 風格)。
func newEntryID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "ent_" + hex.EncodeToString(b)
}

// RecordInput 是記錄一筆條目的輸入。
type RecordInput struct {
	TripID    string
	Title     string
	Start     string // 'YYYY-MM-DD';可空
	StartTime string // 'HH:MM';空=全日
	End       string // 'YYYY-MM-DD';可空
	EndTime   string // 'HH:MM';可空
	Location  string // 可空
	// Kind:條目類型("stay"|"flight"|"activity"|"note"|"car"|"restaurant"|
	// "ticket",見 model.Entry.Kind)。可空——目前唯一的呼叫來源是
	// GeoCandidateSidebar.tsx 把候選籃項目(飯店/景點/推薦地點)拖進日層架
	// 時,帶入該候選原本的分類(飯店→"stay"等),讓這筆新 entry 保留分類
	// 資訊;其餘既有呼叫端(want 工具、CLI)留空,沿用建立時不分類的既有
	// 行為。
	Kind string
}

// RecordResult 是記錄結果:新 entry 的 ID。
type RecordResult struct {
	EntryID string `json:"entryID"`
}

// Record 寫入一筆 entry。
func (s *Service) Record(in RecordInput) (RecordResult, error) {
	id := newEntryID()
	e := model.Entry{
		ID:        id,
		TripID:    in.TripID,
		Title:     in.Title,
		Start:     in.Start,
		StartTime: in.StartTime,
		End:       in.End,
		EndTime:   in.EndTime,
		Location:  in.Location,
		CreatedAt: nowUTC(),
	}
	if in.Kind != "" {
		e.Kind = &in.Kind
	}
	if err := s.st.InsertEntry(e); err != nil {
		return RecordResult{}, err
	}

	// 有地點時非同步補經緯度，失敗只記 log，不阻擋主流程。
	if in.Location != "" && s.geo != nil {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			lat, lng, err := s.geo.Lookup(ctx, in.Location)
			if err != nil {
				log.Printf("geo lookup %q: %v", in.Location, err)
				return
			}
			if err := s.st.SetEntryLatLng(id, lat, lng); err != nil {
				log.Printf("set lat/lng entry %s: %v", id, err)
			}
		}()
	}

	return RecordResult{EntryID: id}, nil
}

// ---- CRUD 轉發(讓呼叫端不必直接依賴 store) ----

// UpdateEntryInput 是更新條目的輸入，留空欄位不更新。
type UpdateEntryInput struct {
	ID        string
	Title     string
	Start     string
	StartTime string
	End       string
	EndTime   string
	Location  string
	Note      string
	Kind      string
	Detail    map[string]any
}

// UpdateEntry 更新一筆 entry 的可編輯欄位。
func (s *Service) UpdateEntry(in UpdateEntryInput) error {
	return s.st.UpdateEntry(in.ID, in.Title, in.Start, in.StartTime, in.End, in.EndTime, in.Location, in.Note, in.Kind, in.Detail)
}

// Reset 清空行程的所有 entries(開發/測試用)。
func (s *Service) Reset(tripID string) error {
	return s.st.DeleteTripEntries(tripID)
}
