package store

import (
	"github.com/channel/server/internal/model"
)

// ListMessages 回傳頻道全部訊息,依時間舊到新。
// 供 LLM 查詢用(查詢需看頻道所有訊息);聊天畫面顯示請改用 ListMessagesByAuthor。
func (s *Store) ListMessages(channelID string) ([]model.Message, error) {
	const q = `
SELECT id, channel_id, author_id, author_name, text, category, tags, summary, created_at
FROM messages WHERE channel_id = ? ORDER BY created_at ASC;`
	return s.queryMessages(q, channelID)
}

// ListMessagesByAuthor 只回傳指定作者在該頻道發的訊息。
// 聊天畫面用:每個人(含 owner)只看到自己輸入過的訊息。
func (s *Store) ListMessagesByAuthor(channelID, authorID string) ([]model.Message, error) {
	const q = `
SELECT id, channel_id, author_id, author_name, text, category, tags, summary, created_at
FROM messages WHERE channel_id = ? AND author_id = ? ORDER BY created_at ASC;`
	return s.queryMessages(q, channelID, authorID)
}

func (s *Store) queryMessages(q string, args ...any) ([]model.Message, error) {
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []model.Message
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// InsertMessage 將訊息(含 LLM 標注結果)寫入資料庫,並更新頻道時間。
func (s *Store) InsertMessage(m model.Message) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var category, summary any
	if m.Category != nil {
		category = *m.Category
	}
	if m.Summary != nil {
		summary = *m.Summary
	}

	if _, err := tx.Exec(`
INSERT INTO messages (id, channel_id, author_id, author_name, text, category, tags, summary, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		m.ID, m.ChannelID, m.AuthorID, m.AuthorName, m.Text,
		category, encodeTags(m.Tags), summary, m.CreatedAt); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE channels SET updated_at = ? WHERE id = ?`, m.CreatedAt, m.ChannelID); err != nil {
		return err
	}
	return tx.Commit()
}

// rowScanner 讓 *sql.Row 與 *sql.Rows 共用掃描邏輯。
type rowScanner interface {
	Scan(dest ...any) error
}

func scanMessage(r rowScanner) (model.Message, error) {
	var m model.Message
	var category, summary, tags *string
	if err := r.Scan(&m.ID, &m.ChannelID, &m.AuthorID, &m.AuthorName, &m.Text,
		&category, &tags, &summary, &m.CreatedAt); err != nil {
		return model.Message{}, err
	}
	m.Category = category
	m.Summary = summary
	if tags != nil {
		m.Tags = decodeTags(*tags)
	}
	if m.Tags == nil {
		m.Tags = []string{}
	}
	return m, nil
}
