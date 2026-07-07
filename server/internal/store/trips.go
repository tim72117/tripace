package store

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/tim72117/shuttle/internal/model"
	"gorm.io/gorm"
)

// tripIDPrefix + 隨機 hex = trip ID(對齊 ch_/ent_ 風格)。
func newTripID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return "trip_" + hex.EncodeToString(b)
}

// 時間字串以「兩種格式 + 純日期視為當日邊界」正規化成 time.Time 後比較,
// 避免裸字串比較的邊界 bug:例如 trip 範圍 '2026-06-25'(純日期)與事件
// '2026-06-25 16:00' 在字串上 "2026-06-25" < "2026-06-25 16:00",會誤判不重疊。
// 正規化後純日期 start 取當天 00:00、end 取當天 23:59:59,帶時刻者取該時刻。

// parseLower 解析時間字串為「下界」:純日期 → 當天 00:00;帶時刻 → 該時刻。
func parseLower(s string) (time.Time, bool) {
	if t, err := time.Parse("2006-01-02 15:04", s); err == nil {
		return t, true
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return t, true // 當天 00:00:00
	}
	return time.Time{}, false
}

// parseUpper 解析時間字串為「上界」:純日期 → 當天 23:59:59;帶時刻 → 該時刻。
func parseUpper(s string) (time.Time, bool) {
	if t, err := time.Parse("2006-01-02 15:04", s); err == nil {
		return t, true
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return t.Add(24*time.Hour - time.Second), true // 當天 23:59:59
	}
	return time.Time{}, false
}

// rangesOverlap 判斷兩個時間區間 [aStart,aEnd] 與 [bStart,bEnd] 是否重疊。
// 各端點以日期/日期時間正規化(start 取下界、end 取上界)後比較;
// 任一端解析失敗時退回原本的字串比較(保守相容)。
func rangesOverlap(aStart, aEnd, bStart, bEnd string) bool {
	aLo, ok1 := parseLower(aStart)
	aHi, ok2 := parseUpper(aEnd)
	bLo, ok3 := parseLower(bStart)
	bHi, ok4 := parseUpper(bEnd)
	if ok1 && ok2 && ok3 && ok4 {
		return !aLo.After(bHi) && !bLo.After(aHi)
	}
	// 任一端解析失敗:退回原本的字串重疊比較(aStart <= bEnd && aEnd >= bStart)。
	return aStart <= bEnd && aEnd >= bStart
}

func toTrip(r tripRow) model.Trip {
	return model.Trip{
		ID:        r.ID,
		ChannelID: r.ChannelID,
		Title:     r.Title,
		Start:     r.Start,
		End:       r.End,
		CreatedAt: r.CreatedAt,
	}
}

// CreateTrip 新建一筆行程並回傳其 ID(內部生 ID,供 add_to_trip 工具新建用)。
func (s *Store) CreateTrip(channelID, title, start, end string) (string, error) {
	id := newTripID()
	err := s.InsertTrip(model.Trip{
		ID:        id,
		ChannelID: channelID,
		Title:     title,
		Start:     start,
		End:       end,
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
		Start:     t.Start,
		End:       t.End,
		CreatedAt: t.CreatedAt,
	}
	return s.db.Create(&r).Error
}

// ListTripsByChannel 回傳頻道所有行程,依開始時間排序(字典序即時間序)。
func (s *Store) ListTripsByChannel(channelID string) ([]model.Trip, error) {
	var rows []tripRow
	err := s.db.Where("channel_id = ?", channelID).
		Order("start ASC, created_at ASC").Find(&rows).Error
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
		Order("start ASC, created_at ASC").Find(&rows).Error
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
//   - entryStart 為空(無時間)→ 不歸組,回 (nil, nil)。
//   - 掃頻道現有 trips,若新 entry 的時間區間 [entryStart, entryEnd] 與某 trip 的
//     [trip.Start, trip.End] 重疊 → 歸入該 trip,並擴張 trip 範圍(取聯集)。
//     重疊判定即「有跨度的住宿/出差等事件框出的行程範圍」涵蓋了單點事件。
//   - 無命中 → 新建 trip(以此 entry 的起訖與 item 當初值)。
//
// start/end 以 ISO 字串儲存(字典序即時間序),故區間比較用字串。
// 全程用交易包起,避免併發重複建 trip。
func (s *Store) FindOrCreateTrip(channelID, entryStart, entryEnd, item string) (*string, error) {
	if entryStart == "" {
		return nil, nil // 無時間 entry 不歸組
	}
	// 單點事件 end 為空時,以 start 當訖點。
	eEnd := entryEnd
	if eEnd == "" {
		eEnd = entryStart
	}

	var tripID *string
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var trips []tripRow
		if err := tx.Where("channel_id = ?", channelID).
			Order("start ASC, created_at ASC").Find(&trips).Error; err != nil {
			return err
		}

		// 找第一個時間區間重疊的 trip。
		// 重疊條件:trip.Start <= entryEnd 且 trip.End >= entryStart。
		// trip 的 End 可能為空(單點 trip),空時以 Start 當訖點比較。
		for i := range trips {
			tEnd := trips[i].End
			if tEnd == "" {
				tEnd = trips[i].Start
			}
			if trips[i].Start != "" && rangesOverlap(trips[i].Start, tEnd, entryStart, eEnd) {
				// 命中:歸入並擴張 trip 範圍(取 min(start) / max(end))。
				newStart := trips[i].Start
				if entryStart < newStart {
					newStart = entryStart
				}
				newEnd := tEnd
				if eEnd > newEnd {
					newEnd = eEnd
				}
				if newStart != trips[i].Start || newEnd != trips[i].End {
					if err := tx.Model(&tripRow{}).Where("id = ?", trips[i].ID).
						Updates(map[string]interface{}{"start": newStart, "end_at": newEnd}).Error; err != nil {
						return err
					}
				}
				id := trips[i].ID
				tripID = &id
				return nil
			}
		}

		// 無命中:新建 trip。
		id := newTripID()
		nt := tripRow{
			ID:        id,
			ChannelID: channelID,
			Title:     item,
			Start:     entryStart,
			End:       eEnd,
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
// 重疊條件與 FindOrCreateTrip 一致:trip.Start <= entryEnd 且 trip.End >= entryStart
// (字串字典序即時間序)。start 為空(無時間)時回空清單。
func (s *Store) FindOverlappingTrips(channelID, start, end string) ([]model.Trip, error) {
	if start == "" {
		return []model.Trip{}, nil
	}
	eEnd := end
	if eEnd == "" {
		eEnd = start
	}

	var rows []tripRow
	if err := s.db.Where("channel_id = ?", channelID).
		Order("start ASC, created_at ASC").Find(&rows).Error; err != nil {
		return nil, err
	}

	out := make([]model.Trip, 0)
	for i := range rows {
		tEnd := rows[i].End
		if tEnd == "" {
			tEnd = rows[i].Start
		}
		if rows[i].Start != "" && rangesOverlap(rows[i].Start, tEnd, start, eEnd) {
			out = append(out, toTrip(rows[i]))
		}
	}
	return out, nil
}
