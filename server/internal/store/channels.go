package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/channel/server/internal/model"
)

var ErrNotFound = errors.New("not found")

// ListChannelsForUser 回傳指定使用者參與(為成員)的頻道,依更新時間新到舊。
// 頻道對應到各人:只看得到自己是成員的頻道。
func (s *Store) ListChannelsForUser(userID string) ([]model.Channel, error) {
	const q = `
SELECT c.id, c.name, c.owner_id, c.updated_at,
       (SELECT COUNT(*) FROM members m2 WHERE m2.channel_id = c.id) AS member_count,
       (SELECT text FROM messages msg WHERE msg.channel_id = c.id
        ORDER BY msg.created_at DESC LIMIT 1) AS last_preview
FROM channels c
JOIN members m ON m.channel_id = c.id AND m.user_id = ?
ORDER BY c.updated_at DESC;`
	rows, err := s.db.Query(q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []model.Channel
	for rows.Next() {
		var c model.Channel
		var preview sql.NullString
		if err := rows.Scan(&c.ID, &c.Name, &c.OwnerID, &c.UpdatedAt, &c.MemberCount, &preview); err != nil {
			return nil, err
		}
		if preview.Valid {
			c.LastMessagePreview = &preview.String
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CreateChannel 建立頻道,建立者即為擁有者(owner),並自動成為成員。
func (s *Store) CreateChannel(id, name string, creator model.User) (model.Channel, error) {
	t := now()
	tx, err := s.db.Begin()
	if err != nil {
		return model.Channel{}, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`INSERT INTO channels (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		id, name, creator.ID, t, t); err != nil {
		return model.Channel{}, fmt.Errorf("insert channel: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO members (channel_id, user_id, user_name, avatar_color) VALUES (?, ?, ?, ?)`,
		id, creator.ID, creator.Name, creator.AvatarColor); err != nil {
		return model.Channel{}, fmt.Errorf("insert member: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return model.Channel{}, err
	}
	return model.Channel{ID: id, Name: name, OwnerID: creator.ID, MemberCount: 1, UpdatedAt: t}, nil
}

// GetChannelOwner 回傳頻道的 owner_id;頻道不存在回 ErrNotFound。
func (s *Store) GetChannelOwner(channelID string) (string, error) {
	var owner string
	err := s.db.QueryRow(`SELECT owner_id FROM channels WHERE id = ?`, channelID).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return owner, err
}

// CountChannels 回傳頻道總數(seed 判斷資料庫是否為空用,不分使用者)。
func (s *Store) CountChannels() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM channels`).Scan(&n)
	return n, err
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
