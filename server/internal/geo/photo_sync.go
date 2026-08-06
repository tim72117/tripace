package geo

import (
	"context"
	"time"
)

// planPhotoSync 是純函式(不做任何 I/O、不連資料庫、不打 Google),依
// 「快取裡目前有哪些 index、各自何時抓的」與「Google 現在回傳幾張照片」
// 算出差異比對的執行計畫——這是使用者要求的「不要整批覆蓋,做差異處理:
// 多的就移除,少的補上,重疊的比對過期時間,時間到才請求更新」的核心
// 決策邏輯,拆成純函式方便單元測試,不需要真的連資料庫或呼叫 Google。
//
//   - toFetch:需要(重新)下載的 index 清單,依 index 由小到大排序——
//     涵蓋兩種情況:index 在 cachedAt 裡完全不存在(少的、要補上),或
//     存在但已經過期(重疊的、時間到了要更新)。重疊且未過期的 index
//     不會出現在這裡,維持原樣不動,不浪費任何 Google API 呼叫。
//   - trimFrom:超出 newCount 範圍、該被刪除的起始 index。cachedAt 裡
//     沒有任何 index 落在這個範圍時回傳 -1,代表這次不需要刪除任何列
//     (呼叫端據此判斷要不要真的執行刪除,避免每次同步都空跑一次
//     DELETE 陳述式)。
func planPhotoSync(cachedAt map[int]time.Time, newCount int, maxAge time.Duration, now time.Time) (toFetch []int, trimFrom int) {
	trimFrom = -1

	for i := 0; i < newCount; i++ {
		fetchedAt, ok := cachedAt[i]
		if !ok || now.Sub(fetchedAt) > maxAge {
			toFetch = append(toFetch, i)
		}
	}

	for idx := range cachedAt {
		if idx >= newCount {
			trimFrom = newCount
			break
		}
	}

	return toFetch, trimFrom
}

// SyncPlacePhotos 讓 placeID 的照片快取跟 Google 目前的 photos[] 清單
// 對齊,用差異比對而非整批覆蓋(見 planPhotoSync 的決策邏輯):
//
//   - 缺少的 index(Google 有、快取沒有)→ 下載補上
//   - 過期的重疊 index(兩邊都有,但快取超過 maxAge)→ 重新下載覆蓋
//   - 新鮮的重疊 index → 略過,不打任何 Google API
//   - 多餘的 index(快取有、Google 現在的清單已經沒有這麼多張)→ 刪除
//
// 這是「使用者明確想看某地點完整照片清單」時才觸發的低頻動作,不像
// handleGeoAttractionsNearby 那種地圖高頻移動觸發的查詢——故這裡一律
// 直接即時向 Google 查詢目前的清單長度(ListPlacePhotoRefs),不會只憑
// 快取內容本身判斷要不要刷新整份清單長度;只有「個別照片要不要重新
// 下載」才受 maxAge 節流。
//
// c.cache 為 nil 時整個同步操作視為 no-op(直接回傳 nil)——沒有快取層
// 可以比對,同步這個動作本身沒有意義。
func (c *Client) SyncPlacePhotos(ctx context.Context, placeID string, maxWidthPx int, maxAge time.Duration) error {
	if c.cache == nil || placeID == "" {
		return nil
	}

	photoRefs, err := c.ListPlacePhotoRefs(ctx, placeID)
	if err != nil {
		return err
	}

	cachedAt, err := c.cache.List(placeID, maxWidthPx)
	if err != nil {
		return err
	}

	toFetch, trimFrom := planPhotoSync(cachedAt, len(photoRefs), maxAge, time.Now())

	for _, idx := range toFetch {
		dataURI, err := c.downloadPhotoBytes(ctx, photoRefs[idx], maxWidthPx)
		if err != nil {
			// 單張下載失敗不影響其他張——理由同 fetchNearbyHotels 等既有
			// 端點的處理方式,不讓一張圖的暫時性失敗拖垮整個地點的同步。
			continue
		}
		c.cache.Set(placeID, idx, maxWidthPx, dataURI)
	}

	if trimFrom >= 0 {
		return c.cache.Trim(placeID, maxWidthPx, trimFrom)
	}
	return nil
}
