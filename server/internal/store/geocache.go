package store

import (
	"errors"
	"sort"
	"time"

	"gorm.io/gorm"
)

// GetCachedPhoto 查詢已快取的單張圖片(見 photoCacheRow 的完整說明)。
// maxAge 是這筆快取視為新鮮的上限,超過視為未命中——呼叫端應重新查詢
// (理由同 GetCachedPlaceDetails 的 maxAge 參數)。ok 為 false 代表
// 未命中或已過期,呼叫端應照原本流程向 Google Photo Media API 查詢。
func (s *Store) GetCachedPhoto(placeID string, photoIndex, maxWidthPx int, maxAge time.Duration) (dataURI string, ok bool, err error) {
	var row photoCacheRow
	err = s.db.Where("place_id = ? AND photo_index = ? AND max_width_px = ?", placeID, photoIndex, maxWidthPx).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	if now().Sub(row.FetchedAt) > maxAge {
		return "", false, nil
	}
	return row.DataURI, true, nil
}

// SetCachedPhoto 寫入(或覆蓋既有)一筆圖片快取。用 place_id+photo_index+
// 寬度組合 upsert,避免同一張圖片重複寫入時因為唯一鍵衝突而失敗。
func (s *Store) SetCachedPhoto(placeID string, photoIndex, maxWidthPx int, dataURI string) error {
	row := photoCacheRow{
		PlaceID:    placeID,
		PhotoIndex: photoIndex,
		MaxWidthPx: maxWidthPx,
		DataURI:    dataURI,
		FetchedAt:  now(),
	}
	return s.db.Save(&row).Error
}

// ListCachedPhotos 回傳該地點目前快取的完整照片清單,依 photo_index 由
// 小到大排序——供差異比對同步邏輯使用(新增/移除/過期檢查各自的判斷,
// 見呼叫端的說明),每筆各自帶 FetchedAt,這裡不做任何過期篩選,由
// 呼叫端逐筆判斷。查無資料回傳空 slice(非 nil、非 error)。
func (s *Store) ListCachedPhotos(placeID string, maxWidthPx int) ([]photoCacheRow, error) {
	rows := make([]photoCacheRow, 0)
	err := s.db.Where("place_id = ? AND max_width_px = ?", placeID, maxWidthPx).
		Order("photo_index ASC").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// TrimCachedPhotos 刪除該地點快取裡「序號超出目前 Google 清單長度」的
// 多餘列——供差異比對同步邏輯使用:這次查到的照片數量比快取裡的少,
// 代表 Google 目前的清單變短了,超出範圍的舊快取列不再對應任何實際
// 存在的照片,需要清掉,不留殘影(見呼叫端的差異比對邏輯)。keepBelow
// 是這次查到的照片總數,photo_index >= keepBelow 的列會被刪除。
func (s *Store) TrimCachedPhotos(placeID string, maxWidthPx, keepBelow int) error {
	return s.db.Where("place_id = ? AND max_width_px = ? AND photo_index >= ?", placeID, maxWidthPx, keepBelow).
		Delete(&photoCacheRow{}).Error
}

// GetCachedPexelsPhoto 查詢已快取的 Pexels 搜尋結果(見 pexelsPhotoCacheRow
// 的完整說明)。maxAge 是這筆快取視為新鮮的上限,超過視為未命中,呼叫端
// 應重新查詢 Pexels——理由同 GetCachedPhoto/GetCachedPlaceDetails 的
// maxAge 參數。
func (s *Store) GetCachedPexelsPhoto(searchQuery string, maxAge time.Duration) (row pexelsPhotoCacheRow, ok bool, err error) {
	err = s.db.Where("search_query = ?", searchQuery).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return pexelsPhotoCacheRow{}, false, nil
	}
	if err != nil {
		return pexelsPhotoCacheRow{}, false, err
	}
	if now().Sub(row.FetchedAt) > maxAge {
		return pexelsPhotoCacheRow{}, false, nil
	}
	return row, true, nil
}

