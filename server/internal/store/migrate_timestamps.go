package store

// migrate_timestamps.go:把 entries/trips 的時間欄位從字串改成 timestamptz。
//
// 背景:原本 entries 存 start('YYYY-MM-DD')、start_time('HH:MM')、end_at、
// end_time 四個字串欄位,trips 存 start/end_at 兩個字串。字串比較有邊界 bug
// (trips.go 曾為此寫 parseLower/parseUpper 繞路),DB 也無法做正確的範圍查詢、
// 索引與排序。改成:
//
//	start_at timestamptz(UTC)  — 絕對時刻
//	end_at   timestamptz(UTC)
//	tz       varchar           — 該事件所屬 IANA 時區(如 Asia/Tokyo)
//	all_day  boolean           — 取代舊的「start_time 為空即全日」約定
//
// 為什麼不能只靠 AutoMigrate:GORM 的 AutoMigrate 只增不改,既有的 end_at
// 是 text 型別,新定義要 timestamptz,AutoMigrate 不會替換型別。故本檔案採
// 「改名保存 → AutoMigrate 建新欄位 → 回填 → 刪舊欄位」四步,在 Open() 裡
// 夾在 AutoMigrate 前後執行。
//
// 舊資料的時區假設:舊字串完全沒有時區資訊,轉成絕對時刻時必須假設一個時區。
// 預設 Asia/Taipei(專案所在地),可用環境變數 LEGACY_TIME_ZONE 覆寫。這個
// 假設會被寫進每列的 tz 欄位,之後若發現某批資料其實是別的時區,可以依 tz
// 值定位並修正。

import (
	"fmt"
	"log"
	"os"
	"time"

	"gorm.io/gorm"
)

// legacyTimeColumns 是這次要淘汰的字串時間欄位,key 是原欄位名、value 是
// 遷移期間的暫存欄位名。end_at 要改名是因為新的 timestamptz 欄位沿用同名。
var (
	legacyEntryTimeColumns = map[string]string{
		"start":      "legacy_start",
		"start_time": "legacy_start_time",
		"end_at":     "legacy_end_at",
		"end_time":   "legacy_end_time",
	}
	legacyTripTimeColumns = map[string]string{
		"start":  "legacy_start",
		"end_at": "legacy_end_at",
	}
)

// legacyTimeZone 回傳詮釋舊字串時間所用的時區,可用 LEGACY_TIME_ZONE 覆寫
// (獨立於 DefaultTimeZone,讓「這批舊資料當初是哪個時區」與「新記錄預設
// 用哪個時區」可以分開調整——例如未來若確認某批舊資料其實是別的時區,
// 不會牽動新記錄的預設行為)。
func legacyTimeZone() *time.Location {
	return loadTimeZoneEnv("LEGACY_TIME_ZONE")
}

// DefaultTimeZone 回傳「不知道實際時區時」的 fallback 時區,可用
// DEFAULT_TIME_ZONE 環境變數覆寫,預設 Asia/Taipei(專案所在地)。
//
// 用於 tripsvc 記錄新 entry/trip 時決定 tz 欄位——目前呼叫端(REST API、
// CLI)只給日期時刻字串,不帶時區資訊,故需要一個 fallback。這是刻意的
// 簡化:更精確的做法是用 entry 的 location 經緯度反查當地時區(例如透過
// Google Time Zone API),但那需要額外的外部服務依賴與錯誤處理,不在這次
// 「字串欄位改 timestamptz」的改動範圍內,留待後續視需求評估。
func DefaultTimeZone() *time.Location {
	return loadTimeZoneEnv("DEFAULT_TIME_ZONE")
}

func loadTimeZoneEnv(envName string) *time.Location {
	name := os.Getenv(envName)
	if name == "" {
		name = "Asia/Taipei"
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		log.Printf("!!! %s=%q 無法解析(%v),改用 UTC", envName, name, err)
		return time.UTC
	}
	return loc
}

// renameLegacyTimeColumns 在 AutoMigrate 之前把舊的字串時間欄位改名,讓
// AutoMigrate 能以正確型別建出新欄位,同時保住舊值供後續回填。
// 冪等:欄位不存在(已遷移過)就跳過。
func renameLegacyTimeColumns(db *gorm.DB) error {
	m := db.Migrator()
	rename := func(model any, cols map[string]string) error {
		for oldName, newName := range cols {
			// 舊欄位不在(已遷移過)或暫存欄位已存在(上次遷移中斷)時都跳過,
			// 避免重複改名把新建的 timestamptz 欄位誤當成舊欄位搬走。
			if !m.HasColumn(model, oldName) || m.HasColumn(model, newName) {
				continue
			}
			// 只有字串型別的才是舊欄位。start_at/end_at 若已是 timestamptz
			// 代表這張表已經遷移完成,不該再動。
			isLegacy, err := columnIsTextual(db, model, oldName)
			if err != nil {
				return err
			}
			if !isLegacy {
				continue
			}
			if err := m.RenameColumn(model, oldName, newName); err != nil {
				return fmt.Errorf("rename %s -> %s: %w", oldName, newName, err)
			}
			log.Printf("[migrate] 已將舊時間欄位 %s 改名為 %s,待回填後刪除", oldName, newName)
		}
		return nil
	}
	if err := rename(&entryRow{}, legacyEntryTimeColumns); err != nil {
		return err
	}
	return rename(&tripRow{}, legacyTripTimeColumns)
}

