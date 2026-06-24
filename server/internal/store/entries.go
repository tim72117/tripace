package store

import "github.com/channel/server/internal/model"

func toEntry(r entryRow) model.Entry {
	return model.Entry{
		ID:        r.ID,
		ChannelID: r.ChannelID,
		Item:      r.Item,
		Start:     r.Start,
		End:       r.End,
		AllDay:    r.AllDay,
		Location:  r.Location,
		Category:  r.Category,
		Tags:      r.Tags,
		Summary:   r.Summary,
		CreatedAt: r.CreatedAt,
	}
}

// InsertEntry 寫入一筆條目。entry 為主體,可獨立存在(不依附 message)。
// 來源訊息的關聯改由 LinkEntryMessage 另外建立(多對多)。
func (s *Store) InsertEntry(e model.Entry) error {
	r := entryRow{
		ID:        e.ID,
		ChannelID: e.ChannelID,
		Item:      e.Item,
		Start:     e.Start,
		End:       e.End,
		AllDay:    e.AllDay,
		Location:  e.Location,
		Category:  e.Category,
		Tags:      e.Tags,
		Summary:   e.Summary,
		CreatedAt: e.CreatedAt,
	}
	return s.db.Create(&r).Error
}

// LinkEntryMessage 在 entry 與 message 間建立多對多關聯(寫入 entry_messages 中介表)。
// 兩者須已存在;重複關聯會被忽略(主鍵衝突視為已關聯)。
func (s *Store) LinkEntryMessage(entryID, messageID string) error {
	return s.db.Exec(
		"INSERT INTO entry_messages (entry_id, message_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
		entryID, messageID,
	).Error
}

// ListEntriesByChannel 回傳頻道的所有條目,依開始時間排序。
func (s *Store) ListEntriesByChannel(channelID string) ([]model.Entry, error) {
	var rows []entryRow
	err := s.db.Where("channel_id = ?", channelID).
		Order("start ASC, created_at ASC").Find(&rows).Error
	return mapEntries(rows), err
}

// ListEntriesByRange 回傳頻道中 start 落在 [from, to] 的條目,依開始時間排序。
// from / to 為 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:MM';留空表示該端不設限。
// start 以 ISO 格式字串儲存,字典序即時間序,故可用字串比較做範圍。
// 註:start 為空字串(無時間)的條目不會落在任何範圍內,僅在 from、to 皆空時納入。
func (s *Store) ListEntriesByRange(channelID, from, to string) ([]model.Entry, error) {
	q := s.db.Where("channel_id = ?", channelID)
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

// ListEntriesByMessage 回傳某則訊息所關聯的條目(透過 entry_messages 中介表)。
func (s *Store) ListEntriesByMessage(messageID string) ([]model.Entry, error) {
	var rows []entryRow
	err := s.db.
		Joins("JOIN entry_messages em ON em.entry_id = entries.id").
		Where("em.message_id = ?", messageID).
		Order("entries.created_at ASC").Find(&rows).Error
	return mapEntries(rows), err
}

func mapEntries(rows []entryRow) []model.Entry {
	out := make([]model.Entry, 0, len(rows))
	for _, r := range rows {
		out = append(out, toEntry(r))
	}
	return out
}
