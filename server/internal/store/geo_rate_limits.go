package store

import "gorm.io/gorm/clause"

// GeoRateLimit 是 geoRateLimitRow 對外曝露的形狀(見該型別的完整說明)——
// 跟 store 層其餘資料一樣,不直接把 GORM row 型別外流給呼叫端。
type GeoRateLimit struct {
	Endpoint  string `json:"endpoint"`
	WindowSec int    `json:"windowSec"`
	MaxCalls  int    `json:"maxCalls"`
	DailyMax  int    `json:"dailyMax"`
	UsedToday int    `json:"usedToday"`
	UsedDay   string `json:"usedDay"`
}

func toGeoRateLimit(r geoRateLimitRow) GeoRateLimit {
	return GeoRateLimit{
		Endpoint:  r.Endpoint,
		WindowSec: r.WindowSec,
		MaxCalls:  r.MaxCalls,
		DailyMax:  r.DailyMax,
		UsedToday: r.UsedToday,
		UsedDay:   r.UsedDay,
	}
}

// ListGeoRateLimits 回傳目前資料庫裡全部已設定的限流規則,依 endpoint
// 字母序排序(供後台管理介面渲染一張固定順序的表格,避免每次重新整理
// 順序跳動)。
func (s *Store) ListGeoRateLimits() ([]GeoRateLimit, error) {
	var rows []geoRateLimitRow
	if err := s.db.Order("endpoint asc").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]GeoRateLimit, 0, len(rows))
	for _, r := range rows {
		out = append(out, toGeoRateLimit(r))
	}
	return out, nil
}

// UpsertGeoRateLimit 新增或覆蓋一筆 endpoint 的限流規則(windowSec/
// maxCalls/dailyMax)——供後台管理介面的編輯表單使用。刻意不動
// UsedToday/UsedDay(每日額度的目前使用量),理由同 UpdateAttractionFields
// 之於 UpdatedAt 的既有慣例:調整規則上限不代表「今天已經用掉的次數」
// 應該被重置,那是 IncrementGeoRateLimitDailyUsage 換日時才會做的事;
// 若在這裡連帶歸零,使用者調整 maxCalls 後會意外讓當天的每日額度計數
// 也跟著清空,行為出乎意料。用 clause.OnConflict 的 DoUpdates 而非先
// 查後寫,理由同其餘 store 方法偏好單一 SQL 陳述式完成的一貫風格,不是
// 併發熱點(後台編輯頻率遠低於限流檢查本身),不需要額外的交易保護。
func (s *Store) UpsertGeoRateLimit(endpoint string, windowSec, maxCalls, dailyMax int) error {
	row := geoRateLimitRow{
		Endpoint:  endpoint,
		WindowSec: windowSec,
		MaxCalls:  maxCalls,
		DailyMax:  dailyMax,
		UpdatedAt: now(),
	}
	return s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "endpoint"}},
		DoUpdates: clause.AssignmentColumns([]string{"window_sec", "max_calls", "daily_max", "updated_at"}),
	}).Create(&row).Error
}

// IncrementGeoRateLimitDailyUsage 對 endpoint 的每日額度用量做原子性
// +1,並回傳遞增後的 usedToday 與目前設定的 dailyMax,供呼叫端判斷這次
// 呼叫是否超過每日額度——理由與寫法同 IncrementPlaceClickCount(見
// geocache.go 的完整說明:單一 UPDATE 陳述式在 SQL 端完成加法,避免
// read-modify-write 競態),差別在這裡多了「換日歸零」的判斷:
// used_day 欄位存 "2006-01-02" 格式的日期字串(UTC,見 geoRateLimitRow
// 的完整說明),today 由呼叫端傳入(避免這個套件跟呼叫端對「現在的日期」
// 各自求值、在午夜附近出現一次以上的不一致)。
//
// 用 CASE 表達式讓「今天第一次用(need 歸零)」與「今天已經用過(纯遞增)」
// 兩種情況在同一條 UPDATE 陳述式裡完成,不需要先 SELECT 判斷今天用過
// 沒有再決定要送哪一種 UPDATE——後者會在極端併發下出現「兩個請求都
// 判斷『今天是第一次』,都送歸零後設為 1 的 UPDATE」而漏算的競態,前者
// 不會,因為 UPDATE 本身的 SET 運算式在 SQL 端對每一列只會套用一次。
//
// endpoint 在 geo_rate_limits 裡還不存在時(尚未透過 UpsertGeoRateLimit
// 設定過這個 key),RowsAffected 為 0,比照 IncrementPlaceClickCount 對
// 「查無資料」的處理慣例回傳 ok=false、不當作 error——呼叫端(見
// geo.rateLimiterFromStore 的完整說明)預期在這個情況下退回不限制每日
// 額度,不阻擋呼叫。
func (s *Store) IncrementGeoRateLimitDailyUsage(endpoint, today string) (usedToday, dailyMax int, ok bool, err error) {
	result := s.db.Exec(
		`UPDATE geo_rate_limits
		 SET used_today = CASE WHEN used_day = ? THEN used_today + 1 ELSE 1 END,
		     used_day = ?,
		     updated_at = ?
		 WHERE endpoint = ?`,
		today, today, now(), endpoint,
	)
	if result.Error != nil {
		return 0, 0, false, result.Error
	}
	if result.RowsAffected == 0 {
		return 0, 0, false, nil
	}

	var row geoRateLimitRow
	if err := s.db.Where("endpoint = ?", endpoint).First(&row).Error; err != nil {
		return 0, 0, false, err
	}
	return row.UsedToday, row.DailyMax, true, nil
}