// columnIsTextual 判斷欄位是否為字串型別(TEXT/VARCHAR),用來區分「還沒遷移
// 的舊字串欄位」與「已經遷移好的 timestamptz 欄位」。
func columnIsTextual(db *gorm.DB, model any, column string) (bool, error) {
	types, err := db.Migrator().ColumnTypes(model)
	if err != nil {
		return false, err
	}
	for _, ct := range types {
		if ct.Name() != column {
			continue
		}
		dbType := ct.DatabaseTypeName()
		// SQLite 回 TEXT/VARCHAR;Postgres 回 text/varchar/character varying。
		switch dbType {
		case "TEXT", "text", "VARCHAR", "varchar", "character varying":
			return true, nil
		}
		return false, nil
	}
	return false, nil
}

// backfillTimestamps 把改名保存的舊字串值解析成 UTC 時刻,寫進新欄位,
// 然後刪掉暫存欄位。在 AutoMigrate 之後執行。
func backfillTimestamps(db *gorm.DB) error {
	loc := legacyTimeZone()
	m := db.Migrator()

	// entries:start + start_time 合成 start_at,end_at + end_time 合成 end_at。
	if m.HasColumn(&entryRow{}, "legacy_start") {
		type legacyEntry struct {
			ID              string
			LegacyStart     string
			LegacyStartTime string
			LegacyEndAt     string
			LegacyEndTime   string
		}
		var rows []legacyEntry
		if err := db.Table("entries").
			Select("id, legacy_start, legacy_start_time, legacy_end_at, legacy_end_time").
			Scan(&rows).Error; err != nil {
			return fmt.Errorf("讀取 entries 舊時間欄位: %w", err)
		}
		for _, r := range rows {
			startAt, allDay := parseLegacyDateTime(r.LegacyStart, r.LegacyStartTime, loc)
			endAt, _ := parseLegacyDateTime(r.LegacyEndAt, r.LegacyEndTime, loc)
			updates := map[string]any{
				"start_at": startAt,
				"end_at":   endAt,
				"all_day":  allDay,
			}
			// 舊資料沒有時區資訊,一律標成這次假設的時區,讓之後能定位。
			if startAt != nil || endAt != nil {
				updates["tz"] = loc.String()
			}
			if err := db.Table("entries").Where("id = ?", r.ID).Updates(updates).Error; err != nil {
				return fmt.Errorf("回填 entry %s: %w", r.ID, err)
			}
		}
		log.Printf("[migrate] entries 時間欄位回填完成(%d 筆,時區假設 %s)", len(rows), loc)
	}

	// trips:舊值可能是純日期或帶時刻,一律用同一套解析。
	if m.HasColumn(&tripRow{}, "legacy_start") {
		type legacyTrip struct {
			ID          string
			LegacyStart string
			LegacyEndAt string
		}
		var rows []legacyTrip
		if err := db.Table("trips").
			Select("id, legacy_start, legacy_end_at").
			Scan(&rows).Error; err != nil {
			return fmt.Errorf("讀取 trips 舊時間欄位: %w", err)
		}
		for _, r := range rows {
			startAt, _ := parseLegacyDateTime(r.LegacyStart, "", loc)
			endAt, _ := parseLegacyDateTime(r.LegacyEndAt, "", loc)
			updates := map[string]any{"start_at": startAt, "end_at": endAt}
			if startAt != nil || endAt != nil {
				updates["tz"] = loc.String()
			}
			if err := db.Table("trips").Where("id = ?", r.ID).Updates(updates).Error; err != nil {
				return fmt.Errorf("回填 trip %s: %w", r.ID, err)
			}
		}
		log.Printf("[migrate] trips 時間欄位回填完成(%d 筆,時區假設 %s)", len(rows), loc)
	}

	// 回填成功才刪暫存欄位——刪除是不可逆的,放在最後。
	drop := func(model any, cols map[string]string) error {
		for _, tmpName := range cols {
			if !m.HasColumn(model, tmpName) {
				continue
			}
			if err := m.DropColumn(model, tmpName); err != nil {
				return fmt.Errorf("刪除暫存欄位 %s: %w", tmpName, err)
			}
		}
		return nil
	}
	if err := drop(&entryRow{}, legacyEntryTimeColumns); err != nil {
		return err
	}
	return drop(&tripRow{}, legacyTripTimeColumns)
}

// parseLegacyDateTime 把舊的日期字串 + 時刻字串合成 UTC 時刻,是
// ParseLocalDateTime(timeconv.go)的薄包裝——遷移邏輯與一般業務邏輯共用同一套
// 解析規則,只是這裡額外印一則 log 標明是哪個舊值解析失敗,方便事後追查
// migration 有沒有漏掉哪批資料。
func parseLegacyDateTime(date, timeStr string, loc *time.Location) (*time.Time, bool) {
	t, allDay := ParseLocalDateTime(date, timeStr, loc)
	if t == nil && date != "" {
		log.Printf("[migrate] 無法解析舊時間值 %q %q,略過", date, timeStr)
	}
	return t, allDay
}
