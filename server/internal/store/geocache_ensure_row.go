package store

import (
	"time"

	"gorm.io/gorm/clause"
)

// EnsureCachedPlaceDetailsRow 確保 place_details_cache 有這個 place_id 的一列,
// 但**不覆蓋既有資料**(2026-10)。
//
// 為什麼需要:AI 版 place-details-any 命中已建檔景點時要累加點擊數、判斷補圖,
// 這些都靠 place_details_cache 的那一列存在(IncrementPlaceClickCount 對不存在
// 的列是 no-op)。原本用 SetCachedPlaceDetails(upsert)建列,結果每次請求都把
// Google 存的地址/評分覆蓋成「城市名/0」,並把 fetched_at 重設成現在,讓地圖版
// 的 24 小時重查永遠不會發生。
//
// 列不存在時用建檔資料湊一列,fetched_at 設成 epoch(視為過期):這一列只負責
// 「列存在」,它的文字內容(address 是城市名、沒有評分)不能被當成 Google 的
// 新鮮資料——統一快取(geo.PlaceDetailsCache)看到過期的列會去打 Google 拿真
// 資料。列已存在時什麼都不改(DoNothing)。
func (s *Store) EnsureCachedPlaceDetailsRow(placeID, name, address string, lat, lng float64, summary *string) error {
	row := placeDetailsCacheRow{
		PlaceID:   placeID,
		Name:      name,
		Address:   address,
		Lat:       lat,
		Lng:       lng,
		Summary:   summary,
		FetchedAt: time.Unix(0, 0).UTC(),
	}
	return s.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
}
