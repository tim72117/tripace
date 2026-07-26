package store

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/tim72117/tripace/internal/model"
	"gorm.io/gorm"
)

// tripIDPrefix + 隨機 hex = trip ID(對齊 ch_/ent_ 風格)。
func newTripID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return "trip_" + hex.EncodeToString(b)
}

// rangesOverlap 判斷兩個時間區間 [aStart,aEnd] 與 [bStart,bEnd] 是否重疊。
// 改成原生 time.Time 比較後(2026-07),不再需要舊版 parseLower/parseUpper
// 那套「日期字串正規化成當日邊界」的字串 hack——時間本身已經是精確的
// timestamp,直接比較端點即可,不會再有「純日期」與「帶時刻」字典序不一致
// 的邊界 bug。呼叫端負責在「單點事件」情境下把空的 end 補成等於 start
// (見 FindOrCreateTrip/FindOverlappingTrips),這裡只單純做區間重疊判斷。
func rangesOverlap(aStart, aEnd, bStart, bEnd time.Time) bool {
	return !aStart.After(bEnd) && !bStart.After(aEnd)
}

func toTrip(r tripRow) model.Trip {
	return model.Trip{
		ID:        r.ID,
		ChannelID: r.ChannelID,
		Title:     r.Title,
		StartAt:   r.StartAt,
		EndAt:     r.EndAt,
		TZ:        r.TZ,
		CreatedAt: r.CreatedAt,
	}
}

// CreateTrip 新建一筆行程並回傳其 ID(內部生 ID,供 add_to_trip 工具新建用)。
func (s *Store) CreateTrip(channelID, title string, startAt, endAt *time.Time, tz string) (string, error) {
	id := newTripID()
	err := s.InsertTrip(model.Trip{
		ID:        id,
		ChannelID: channelID,
		Title:     title,
		StartAt:   startAt,
		EndAt:     endAt,
		TZ:        tz,
		CreatedAt: now(),
	})
	return id, err
}

// InsertTrip 寫入一筆行程。
func (s *Store) InsertTrip(t model.Trip) error {
	r := tripRow{
		ID:        t.ID,
		ChannelID: t.ChannelID,
		Title:     t.Title,
		StartAt:   t.StartAt,
		EndAt:     t.EndAt,
		TZ:        t.TZ,
		CreatedAt: t.CreatedAt,
	}
	return s.db.Create(&r).Error
}

// ListTripsByChannel 回傳頻道所有行程,依開始時間排序。
func (s *Store) ListTripsByChannel(channelID string) ([]model.Trip, error) {
	var rows []tripRow
	err := s.db.Where("channel_id = ?", channelID).
		Order("start_at ASC, created_at ASC").Find(&rows).Error
	out := make([]model.Trip, 0, len(rows))
	for _, r := range rows {
		out = append(out, toTrip(r))
	}
	return out, err
}

// ListEntriesByTrip 回傳某行程的 entries,依開始時間排序。
func (s *Store) ListEntriesByTrip(channelID, tripID string) ([]model.Entry, error) {
	var rows []entryRow
	err := s.db.Where("channel_id = ? AND trip_id = ?", channelID, tripID).
		Order("start_at ASC, created_at ASC").Find(&rows).Error
	return mapEntries(rows), err
}

// SetEntryTrip 設定某 entry 的所屬行程(供重組/誤組修正,可傳 nil 解除歸組)。
func (s *Store) SetEntryTrip(entryID string, tripID *string) error {
	return s.db.Model(&entryRow{}).Where("id = ?", entryID).
		Update("trip_id", tripID).Error
}

