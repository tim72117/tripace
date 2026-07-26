package store

import (
	"errors"
	"time"

	"github.com/tim72117/tripace/internal/model"
	"gorm.io/gorm"
)

func toEntry(r entryRow) model.Entry {
	return model.Entry{
		ID:        r.ID,
		ChannelID: r.ChannelID,
		Title:     r.Title,
		StartAt:   r.StartAt,
		EndAt:     r.EndAt,
		TZ:        r.TZ,
		AllDay:    r.AllDay,
		Location:  r.Location,
		Lat:       r.Lat,
		Lng:       r.Lng,
		TripID:    r.TripID,
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
		ChannelID: e.ChannelID,
		Title:     e.Title,
		StartAt:   e.StartAt,
		EndAt:     e.EndAt,
		TZ:        e.TZ,
		AllDay:    e.AllDay,
		Location:  e.Location,
		Lat:       e.Lat,
		Lng:       e.Lng,
		TripID:    e.TripID,
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

// EntryTimeUpdate 是 UpdateEntry 的時間相關參數,用具名 struct 取代多個
// string/bool 參數,避免呼叫端調換參數順序時編譯器無法檢查出錯誤
// (StartAt/EndAt 型別相同,順序寫反不會報錯,只會靜默寫錯欄位)。
//
// 三個指標各自獨立表示「是否要更新這個欄位」:nil=不變,非 nil=更新成該值
// (StartAt/EndAt 可以被明確設為 nil 時間點——但目前呼叫端沒有這個需求,
// 一律用「有沒有帶這個參數」表示要不要更新,細節見 UpdateEntry 呼叫處)。
type EntryTimeUpdate struct {
	StartAt *time.Time
	EndAt   *time.Time
	TZ      *string
	AllDay  *bool
}

// UpdateEntry 更新一筆 entry 的可編輯欄位;留空字串/nil 的欄位不更新。
func (s *Store) UpdateEntry(id, title string, tu EntryTimeUpdate, location, note, kind string, detail map[string]any) error {
	fields := map[string]any{}
	if title != "" {
		fields["title"] = title
	}
	if tu.StartAt != nil {
		fields["start_at"] = *tu.StartAt
	}
	if tu.EndAt != nil {
		fields["end_at"] = *tu.EndAt
	}
	if tu.TZ != nil {
		fields["tz"] = *tu.TZ
	}
	if tu.AllDay != nil {
		fields["all_day"] = *tu.AllDay
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
		fields["detail"] = detail
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
// add_to_trip 工具新建 trip 時用它取得 entry 的時間範圍當 trip 初值。
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

// ListEntriesByChannel 回傳頻道的所有條目,依開始時間排序。
func (s *Store) ListEntriesByChannel(channelID string) ([]model.Entry, error) {
	var rows []entryRow
	err := s.db.Where("channel_id = ?", channelID).
		Order("start_at ASC, created_at ASC").Find(&rows).Error
	return mapEntries(rows), err
}

// ListEntriesByRange 回傳頻道中 start_at 落在 [from, to] 的條目,依開始時間排序。
// from/to 為零值 time.Time 表示該端不設限。改成原生 timestamptz 比較後,
// 不再需要字串範圍的邊界特判(舊版 to 只到日期要補 23:59 的處理已不需要,
// 呼叫端直接傳當日 23:59:59 或隔天 00:00 即可,語意由呼叫端決定)。
// 註:start_at 為 NULL(無時間)的條目不會落在任何範圍內,僅在 from、to 皆為
// 零值時才納入(對應舊版「皆空時納入」的行為)。
func (s *Store) ListEntriesByRange(channelID string, from, to time.Time) ([]model.Entry, error) {
	q := s.db.Where("channel_id = ?", channelID)
	if !from.IsZero() {
		q = q.Where("start_at >= ?", from)
	}
	if !to.IsZero() {
		q = q.Where("start_at IS NOT NULL AND start_at <= ?", to)
	}
	var rows []entryRow
	err := q.Order("start_at ASC, created_at ASC").Find(&rows).Error
	return mapEntries(rows), err
}

func mapEntries(rows []entryRow) []model.Entry {
	out := make([]model.Entry, 0, len(rows))
	for _, r := range rows {
		out = append(out, toEntry(r))
	}
	return out
}
