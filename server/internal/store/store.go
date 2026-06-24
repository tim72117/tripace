// Package store 封裝持久層(GORM + SQLite)。原型階段用 SQLite,
// 之後可換成 Postgres + pgvector(GORM 換 driver 即可,store 介面不變)。
package store

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/glebarez/sqlite" // 純 Go SQLite driver,免 CGO
	"gorm.io/driver/postgres"    // Postgres driver(Neon / Cloud SQL)
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// ErrNotFound 是 store 層統一的「查無資料」錯誤。
var ErrNotFound = errors.New("not found")

type Store struct {
	db *gorm.DB
}

// Open 開啟(或建立)資料庫並用 AutoMigrate 套用 schema。
// dsn 為 postgres:// 或 postgresql:// 開頭時用 Postgres(Neon / Cloud SQL),
// 否則視為 SQLite 檔案路徑。store 介面不變,GORM 查詢兩邊通用。
func Open(dsn string) (*Store, error) {
	db, err := gorm.Open(dialector(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	// many2many 的 members 中介表由 GORM 從關聯自動建立。
	if err := db.AutoMigrate(&userRow{}, &channelRow{}, &entryRow{}); err != nil {
		return nil, fmt.Errorf("automigrate: %w", err)
	}
	return &Store{db: db}, nil
}

// dialector 依 dsn 前綴挑選 GORM driver:
// postgres:// 或 postgresql:// → Postgres;其餘 → SQLite 檔案路徑。
func dialector(dsn string) gorm.Dialector {
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		return postgres.Open(dsn)
	}
	return sqlite.Open(dsn)
}

func (s *Store) Close() error {
	sqlDB, err := s.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

// now 統一回傳 UTC 時間。
func now() time.Time { return time.Now().UTC() }