// FindOrCreateTrip 是歸組核心:依時間把新 entry 歸入現有行程或新建。
//
// 歸組邏輯(以「區間事件為骨架」):
//   - entryStart 為 nil(無時間)→ 不歸組,回 (nil, nil)。
//   - 掃頻道現有 trips,若新 entry 的時間區間 [entryStart, entryEnd] 與某 trip 的
//     [trip.StartAt, trip.EndAt] 重疊 → 歸入該 trip,並擴張 trip 範圍(取聯集)。
//     重疊判定即「有跨度的住宿/出差等事件框出的行程範圍」涵蓋了單點事件。
//   - 無命中 → 新建 trip(以此 entry 的起訖與 item 當初值)。
//
// tz 是新 entry 的時區;新建 trip 時作為該 trip 的時區初值,歸入既有 trip 時
// 不覆蓋既有 trip 的 tz(維持「trip 的時區以第一筆 entry 為準」的簡化假設——
// 同一趟行程混合多個時區的情境不在這次改動範圍內)。
// 全程用交易包起,避免併發重複建 trip。
func (s *Store) FindOrCreateTrip(channelID string, entryStart, entryEnd *time.Time, tz, item string) (*string, error) {
	if entryStart == nil {
		return nil, nil // 無時間 entry 不歸組
	}
	// 單點事件 end 為 nil 時,以 start 當訖點。
	eEnd := entryEnd
	if eEnd == nil {
		eEnd = entryStart
	}

	var tripID *string
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var trips []tripRow
		if err := tx.Where("channel_id = ?", channelID).
			Order("start_at ASC, created_at ASC").Find(&trips).Error; err != nil {
			return err
		}

		// 找第一個時間區間重疊的 trip。
		// 重疊條件:trip.StartAt <= entryEnd 且 trip.EndAt >= entryStart。
		// trip 的 EndAt 可能為 nil(單點 trip),此時以 StartAt 當訖點比較。
		for i := range trips {
			if trips[i].StartAt == nil {
				continue
			}
			tEnd := trips[i].EndAt
			if tEnd == nil {
				tEnd = trips[i].StartAt
			}
			if !rangesOverlap(*trips[i].StartAt, *tEnd, *entryStart, *eEnd) {
				continue
			}
			// 命中:歸入並擴張 trip 範圍(取 min(start) / max(end))。
			newStart := *trips[i].StartAt
			if entryStart.Before(newStart) {
				newStart = *entryStart
			}
			newEnd := *tEnd
			if eEnd.After(newEnd) {
				newEnd = *eEnd
			}
			if !newStart.Equal(*trips[i].StartAt) || !newEnd.Equal(*tEnd) {
				if err := tx.Model(&tripRow{}).Where("id = ?", trips[i].ID).
					Updates(map[string]interface{}{"start_at": newStart, "end_at": newEnd}).Error; err != nil {
					return err
				}
			}
			id := trips[i].ID
			tripID = &id
			return nil
		}

		// 無命中:新建 trip。
		id := newTripID()
		nt := tripRow{
			ID:        id,
			ChannelID: channelID,
			Title:     item,
			StartAt:   entryStart,
			EndAt:     eEnd,
			TZ:        tz,
			CreatedAt: now(),
		}
		if err := tx.Create(&nt).Error; err != nil {
			return err
		}
		tripID = &id
		return nil
	})
	if err != nil {
		return nil, err
	}
	return tripID, nil
}

// DeleteTrip 刪除單一行程(不動底下的 entries,只解除 trip_id 關聯)。
func (s *Store) DeleteTrip(tripID string) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&entryRow{}).Where("trip_id = ?", tripID).
			Update("trip_id", nil).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", tripID).Delete(&tripRow{}).Error
	})
}

// DeleteChannelEntriesAndTrips 清空某頻道的所有 entries 與 trips(不動頻道/使用者本身)。
// 開發/測試重置用。用交易確保兩者一起清。
func (s *Store) DeleteChannelEntriesAndTrips(channelID string) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("channel_id = ?", channelID).Delete(&entryRow{}).Error; err != nil {
			return err
		}
		return tx.Where("channel_id = ?", channelID).Delete(&tripRow{}).Error
	})
}

// FindOverlappingTrips 回傳頻道中時間區間與 [start, end] 重疊的候選 trip。
// 供 record_entry 工具列出候選給 LLM 判斷(不寫入、不歸組)。
// 重疊條件與 FindOrCreateTrip 一致。start 為 nil(無時間)時回空清單。
func (s *Store) FindOverlappingTrips(channelID string, start, end *time.Time) ([]model.Trip, error) {
	if start == nil {
		return []model.Trip{}, nil
	}
	eEnd := end
	if eEnd == nil {
		eEnd = start
	}

	var rows []tripRow
	if err := s.db.Where("channel_id = ?", channelID).
		Order("start_at ASC, created_at ASC").Find(&rows).Error; err != nil {
		return nil, err
	}

	out := make([]model.Trip, 0)
	for i := range rows {
		if rows[i].StartAt == nil {
			continue
		}
		tEnd := rows[i].EndAt
		if tEnd == nil {
			tEnd = rows[i].StartAt
		}
		if rangesOverlap(*rows[i].StartAt, *tEnd, *start, *eEnd) {
			out = append(out, toTrip(rows[i]))
		}
	}
	return out, nil
}
