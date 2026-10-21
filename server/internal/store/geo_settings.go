package store

import "gorm.io/gorm/clause"

// GeoSetting 是 geoSettingRow 對外曝露的形狀(見該型別的完整說明)。
type GeoSetting struct {
	Key   string `json:"key"`
	Value int    `json:"value"`
}

// ListGeoSettings 回傳目前資料庫裡全部已自訂的數值設定,依 key 字母序排序
// (理由同 ListGeoRateLimits:讓 CLI 的表格順序固定)。沒有資料列的設定
// 不會出現在這裡——呼叫端要自己用登錄表預設值補上。
func (s *Store) ListGeoSettings() ([]GeoSetting, error) {
	var rows []geoSettingRow
	if err := s.db.Order("key asc").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]GeoSetting, 0, len(rows))
	for _, r := range rows {
		out = append(out, GeoSetting{Key: r.Key, Value: r.Value})
	}
	return out, nil
}

// UpsertGeoSetting 新增或覆蓋一項數值設定。
//
// 呼叫端(維運端點)負責驗證 key 在登錄表裡、value 在合法範圍內,這一層不
// 重複驗證:store 的職責是存取,不是業務規則。用 clause.OnConflict 而非先查
// 後寫,理由同 UpsertGeoFieldMask(單一 SQL 陳述式)。
func (s *Store) UpsertGeoSetting(key string, value int) error {
	row := geoSettingRow{Key: key, Value: value, UpdatedAt: now()}
	return s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
	}).Create(&row).Error
}
