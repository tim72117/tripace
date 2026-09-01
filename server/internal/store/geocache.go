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

// SetCachedPlaceDetails 寫入(或覆蓋既有)一筆 Place Details 快取——只含
// 名稱/地址/座標/評分/簡介,不含照片。照片改由 SetGooglePlacePhotos/
// SetPlacePexelsPhotos 分別寫入 google_place_photos/place_pexels_photos
// 兩張表(見 googlePlacePhotoRow 的完整說明:Google 與 Pexels 的照片要
// 同時並列顯示,不是互斥的單一選擇,故從這張表拆出、各自獨立管理)。
func (s *Store) SetCachedPlaceDetails(placeID, name, address string, lat, lng, rating float64, summary *string) error {
	row := placeDetailsCacheRow{
		PlaceID:   placeID,
		Name:      name,
		Address:   address,
		Lat:       lat,
		Lng:       lng,
		Rating:    rating,
		Summary:   summary,
		FetchedAt: now(),
	}
	return s.db.Save(&row).Error
}

// IncrementPlaceClickCount 對 place_id 的 click_count 做原子性 +1,並
// 回傳遞增後的 click_count、以及目前的 new_photo_count/google_photo_target_count
// (供呼叫端接著餵給 shouldAddGooglePlacePhoto/resetPhotoProgressOnTargetChange
// 兩支純函式判斷這次點擊要不要觸發漸進補圖)。
//
// 用 GORM 的 Model().Update() 產生單一 UPDATE place_details_cache
// SET click_count = click_count + 1 WHERE place_id = ? 語句——遞增
// 運算式(click_count + 1)整個在 SQL 端、同一條 UPDATE 陳述式裡完成,
// 不是先 SELECT 讀出目前值、在 Go 端加一、再 UPDATE 寫回,所以不會有
// 「讀取後、寫回前」這段時間窗口被其他併發請求插隊、導致漏加的
// read-modify-write 競態(多個使用者同時點同一個地點時常見的問題)。
// Postgres/SQLite 兩種 dialector 都支援這個語法,不需要另外分支處理。
//
// 遞增後緊接著用同一個 s.db(非另開 transaction)以 First 讀回整列——
// 這裡沒有用交易包住「UPDATE + 讀回」兩步驟:SQLite/Postgres 的單一
// UPDATE 陳述式本身已經是原子的(click_count 的加法不會漏算),讀回
// 這一步只是要把 UPDATE 之後「當下」的 new_photo_count/
// google_photo_target_count 一併取回給呼叫端,即使讀回前後又有其他
// 併發點擊把這兩欄改動,也只是讓呼叫端拿到「稍舊一點」的補圖進度快照
// ——反映在下一次點擊的判斷裡即可,不影響 click_count 本身的正確性,
// 不需要為此提高一致性等級、犧牲併發吞吐。
//
// place_id 在 place_details_cache 裡還不存在時(這個地點第一次被查詢,
// 還沒走過 SetCachedPlaceDetails 寫入這一列),UPDATE 會影響 0 列、
// 不報錯;這裡比照 GetCachedPlaceDetails 對「查無資料」的處理慣例
// (回傳 ok=false/零值,不當作 error),回傳 clickCount=0, newPhotoCount=0,
// googlePhotoTargetCount=0, err=nil——呼叫端本來就只會在快取未命中時
// 才走一般查詢流程,那時候才會第一次呼叫 SetCachedPlaceDetails 寫入
// 這一列,所以「查不到」在這個函式是預期中的正常情況,不是異常。
func (s *Store) IncrementPlaceClickCount(placeID string) (clickCount int64, newPhotoCount int, googlePhotoTargetCount int, err error) {
	result := s.db.Model(&placeDetailsCacheRow{}).
		Where("place_id = ?", placeID).
		Update("click_count", gorm.Expr("click_count + 1"))
	if result.Error != nil {
		return 0, 0, 0, result.Error
	}
	if result.RowsAffected == 0 {
		// place_id 尚未存在於 place_details_cache——這是第一次查詢這個
		// 地點,還沒有任何一列可以遞增,交由呼叫端走一般查詢流程。
		return 0, 0, 0, nil
	}

	var row placeDetailsCacheRow
	if err := s.db.Where("place_id = ?", placeID).First(&row).Error; err != nil {
		return 0, 0, 0, err
	}
	return row.ClickCount, row.NewPhotoCount, row.GooglePhotoTargetCount, nil
}

