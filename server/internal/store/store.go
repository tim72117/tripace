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
	migrationOK := true
	if err := db.AutoMigrate(&userRow{}, &tripRow{}, &entryRow{}, &memberLink{}, &publicLinkRow{}, &adminUserRow{}, &adminSessionRow{}, &cliAuthSessionRow{}, &attractionRow{}, &photoCacheRow{}, &placeDetailsCacheRow{}, &googlePlacePhotoRow{}, &placePexelsPhotoRow{}, &pexelsPhotoCacheRow{}, &photoAssetRow{}, &apiRequestLogRow{}, &geoAPICallLogRow{}, &geoRateLimitRow{}); err != nil {
		log.Printf("!!! AutoMigrate 失敗,資料庫 schema 可能未同步,部分功能可能異常或無法使用,請盡快檢查: %v", err)
		migrationOK = false
	}
	if migrationOK {
		repairGooglePhotoTargetCountDeadlock(db)
	}
	return &Store{db: db, MigrationOK: migrationOK}, nil
}

// repairGooglePhotoTargetCountDeadlock 修正 entity.go
// placeDetailsCacheRow.GooglePhotoTargetCount 欄位說明裡記載的死鎖 bug——
// AutoMigrate 新增這個欄位時的 default:-1(見該欄位完整說明)只套用在
// 「新增欄位當下」,不會回頭修正已存在、卡在合法值 0 的既有資料列,故
// 需要這段額外的一次性 UPDATE,每次 Open() 都執行(跟 AutoMigrate 一樣
// 是 idempotent 的收斂操作,不是只跑一次的遷移腳本——沒有任何一次性
// migration runner 或版本表,單純每次啟動都重新執行同一條收斂條件,已經
// 符合條件的資料列會被 WHERE 子句排除、不會重複判斷或造成任何副作用)。
//
// 只鎖定「曾經有漸進補圖紀錄(NewPhotoCount > 0),但 GooglePhotoTargetCount
// 卡在 0」這個矛盾狀態的資料列——target 卡在 0 理論上代表「已確認、
// Google 那次真的回傳空 photos[]」,不該再有任何後續補圖動作,若
// NewPhotoCount 卻大於 0,代表這筆資料是在這個 bug 修復前,先合法地
// (透過某次查詢查到非空 photos[])把 target 寫成非 0 值、開始漸進補圖,
// 之後又被同一個死鎖 bug 的另一種路徑重新覆寫回 0(shouldAddGooglePlacePhoto
// 的完整說明有記載這個死鎖成因),兩個欄位互相矛盾,是明確能判定「這筆
// 資料被這個 bug 影響過」的訊號,不會誤傷「這個地點本來就經確認是 0 張,
// 從未觸發過任何補圖」的合法狀態(那種資料列 NewPhotoCount 也會是 0,
// 不會落入這條 WHERE 條件)。修正後改回 -1(未確認 sentinel),下次該
// 地點被點擊時 shouldAddGooglePlacePhoto 會無條件觸發重新跟 Google
// 確認一次,不會永遠卡住。
func repairGooglePhotoTargetCountDeadlock(db *gorm.DB) {
	result := db.Exec(
		`UPDATE place_details_cache SET google_photo_target_count = -1 WHERE google_photo_target_count = 0 AND new_photo_count > 0`,
	)
	if result.Error != nil {
		log.Printf("!!! repairGooglePhotoTargetCountDeadlock 執行失敗,受影響的地點可能持續卡在死鎖 bug 中: %v", result.Error)
		return
	}
	if result.RowsAffected > 0 {
		log.Printf("repairGooglePhotoTargetCountDeadlock 修正了 %d 筆卡在 google_photo_target_count=0 死鎖的資料列", result.RowsAffected)
	}
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
