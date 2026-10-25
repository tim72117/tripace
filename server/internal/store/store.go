// Package store 封裝持久層(GORM + SQLite)。原型階段用 SQLite,
// 之後可換成 Postgres + pgvector(GORM 換 driver 即可,store 介面不變)。
package store

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/glebarez/sqlite" // 純 Go SQLite driver,免 CGO
	"gorm.io/driver/postgres"    // Postgres driver(正式環境為 Cloud SQL)
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// ErrNotFound 是 store 層統一的「查無資料」錯誤。
var ErrNotFound = errors.New("not found")

// ErrAlreadyExists 是 store 層統一的「違反唯一性限制,該筆資料已存在」
// 錯誤——見 CreateContentPage 的完整說明,用於需要事先判斷「這個鍵已經
// 用過」而非讓底層 driver 專屬錯誤字串直接往外傳的建立操作。
var ErrAlreadyExists = errors.New("already exists")

type Store struct {
	db *gorm.DB

	// MigrationOK 記錄 Open() 當初呼叫 AutoMigrate 是否成功。AutoMigrate 失敗時
	// Open() 不會回傳 error(見下方註解),而是讓 server 帶著可能不完整的 schema
	// 降級啟動;這個欄位讓之後有需要的呼叫端(例如健康檢查、監控)可以查詢「這個
	// Store 底層 schema 是否可能不完整」,回報服務降級中的訊號。
	MigrationOK bool
}

// Open 開啟(或建立)資料庫並用 AutoMigrate 套用 schema。
// dsn 為 postgres:// 或 postgresql:// 開頭時用 Postgres(正式環境為 Cloud SQL),
// 否則視為 SQLite 檔案路徑。store 介面不變,GORM 查詢兩邊通用。
func Open(dsn string) (*Store, error) {
	db, err := gorm.Open(dialector(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
		// TranslateError: true 讓 GORM 把 driver 專屬的「違反唯一約束」
		// 錯誤,統一轉換成跨 driver 一致的 gorm.ErrDuplicatedKey(見
		// isUniqueConstraintViolation 的完整說明)——這是解決「先查後建
		// 無法防止併發 race condition」問題的關鍵前提:gorm.io/driver/
		// postgres 與 github.com/glebarez/sqlite 兩個 driver 都各自實作了
		// gorm.ErrorTranslator 介面(分別依 PostgreSQL error code 23505、
		// SQLite 的 SQLITE_CONSTRAINT_UNIQUE/PRIMARYKEY 轉換),不需要我們
		// 自己解析 driver 專屬的錯誤字串格式(那正是 CreateContentPage
		// 註解裡提到「不可靠」的作法)。開啟這個選項不影響既有的
		// gorm.ErrRecordNotFound 判斷——兩者是不同的錯誤轉換情境,互不
		// 干擾。
		TranslateError: true,
	})
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	// members 中介表雖可由 many2many 關聯隱式建立,但那只會建 join 欄位
	// (trip_id / user_id),不含額外的 role 欄。故明確把 memberLink 納入
	// AutoMigrate,GORM 才會補上 role 欄(既有表則 ALTER ADD COLUMN,不損資料)。
	//
	// AutoMigrate 失敗故意不讓 Open() 回傳 error:資料庫連線本身是好的,只是
	// schema 可能有欄位型別衝突、約束衝突等問題未同步,這跟連線失敗是不同的失敗
	// 模式。若讓這裡的 error 往上傳,呼叫端(main.go)目前是 log.Fatalf,會導致
	// 整個 process 直接結束——即使這次的 schema 差異只影響某張表的某個功能,
	// 完全不相關的功能(登入、查行程列表等)也會一起無法使用。故改成記錄一則
	// 明顯的警示 log 後繼續,讓 server 降級啟動;只有實際用到未同步欄位的功能
	// 才會在被呼叫到時出錯,這是可接受的降級行為。
	// contentPageRow 的 Slug uniqueIndex 2026-10 從單欄位改成帶 name 的
	// 複合索引 ux_content_pages_owner_slug(見該 struct 的完整說明:slug
	// 唯一性範圍從「全域」改成「同一個 owner_id 之內」)——這張表從未
	// 進入 main、正式環境未部署過,不存在「既有資料庫殘留舊索引」需要
	// 處理的情境,AutoMigrate 建的新表從一開始就是正確的複合索引,不需要
	// 額外的舊索引清理邏輯。
	migrationOK := true
	if err := db.AutoMigrate(&userRow{}, &tripRow{}, &entryRow{}, &memberLink{}, &publicLinkRow{}, &cliAuthSessionRow{}, &attractionRow{}, &attractionTagRow{}, &contentPageRow{}, &itineraryPageRow{}, &blogProfileRow{}, &uploadedPhotoRow{}, &photoVariantRow{}, &photoCacheRow{}, &placeDetailsCacheRow{}, &googlePlacePhotoRow{}, &placePexelsPhotoRow{}, &pexelsPhotoCacheRow{}, &photoAssetRow{}, &apiRequestLogRow{}, &geoAPICallLogRow{}, &geoRateLimitRow{}, &geoFieldMaskRow{}, &geoSettingRow{}, &planAiChatMessageRow{}); err != nil {
		log.Printf("!!! AutoMigrate 失敗,資料庫 schema 可能未同步,部分功能可能異常或無法使用,請盡快檢查: %v", err)
		migrationOK = false
	}
	return &Store{db: db, MigrationOK: migrationOK}, nil
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

// Ping 對底層資料庫連線發一次 ping(SQLite/Postgres 皆適用),供健康檢查
// (adminconsole 的 /admin/api/health/external)使用。ctx 帶 timeout/deadline
// 由呼叫端控制,這裡不自行加逾時。
func (s *Store) Ping(ctx context.Context) error {
	sqlDB, err := s.db.DB()
	if err != nil {
		return fmt.Errorf("get underlying *sql.DB: %w", err)
	}
	return sqlDB.PingContext(ctx)
}

// now 統一回傳 UTC 時間。
func now() time.Time { return time.Now().UTC() }

// isUniqueConstraintViolation 判斷一個來自寫入呼叫(Create/Updates)的
// 錯誤,是不是「違反唯一約束」——供 CreateContentPage/CreateBlogProfile/
// UpdateBlogProfile 在「先查後建/先查後改」之外,對最終寫入本身也做一層
// race-safe 的保護(見這幾個方法呼叫處的完整說明:先查後建無法防止兩個
// 併發請求都通過檢查、最終其中一個撞上資料庫唯一索引的情境)。
//
// 比對方式是 errors.Is(err, gorm.ErrDuplicatedKey)——這個錯誤值由 GORM
// 的 TranslateError 機制(見 Open() 的 gorm.Config 說明)依 driver 各自
// 的結構化錯誤型別轉換而來(postgres driver 比對 *pgconn.PgError.Code、
// sqlite driver 比對 *sqlite3.Error.Code()),不是解析 Error() 字串內容
// ——這是型別斷言等級的可靠度,跨 SQLite/Postgres 一致,維持了
// CreateContentPage 原本註解提到「不依賴解析 driver 專屬錯誤字串」這個
// 設計理由,同時解決了「先查後建」本身解決不了的併發問題。
func isUniqueConstraintViolation(err error) bool {
	return errors.Is(err, gorm.ErrDuplicatedKey)
}