// UpdatePlacePhotoProgress 更新這個 place_id 的 new_photo_count/
// google_photo_target_count 兩欄——呼叫端在觸發(或判斷不觸發)漸進
// 補圖之後,把最新進度寫回時使用。
//
// 用 Model(...).Where(...).Updates(map[...]) 做部分欄位更新,不是
// Save(&row) 整列覆寫——Save 會用呼叫端手上這個 struct 的所有欄位
// (含零值)覆蓋整列,若呼叫端沒有先把 click_count/name/address 等
// 其他欄位也填好,會被誤寫成零值/空字串,清空既有資料。這裡只關心
// 這兩欄(加上下面說明的 fetched_at),用欄位白名單(map)明確只更新
// 這幾欄,其餘欄位(click_count、name、address...)完全不受影響。
//
// touchFetchedAt 控制是否同時把 fetched_at 更新成現在(見
// server/internal/api/geo_outline.go 的 handleGeoPlaceDetails 快取命中
// 分支對「點擊節奏 OR 時間」雙觸發條件的完整說明)——只要這次呼叫端
// 實際打過 geo.Client.ListPlacePhotoRefs/GetPlaceDetails 去跟 Google
// 確認過目前的 photos[] 長度(不論最後有沒有真的觸發補圖下載),就該傳
// true,讓「距離上次真正查過 Google 已經超過 7 天」這個時間觸發條件
// 重新從現在起算,避免同一個已經確認過的地點在接下來 7 天內因為時間
// 條件被重複觸發。完全沒有觸發任何查詢(點擊節奏跟時間都未觸發)的
// 路徑不應該呼叫這支函式,或應傳 false——這種情況下 fetched_at 理應
// 維持原值不動。
func (s *Store) UpdatePlacePhotoProgress(placeID string, newPhotoCount, googlePhotoTargetCount int, touchFetchedAt bool) error {
	updates := map[string]interface{}{
		"new_photo_count":           newPhotoCount,
		"google_photo_target_count": googlePhotoTargetCount,
	}
	if touchFetchedAt {
		updates["fetched_at"] = now()
	}
	return s.db.Model(&placeDetailsCacheRow{}).
		Where("place_id = ?", placeID).
		Updates(updates).Error
}

// ListGooglePlacePhotos 回傳該地點目前已落地的 Google Places 照片清單,
// 依 photo_index 由小到大排序——供 handleGeoPlaceDetails 組裝回應與
// GeoInfoPanel 顯示使用。查無資料回傳空 slice(非 nil、非 error)。
func (s *Store) ListGooglePlacePhotos(placeID string) ([]googlePlacePhotoRow, error) {
	rows := make([]googlePlacePhotoRow, 0)
	err := s.db.Where("place_id = ?", placeID).Order("photo_index ASC").Find(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// SetGooglePlacePhotos 覆寫該地點的 Google Places 照片清單——先刪除
// 這個 place_id 底下所有既有列,再寫入這次查到的完整清單,不是逐筆
// upsert。理由:這裡要處理的是「整批取代」(每次查詢都拿到 Google 目前
// 完整的 photos[] 順序),用刪除+整批寫入比逐筆比對新舊 index 差異更
// 直接,且能自然處理「這次查到的張數比上次少」的情況(多餘的舊列會
// 隨刪除一併清掉,不需要像 photoCacheRow 那樣另外呼叫 Trim)。
func (s *Store) SetGooglePlacePhotos(placeID string, photoURLs []string) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("place_id = ?", placeID).Delete(&googlePlacePhotoRow{}).Error; err != nil {
			return err
		}
		if len(photoURLs) == 0 {
			return nil
		}
		rows := make([]googlePlacePhotoRow, len(photoURLs))
		fetchedAt := now()
		for i, url := range photoURLs {
			rows[i] = googlePlacePhotoRow{PlaceID: placeID, PhotoIndex: i, PhotoURL: url, FetchedAt: fetchedAt}
		}
		return tx.Create(&rows).Error
	})
}

// ListPlacePexelsPhotos 回傳該地點目前已快取的 Pexels 照片清單,依
// photo_index 由小到大排序,理由同 ListGooglePlacePhotos。
func (s *Store) ListPlacePexelsPhotos(placeID string) ([]placePexelsPhotoRow, error) {
	rows := make([]placePexelsPhotoRow, 0)
	err := s.db.Where("place_id = ?", placeID).Order("photo_index ASC").Find(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// SetPlacePexelsPhotos 覆寫該地點的 Pexels 照片清單,理由同
// SetGooglePlacePhotos。photoURLs/pageURLs 兩個 slice 長度必須一致,
// 依相同索引一一對應同一張照片的下載網址與可追溯來源網址。
func (s *Store) SetPlacePexelsPhotos(placeID string, photoURLs, pageURLs []string) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("place_id = ?", placeID).Delete(&placePexelsPhotoRow{}).Error; err != nil {
			return err
		}
		if len(photoURLs) == 0 {
			return nil
		}
		rows := make([]placePexelsPhotoRow, len(photoURLs))
		fetchedAt := now()
		for i, url := range photoURLs {
			rows[i] = placePexelsPhotoRow{PlaceID: placeID, PhotoIndex: i, PhotoURL: url, PageURL: pageURLs[i], FetchedAt: fetchedAt}
		}
		return tx.Create(&rows).Error
	})
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
