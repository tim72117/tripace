import type { GeoPlaceDetails } from '../api'
import { fetchPlaceDetailsWithPhotoRetry } from '../photoRetry'
import { fetchPlaceDetailsCachedVia, getCachedPlaceDetails, updateCachedPlaceDetails } from './placeDetailsCache'

// scheduleOverlayPhotos——「幫地圖上的一批地標圖示補照片」的共用排程(2026-10 從 useAttractionOverlays 與
// attractionGlowSupport 各一份幾乎相同的程式抽出):
//   - 已經在共用快取(placeDetailsCache)的:立刻套用。
//   - 沒快取的:依序排隊、每個間隔 QUERY_STAGGER_MS 才發出查詢(一次最多 N 個景點,瞬間全打出去會被
//     Places 限流);查到後套用,並走 fetchPlaceDetailsWithPhotoRetry 的「沒圖就原地重試補圖」機制,
//     重試查到的新結果一併寫回共用快取(updateCachedPlaceDetails),讓地圖縮圖與詳情卡看到同一份最新資料。
//   - 查不到照片就維持沒有照片的樣子(失敗不快取,下次重新執行時會再試),不影響地標本身。
// 回傳取消函式:呼叫後尚未發出的查詢不再發出、已發出的結果不再套用(effect 的 cleanup 用)。
// 呼叫端只負責把「有 placeId 的目標」整理成 PhotoTarget(各自怎麼找到對應的圖示實例不同)。

// QUERY_STAGGER_MS:同一批地標逐一發出地點照片查詢的間隔——比後端 per-user 節流間隔(server/internal/api/api.go 的
// geoQueryUserThrottleInterval,目前 200ms)略寬,避免剛好卡在節流視窗邊界被同一批裡前一個請求擠掉而被 429 擋下。
const QUERY_STAGGER_MS = 250

export interface PhotoTarget {
  placeId: string
  setPhotoUrls: (photoUrls: string[] | undefined) => void
}

export function scheduleOverlayPhotos(
  targets: PhotoTarget[],
  fetchDetails: (placeId: string) => Promise<GeoPlaceDetails>,
  fetchPhotoAssets?: (placeId: string) => Promise<{ googlePhotoUrls?: string[] }>,
): () => void {
  let cancelled = false
  const timers: ReturnType<typeof setTimeout>[] = []
  let queuedCount = 0
  for (const { placeId, setPhotoUrls } of targets) {
    const cached = getCachedPlaceDetails(placeId)
    if (cached) {
      setPhotoUrls(cached.googlePhotoUrls)
      continue
    }
    const delay = queuedCount * QUERY_STAGGER_MS
    queuedCount += 1
    timers.push(
      setTimeout(() => {
        if (cancelled) return
        fetchPlaceDetailsWithPhotoRetry(
          placeId,
          (pid) => fetchPlaceDetailsCachedVia(fetchDetails, pid),
          (details) => {
            if (cancelled) return
            setPhotoUrls(details.googlePhotoUrls)
            updateCachedPlaceDetails(placeId, details)
          },
          fetchPhotoAssets,
        ).catch(() => {
          // 查不到照片就維持沒有照片的樣子,不影響地標本身。
        })
      }, delay),
    )
  }
  return () => {
    cancelled = true
    timers.forEach(clearTimeout)
  }
}
