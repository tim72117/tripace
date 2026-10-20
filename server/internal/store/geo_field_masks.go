package store

import "gorm.io/gorm/clause"

// GeoFieldMask 是 geoFieldMaskRow 對外曝露的形狀(見該型別的完整說明)。
type GeoFieldMask struct {
	Key    string `json:"key"`
	Fields string `json:"fields"`
}

// ListGeoFieldMasks 回傳目前資料庫裡全部已設定的 field mask,依 key
// 字母序排序(理由同 ListGeoRateLimits:讓後台/CLI 的表格順序固定,
// 不要每次重新整理就跳動)。
func (s *Store) ListGeoFieldMasks() ([]GeoFieldMask, error) {
	var rows []geoFieldMaskRow
	if err := s.db.Order("key asc").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]GeoFieldMask, 0, len(rows))
	for _, r := range rows {
		out = append(out, GeoFieldMask{Key: r.Key, Fields: r.Fields})
	}
	return out, nil
}

// UpsertGeoFieldMask 新增或覆蓋一個查詢情境的 field mask 設定。
//
// fields 是逗號分隔的欄位名稱清單(不含前綴——前綴由
// fieldmasks.Scenario.Mask 依情境自己加上,見該方法的完整說明)。
// 呼叫端(維運端點)負責驗證每個名稱都在登錄表裡、必填欄位都還在,
// 這一層不重複驗證:store 的職責是存取,不是業務規則。
//
// 用 clause.OnConflict 而非先查後寫,理由同 UpsertGeoRateLimit 的完整
// 說明(單一 SQL 陳述式、不是併發熱點)。
func (s *Store) UpsertGeoFieldMask(key, fields string) error {
	row := geoFieldMaskRow{
		Key:       key,
		Fields:    fields,
		UpdatedAt: now(),
	}
	return s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"fields", "updated_at"}),
	}).Create(&row).Error
}
