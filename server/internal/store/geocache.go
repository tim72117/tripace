package store

import (
	"errors"
	"time"

	"gorm.io/gorm"
)

// GetCachedPhoto 查詢已快取的 Google Places 圖片(見 photoCacheRow 的
// 完整說明)。ok 為 false 代表快取未命中(從未查過這個 photoRef+寬度
// 組合),呼叫端應照原本流程向 Google Photo Media API 查詢。
func (s *Store) GetCachedPhoto(photoRef string, maxWidthPx int) (dataURI string, ok bool, err error) {
	var row photoCacheRow
	err = s.db.Where("photo_ref = ? AND max_width_px = ?", photoRef, maxWidthPx).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return row.DataURI, true, nil
}

// SetCachedPhoto 寫入(或覆蓋既有)一筆圖片快取。用 photo_ref+寬度組合
// upsert,避免同一張圖片重複查詢時因為唯一鍵衝突而寫入失敗。
func (s *Store) SetCachedPhoto(photoRef string, maxWidthPx int, dataURI string) error {
	row := photoCacheRow{
		PhotoRef:   photoRef,
		MaxWidthPx: maxWidthPx,
		DataURI:    dataURI,
		FetchedAt:  now(),
	}
	return s.db.Save(&row).Error
}

// GetCachedPlaceDetails 查詢已快取的 Place Details 結果(見
// placeDetailsCacheRow 的完整說明)。maxAge 是這筆快取視為新鮮的上限
// (超過視為過期、當作未命中,呼叫端應重新查詢)——地點的名稱/地址/
// 評分/簡介理論上會隨時間變動(雖然頻率不高),不應該無限期信任一筆
// 很久以前查到的結果。
func (s *Store) GetCachedPlaceDetails(placeID string, maxAge time.Duration) (row placeDetailsCacheRow, ok bool, err error) {
	err = s.db.Where("place_id = ?", placeID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return placeDetailsCacheRow{}, false, nil
	}
	if err != nil {
		return placeDetailsCacheRow{}, false, err
	}
	if now().Sub(row.FetchedAt) > maxAge {
		return placeDetailsCacheRow{}, false, nil
	}
	return row, true, nil
}

// SetCachedPlaceDetails 寫入(或覆蓋既有)一筆 Place Details 快取。
func (s *Store) SetCachedPlaceDetails(placeID, name, address string, lat, lng, rating float64, summary, photoURL *string) error {
	row := placeDetailsCacheRow{
		PlaceID:   placeID,
		Name:      name,
		Address:   address,
		Lat:       lat,
		Lng:       lng,
		Rating:    rating,
		Summary:   summary,
		PhotoURL:  photoURL,
		FetchedAt: now(),
	}
	return s.db.Save(&row).Error
}

// LogAPIRequest 寫入一筆 API 請求記錄(見 apiRequestLogRow 的完整說明,
// 由 middleware.go 的 requestLogging 對每個請求呼叫一次)。
func (s *Store) LogAPIRequest(method, path string, statusCode int, durationMs int64, userID string) error {
	row := apiRequestLogRow{
		Method:     method,
		Path:       path,
		StatusCode: statusCode,
		DurationMs: durationMs,
		UserID:     userID,
		CreatedAt:  now(),
	}
	return s.db.Create(&row).Error
}

// LogGeoAPICall 寫入一筆對 Google Places/Geocoding API 的呼叫記錄(見
// geoAPICallLogRow 的完整說明)——由 api 層的 CallLogger 轉接實作呼叫,
// 對齊 apigateway.CallLogger 介面的簽章(見該介面的說明,err 不為 nil
// 時 statusCode 為 0)。
func (s *Store) LogGeoAPICall(endpoint, caller, path string, statusCode int, durationMs int64, errored bool) error {
	row := geoAPICallLogRow{
		Endpoint:   endpoint,
		Caller:     caller,
		Path:       path,
		StatusCode: statusCode,
		DurationMs: durationMs,
		Errored:    errored,
		CreatedAt:  now(),
	}
	return s.db.Create(&row).Error
}

// GeoAPICallStats 是依 endpoint+caller+path 分組的 Google API 呼叫統計,
// 供管理後台觀察「哪個功能、對應哪一條我方 API 路徑,對 Google 打了最多
// 請求」使用——跟 PathRequestStats(inbound,依我們自己的 method+path
// 分組)是對稱但獨立的一份統計,語意不同不合併查詢。
type GeoAPICallStats struct {
	Endpoint      string  `json:"endpoint"`
	Caller        string  `json:"caller"`
	Path          string  `json:"path"`
	Count         int64   `json:"count"`
	AvgDurationMs float64 `json:"avgDurationMs"`
	ErrorCount    int64   `json:"errorCount"` // errored=true 或 status_code>=400
}

// GeoAPICallStatsSince 回傳自 since 以來,依 endpoint+caller+path 分組的
// Google API 呼叫統計,依呼叫次數由多到少排序。
func (s *Store) GeoAPICallStatsSince(since time.Time) ([]GeoAPICallStats, error) {
	var out []GeoAPICallStats
	err := s.db.Model(&geoAPICallLogRow{}).
		Select("endpoint, caller, path, COUNT(*) as count, AVG(duration_ms) as avg_duration_ms, "+
			"SUM(CASE WHEN errored OR status_code >= 400 THEN 1 ELSE 0 END) as error_count").
		Where("created_at >= ?", since).
		Group("endpoint, caller, path").
		Order("count DESC").
		Scan(&out).Error
	if err != nil {
		return nil, err
	}
	return out, nil
}

// PathRequestStats 是依 method+path 分組的請求統計,供管理後台的請求數量
// 頁面使用(見 server/internal/adminconsole 的 request-stats 端點)。
type PathRequestStats struct {
	Method        string  `json:"method"`
	Path          string  `json:"path"`
	Count         int64   `json:"count"`
	AvgDurationMs float64 `json:"avgDurationMs"`
	ErrorCount    int64   `json:"errorCount"` // status_code >= 400
}

// RequestStatsSince 回傳自 since 以來,依 method+path 分組的請求統計,
// 依呼叫次數由多到少排序——讓管理員一眼看出目前哪個端點被打得最兇
// (例如本次要排查的 Photo Media 重複呼叫問題,根因就是
// /internal/geo/districts/nearby 呼叫次數異常偏高)。
func (s *Store) RequestStatsSince(since time.Time) ([]PathRequestStats, error) {
	var out []PathRequestStats
	err := s.db.Model(&apiRequestLogRow{}).
		Select("method, path, COUNT(*) as count, AVG(duration_ms) as avg_duration_ms, "+
			"SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count").
		Where("created_at >= ?", since).
		Group("method, path").
		Order("count DESC").
		Scan(&out).Error
	if err != nil {
		return nil, err
	}
	return out, nil
}

// RequestStatsTotal 回傳自 since 以來的總請求數與總錯誤數(status_code
// >= 400)——供頁面頂部的總覽卡片使用,不需要呼叫端自己把 RequestStatsSince
// 的各筆結果加總。
func (s *Store) RequestStatsTotal(since time.Time) (total int64, errorCount int64, err error) {
	var row struct {
		Total      int64
		ErrorCount int64
	}
	err = s.db.Model(&apiRequestLogRow{}).
		Select("COUNT(*) as total, SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count").
		Where("created_at >= ?", since).
		Scan(&row).Error
	if err != nil {
		return 0, 0, err
	}
	return row.Total, row.ErrorCount, nil
}
