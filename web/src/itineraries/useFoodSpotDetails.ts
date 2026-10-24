import { useEffect, useState } from 'react'
import { BASE_URL } from '../AppCommon'
import type { ClientConfig, GeoPlaceDetails } from '../api'
import { fetchPlaceDetailsCached } from '../planning/data/cache'
import type { SampleFoodSpot } from './types'

// GUEST_CFG——讀取已建檔地點的公開資料是訪客動作,不需要使用者自己的
// JWT,token 傳 null,理由同 AiItineraryDetailPage.tsx 的 GUEST_CFG。
const GUEST_CFG: ClientConfig = { baseURL: BASE_URL, token: null }

export interface FoodSpotDetails {
  photoUrl: string | null
  lat: number | null
  lng: number | null
}

// useFoodSpotDetails——2026-10 新增,使用者明確要求「地點要在地圖繪製
// 圖點,要跟圖卡點選關聯」:美食清單(SampleFoodSpot)本身只有
// photoPlaceId,沒有 lat/lng(見 types.ts 的完整說明,這批候選店家的
// 座標還沒有收進資料結構裡)——要讓它們也能像時間軸站點一樣畫在地圖上,
// 需要座標,這支 hook 查詢 photoPlaceId 對應的完整地點詳情(含 lat/lng
// 與照片),一次解決「要圖片」跟「要座標」兩個需求,不必分別打兩次
// 不同的查詢。
//
// 走 planning/data/cache.ts 的 fetchPlaceDetailsCached(對齊
// 使用者「用現有的有快取端點」的要求),跟地圖上其他景點查詢共用同一份
// 模組級快取/in-flight 去重機制,詳見該檔案開頭的完整說明。
//
// 回傳一份 Record<spotId, FoodSpotDetails>,呼叫端(AiItineraryDetailPageMapView.tsx)
// 把這份結果同時餵給 FoodSpotPanel(縮圖)跟地圖 marker 圖層(座標)
// ——兩邊讀同一次查詢結果,不是各自獨立查一次。
export function useFoodSpotDetails(spots: SampleFoodSpot[]): Record<string, FoodSpotDetails> {
  const [details, setDetails] = useState<Record<string, FoodSpotDetails>>({})

  // spotsKey——spots 陣列每次 render 可能是新的陣列參照(呼叫端用
  // useMemo/陣列常數皆有可能,不保證穩定),但這個 effect 真正關心的是
  // 「有哪些 (id, photoPlaceId) 組合」,用字串化的穩定 key 當依賴,避免
  // spots 參照變動但內容相同時重新查詢一輪已經查過的資料。
  const spotsKey = spots.map((s) => `${s.id}:${s.photoPlaceId ?? ''}`).join('|')

  useEffect(() => {
    let cancelled = false
    for (const spot of spots) {
      if (!spot.photoPlaceId) continue
      fetchPlaceDetailsCached(GUEST_CFG, spot.photoPlaceId, true)
        .then((res: GeoPlaceDetails) => {
          if (cancelled) return
          setDetails((prev) => ({
            ...prev,
            [spot.id]: { photoUrl: res.googlePhotoUrls?.[0] ?? null, lat: res.lat, lng: res.lng },
          }))
        })
        .catch((err) => {
          if (cancelled) return
          console.error('[useFoodSpotDetails] fetchPlaceDetailsCached 失敗:', err)
        })
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotsKey])

  return details
}
