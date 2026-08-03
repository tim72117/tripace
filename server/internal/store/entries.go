package store

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/tim72117/tripace/internal/model"
	"gorm.io/gorm"
)

func toEntry(r entryRow) model.Entry {
	return model.Entry{
		ID:        r.ID,
		TripID:    r.TripID,
		Title:     r.Title,
		Start:     r.Start,
		StartTime: r.StartTime,
		End:       r.End,
		EndTime:   r.EndTime,
		Location:  r.Location,
		Lat:       r.Lat,
		Lng:       r.Lng,
		Category:  r.Category,
		Tags:      r.Tags,
		Note:      r.Note,
		Kind:      r.Kind,
		Detail:    r.Detail,
		CreatedAt: r.CreatedAt,
	}
}

// InsertEntry 寫入一筆條目。entry 為主體,可獨立存在(不依附 message)。
// 來源訊息的關聯改由 LinkEntryMessage 另外建立(多對多)。
func (s *Store) InsertEntry(e model.Entry) error {
	r := entryRow{
		ID:        e.ID,
		TripID:    e.TripID,
		Title:     e.Title,
		Start:     e.Start,
		StartTime: e.StartTime,
		End:       e.End,
		EndTime:   e.EndTime,
		Location:  e.Location,
		Lat:       e.Lat,
		Lng:       e.Lng,
		Category:  e.Category,
		Tags:      e.Tags,
		Note:      e.Note,
		Kind:      e.Kind,
		Detail:    e.Detail,
		CreatedAt: e.CreatedAt,
	}
	return s.db.Create(&r).Error
}

// SetEntryLatLng 更新 entry 的經緯度（由 geo goroutine 非同步呼叫）。
func (s *Store) SetEntryLatLng(id string, lat, lng float64) error {
	return s.db.Model(&entryRow{}).Where("id = ?", id).
		Updates(map[string]any{"lat": lat, "lng": lng}).Error
}

// UpdateEntry 更新一筆 entry 的可編輯欄位；留空字串的欄位不更新。
func (s *Store) UpdateEntry(id, title, start, startTime, end, endTime, location, note, kind string, detail map[string]any) error {
	fields := map[string]any{}
	if title != "" {
		fields["title"] = title
	}
	if start != "" {
		fields["start"] = start
	}
	if startTime != "" {
		fields["start_time"] = startTime
	}
	if end != "" {
		fields["end_at"] = end
	}
	if endTime != "" {
		fields["end_time"] = endTime
	}
	if location != "" {
		fields["location"] = location
	}
	if note != "" {
		fields["note"] = note
	}
	if kind != "" {
		fields["kind"] = kind
	}
	if detail != nil {
		// entryRow.Detail 的 `serializer:json` tag 只在透過具名 struct 更新時
		// 生效(見 InsertEntry);這裡用 map[string]any 呼叫 Updates,GORM 無法
		// 從欄位名稱字串反查回 struct tag,會把原始 Go map 直接交給資料庫驅動
		// 編碼進 text 欄位,導致 "unable to encode map[string]interface{}"
		// 錯誤。手動先序列化成 JSON 字串再放進 fields,繞開這個限制。
		b, err := json.Marshal(detail)
		if err != nil {
			return fmt.Errorf("序列化 detail 失敗: %w", err)
		}
		fields["detail"] = string(b)
	}
	if len(fields) == 0 {
		return nil
	}
	return s.db.Model(&entryRow{}).Where("id = ?", id).Updates(fields).Error
}

// EntryExists 確認 entry 是否存在。
func (s *Store) EntryExists(id string) (bool, error) {
	var count int64
	err := s.db.Model(&entryRow{}).Where("id = ?", id).Count(&count).Error
	return count > 0, err
}

// DeleteEntry 刪除一筆條目。
func (s *Store) DeleteEntry(id string) error {
	return s.db.Where("id = ?", id).Delete(&entryRow{}).Error
}

// GetEntry 依 ID 取單一條目;查無回 ErrNotFound。
func (s *Store) GetEntry(entryID string) (model.Entry, error) {
	var r entryRow
	err := s.db.Where("id = ?", entryID).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Entry{}, ErrNotFound
	}
	if err != nil {
		return model.Entry{}, err
	}
	return toEntry(r), nil
}

// ListEntriesByTrip 回傳行程的所有條目,依開始時間排序。
func (s *Store) ListEntriesByTrip(tripID string) ([]model.Entry, error) {
	var rows []entryRow
	err := s.db.Where("trip_id = ?", tripID).
		Order("start ASC, created_at ASC").Find(&rows).Error
	return mapEntries(rows), err
}

// ListEntriesByRange 回傳行程中 start 落在 [from, to] 的條目,依開始時間排序。
// from / to 為 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:MM';留空表示該端不設限。
// start 以 ISO 格式字串儲存,字典序即時間序,故可用字串比較做範圍。
// 註:start 為空字串(無時間)的條目不會落在任何範圍內,僅在 from、to 皆空時納入。
func (s *Store) ListEntriesByRange(tripID, from, to string) ([]model.Entry, error) {
	q := s.db.Where("trip_id = ?", tripID)
	if from != "" {
		q = q.Where("start >= ?", from)
	}
	if to != "" {
		// to 若只到日期(YYYY-MM-DD),補到當日最後一刻,讓當天有時刻的條目也納入。
		upper := to
		if len(to) == 10 {
			upper = to + " 23:59"
		}
		q = q.Where("start <> '' AND start <= ?", upper)
	}
	var rows []entryRow
	err := q.Order("start ASC, created_at ASC").Find(&rows).Error
	return mapEntries(rows), err
}

func mapEntries(rows []entryRow) []model.Entry {
	out := make([]model.Entry, 0, len(rows))
	for _, r := range rows {
		out = append(out, toEntry(r))
	}
	return out
}

// DeleteTripEntries 清空某行程的所有 entries(不動行程/使用者本身)。
// 開發/測試重置用。
func (s *Store) DeleteTripEntries(tripID string) error {
	return s.db.Where("trip_id = ?", tripID).Delete(&entryRow{}).Error
}
