package api

import (
	"time"

	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/store"
)

// place_details_cache.go——把 store 的 place_details_cache 表接成 geo 層的
// 統一地點詳情快取(geo.PlaceDetailsCache,見 internal/geo/details_cache.go)。
// 跟 storePhotoCache 是同一個模式。
//
// cmd/server 啟動時 geo.SetDefaultDetailsCache(NewPlaceDetailsCache(st)),之後
// 所有 geo.New() 建出來的 client 自動帶上,任何呼叫端都不可能跳過快取。

type storePlaceDetailsCache struct {
	store *store.Store
}

// NewPlaceDetailsCache 建立以 place_details_cache 表為後端的統一快取。
func NewPlaceDetailsCache(st *store.Store) geo.PlaceDetailsCache {
	return storePlaceDetailsCache{store: st}
}

// placeDetailsCacheReadAnyAge:讀取時不在 store 層判斷新鮮度(傳一個極大的
// maxAge),改由 geo 層用目前的 DetailsCacheMaxAge 判斷——有效期是可調設定,
// 兩邊各判斷一次會互相打架。
const placeDetailsCacheReadAnyAge = 100 * 365 * 24 * time.Hour

func (c storePlaceDetailsCache) Get(placeID string) (geo.PlaceDetails, time.Time, bool) {
	row, ok, err := c.store.GetCachedPlaceDetails(placeID, placeDetailsCacheReadAnyAge)
	if err != nil || !ok {
		return geo.PlaceDetails{}, time.Time{}, false
	}
	d := geo.PlaceDetails{
		Name:    row.Name,
		Address: row.Address,
		Lat:     row.Lat,
		Lng:     row.Lng,
		Rating:  row.Rating,
	}
	if row.Summary != nil {
		d.Summary = *row.Summary
	}
	return d, row.FetchedAt, true
}

// Set 寫入文字欄位。SetCachedPlaceDetails 的 upsert 只更新文字欄位與
// fetched_at,不碰 click_count 與 photo_count(補圖節奏的獨立狀態),所以不會
// 因為重寫快取而洗掉點擊數或記下的實際照片張數。
func (c storePlaceDetailsCache) Set(placeID string, d geo.PlaceDetails) {
	var summary *string
	if d.Summary != "" {
		s := d.Summary
		summary = &s
	}
	_ = c.store.SetCachedPlaceDetails(placeID, d.Name, d.Address, d.Lat, d.Lng, d.Rating, summary)
}
