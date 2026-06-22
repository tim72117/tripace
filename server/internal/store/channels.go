package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/channel/server/internal/model"
)

var ErrNotFound = errors.New("not found")

// ListChannels 回傳所有頻道(原型階段不分使用者),依更新時間新到舊。
func (s *Store) ListChannels() ([]model.Channel, error) {
	const q = `
SELECT c.id, c.name, c.updated_at,
       (SELECT COUNT(*) FROM members m WHERE m.channel_id = c.id) AS member_count,
       (SELECT text FROM messages msg WHERE msg.channel_id = c.id
        ORDER BY msg.created_at DESC LIMIT 1) AS last_preview
FROM channels c
ORDER BY c.updated_at DESC;`
	rows, err := s.db.Query(q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []model.Channel
	for rows.Next() {
		var c model.Channel
		var preview sql.NullString
		if err := rows.Scan(&c.ID, &c.Name, &c.UpdatedAt, &c.MemberCount, &preview); err != nil {
			return nil, err
		}
		if preview.Valid {
			c.LastMessagePreview = &preview.String
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CreateChannel 建立頻道,建立者自動成為成員。
func (s *Store) CreateChannel(id, name string, creator model.User) (model.Channel, error) {
	t := now()
	tx, err := s.db.Begin()
	if err != nil {
		return model.Channel{}, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`INSERT INTO channels (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
		id, name, t, t); err != nil {
		return model.Channel{}, fmt.Errorf("insert channel: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO members (channel_id, user_id, user_name, avatar_color) VALUES (?, ?, ?, ?)`,
		id, creator.ID, creator.Name, creator.AvatarColor); err != nil {
		return model.Channel{}, fmt.Errorf("insert member: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return model.Channel{}, err
	}
	return model.Channel{ID: id, Name: name, MemberCount: 1, UpdatedAt: t}, nil
}

// channelExists 確認頻道存在。
func (s *Store) channelExists(id string) (bool, error) {
	var x int
	err := s.db.QueryRow(`SELECT 1 FROM channels WHERE id = ?`, id).Scan(&x)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// ----- 成員 -----

func (s *Store) ListMembers(channelID string) ([]model.User, error) {
	rows, err := s.db.Query(
		`SELECT user_id, user_name, avatar_color FROM members WHERE channel_id = ? ORDER BY user_name`,
		channelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.User
	for rows.Next() {
		var u model.User
		if err := rows.Scan(&u.ID, &u.Name, &u.AvatarColor); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// AddMember 加入成員(冪等),回傳更新後的成員清單。
func (s *Store) AddMember(channelID string, u model.User) ([]model.User, error) {
	ok, err := s.channelExists(channelID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	_, err = s.db.Exec(
		`INSERT OR IGNORE INTO members (channel_id, user_id, user_name, avatar_color) VALUES (?, ?, ?, ?)`,
		channelID, u.ID, u.Name, u.AvatarColor)
	if err != nil {
		return nil, err
	}
	return s.ListMembers(channelID)
}

// ----- 使用者目錄 -----

// UpsertUser 寫入或更新一筆可邀請使用者(供 seed)。
func (s *Store) UpsertUser(u model.User) error {
	_, err := s.db.Exec(
		`INSERT INTO users (id, name, avatar_color) VALUES (?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET name = excluded.name, avatar_color = excluded.avatar_color`,
		u.ID, u.Name, u.AvatarColor)
	return err
}

// SearchUsers 依名稱關鍵字搜尋可邀請的使用者(keyword 為空回傳全部)。
func (s *Store) SearchUsers(keyword string) ([]model.User, error) {
	var (
		rows *sql.Rows
		err  error
	)
	if keyword == "" {
		rows, err = s.db.Query(`SELECT id, name, avatar_color FROM users ORDER BY name`)
	} else {
		rows, err = s.db.Query(
			`SELECT id, name, avatar_color FROM users WHERE name LIKE ? ORDER BY name`,
			"%"+keyword+"%")
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []model.User
	for rows.Next() {
		var u model.User
		if err := rows.Scan(&u.ID, &u.Name, &u.AvatarColor); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// encodeTags / decodeTags:tags 以 JSON 字串存欄位。
func encodeTags(tags []string) string {
	if len(tags) == 0 {
		return "[]"
	}
	b, _ := json.Marshal(tags)
	return string(b)
}

func decodeTags(s string) []string {
	if s == "" {
		return nil
	}
	var tags []string
	_ = json.Unmarshal([]byte(s), &tags)
	return tags
}
