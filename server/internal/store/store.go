// Package store 封裝 SQLite 持久層。原型階段用 SQLite,之後可換成 Postgres + pgvector。
package store

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite" // 純 Go SQLite driver,免 CGO
)

type Store struct {
	db *sql.DB
}

// Open 開啟(或建立)SQLite 資料庫並套用 schema。
func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	if _, err := db.Exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`); err != nil {
		return nil, fmt.Errorf("set pragmas: %w", err)
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	const schema = `
CREATE TABLE IF NOT EXISTS channels (
	id           TEXT PRIMARY KEY,
	name         TEXT NOT NULL,
	created_at   DATETIME NOT NULL,
	updated_at   DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
	id           TEXT PRIMARY KEY,
	channel_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
	author_id    TEXT NOT NULL,
	author_name  TEXT NOT NULL,
	text         TEXT NOT NULL,
	category     TEXT,
	tags         TEXT,            -- JSON 陣列字串
	summary      TEXT,
	created_at   DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);

CREATE TABLE IF NOT EXISTS members (
	channel_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
	user_id      TEXT NOT NULL,
	user_name    TEXT NOT NULL,
	avatar_color TEXT NOT NULL,
	PRIMARY KEY (channel_id, user_id)
);

-- 可被搜尋並邀請的使用者目錄,同時是登入帳號。
CREATE TABLE IF NOT EXISTS users (
	id           TEXT PRIMARY KEY,
	name         TEXT NOT NULL,
	avatar_color TEXT NOT NULL,
	apple_sub    TEXT UNIQUE          -- Apple 登入的穩定 ID,可為 NULL(seed 的示範使用者)
);
`
	_, err := s.db.Exec(schema)
	if err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	// 對舊資料庫補上 apple_sub 欄位(欄位已存在時 SQLite 會報錯,忽略之)。
	_, _ = s.db.Exec(`ALTER TABLE users ADD COLUMN apple_sub TEXT`)
	return nil
}

// now 統一回傳 UTC 時間。
func now() time.Time { return time.Now().UTC() }