// SetCachedPexelsPhoto 寫入(或覆蓋既有)一筆 Pexels 搜尋結果快取。
func (s *Store) SetCachedPexelsPhoto(searchQuery, imageURL, pageURL string) error {
	row := pexelsPhotoCacheRow{
		SearchQuery: searchQuery,
		ImageURL:    imageURL,
		PageURL:     pageURL,
		FetchedAt:   now(),
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
// /internal/geo/attractions/nearby 呼叫次數異常偏高)。
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

// TimelineBucket 是時間序列圖表用的單一資料點,粒度由呼叫端決定(見
// requestTimelineSince 的 granularity 參數——inbound 的
// RequestStatsTimeline 用小時、outbound 的 GeoAPICallStatsTimeline 用
// 分鐘,兩者不共用同一種粒度)。BucketStart 是該桶的起始時間(UTC,依
// granularity 整點/整分對齊)。
type TimelineBucket struct {
	BucketStart time.Time `json:"bucketStart"`
	Count       int64     `json:"count"`
	ErrorCount  int64     `json:"errorCount"`
}

// requestTimelineSince 是 RequestStatsTimeline/GeoAPICallStatsTimeline
// 共用的分桶邏輯——只抓 created_at/status_code(errored) 兩欄,在應用層
// (Go)依 granularity(time.Hour 或 time.Minute)分桶聚合,而非在 SQL 裡
// 用資料庫函式(如 Postgres 的 date_trunc)分桶:store 同時支援 Postgres
// 與 SQLite(見 store.go 的 dialector),兩者的日期截斷語法不相容,應用層
// 分桶是唯一在兩種資料庫上都正確的做法。SQL 查詢本身不做聚合(直接撈
// since 範圍內每一筆原始 row 的 created_at/errored),掃描成本與分桶
// 粒度無關,只有 Go 這層的 map 大小、以及回應 JSON 大小/前端要畫的點數
// 會隨粒度變細而增加——查詢範圍上限沿用 adminconsole 既有的 168 小時/
// 7 天(listRequestStats/listGeoAPIStats 的 maxHours),沒有另外收窄。
//
// 回傳的桶依時間由舊到新排序,涵蓋 since 到現在之間「有資料的」桶(沒有
// 請求的桶不會出現在結果裡,由呼叫端/前端決定要不要補零值)。
func requestTimelineSince(rows []struct {
	CreatedAt time.Time
	Errored   bool
}, granularity time.Duration) []TimelineBucket {
	buckets := make(map[time.Time]*TimelineBucket)
	order := make([]time.Time, 0)
	for _, r := range rows {
		bucketStart := r.CreatedAt.UTC().Truncate(granularity)
		b, ok := buckets[bucketStart]
		if !ok {
			b = &TimelineBucket{BucketStart: bucketStart}
			buckets[bucketStart] = b
			order = append(order, bucketStart)
		}
		b.Count++
		if r.Errored {
			b.ErrorCount++
		}
	}
	sort.Slice(order, func(i, j int) bool { return order[i].Before(order[j]) })
	out := make([]TimelineBucket, 0, len(order))
	for _, t := range order {
		out = append(out, *buckets[t])
	}
	return out
}

// RequestStatsTimeline 回傳自 since 以來,按小時分桶的請求量時間序列
// (供管理後台請求數量頁面的趨勢圖使用,見 requestTimelineSince 的分桶
// 說明)——inbound 維持小時粒度不變。
func (s *Store) RequestStatsTimeline(since time.Time) ([]TimelineBucket, error) {
	var rows []struct {
		CreatedAt time.Time
		Errored   bool
	}
	err := s.db.Model(&apiRequestLogRow{}).
		Select("created_at, status_code >= 400 as errored").
		Where("created_at >= ?", since).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	return requestTimelineSince(rows, time.Hour), nil
}

// GeoAPICallStatsTimeline 是 RequestStatsTimeline 的 outbound 對應版本
// (見該函式與 requestTimelineSince 的說明)——errored 這裡是「連線層
// 失敗或狀態碼 >= 400」的合併判斷,對齊 GeoAPICallStatsSince 的
// error_count 定義,不是只看狀態碼。改用分鐘粒度(inbound 維持小時不變)
// ——Google API 呼叫量通常遠低於一般請求量,分鐘粒度能看出較細的波動,
// 不會像小時粒度那樣把短暫的呼叫尖峰拉平。
func (s *Store) GeoAPICallStatsTimeline(since time.Time) ([]TimelineBucket, error) {
	var rows []struct {
		CreatedAt time.Time
		Errored   bool
	}
	err := s.db.Model(&geoAPICallLogRow{}).
		Select("created_at, (errored OR status_code >= 400) as errored").
		Where("created_at >= ?", since).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	return requestTimelineSince(rows, time.Minute), nil
}
