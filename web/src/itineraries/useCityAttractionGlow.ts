import { useCallback, useEffect, useMemo, useState } from 'react'
import { BASE_URL } from '../AppCommon'
import type { GeoAttraction } from '../api'
import type { AttractionGlowSource } from '../geo-planning/planMapShared'
import { getPlanAiPublicDataSource } from '../home/plan-ai-sim/planAiPublicDataSource'
import { requireAttractionsByCity, requireGeoPlaceDetails, requirePhotoAssets } from '../home/plan-ai-sim/planAiDataSource'

// publicDataSource——讀取已建檔景點區域(attractions)是訪客動作,不需要使用者自己的 JWT:用訪客版資料存取層實例
// (理由同 AiItineraryDetailPage.tsx 的訪客設定)。
const publicDataSource = getPlanAiPublicDataSource(BASE_URL)

// cityNameOf——從 SampleItinerary.region(格式固定是「國家・城市」,見 types.ts 該欄位的完整說明與 itineraries.test.ts
// 的格式驗證)取出城市名,對應 attractions 表的 cityName 欄位(tripace-cli attraction add -city 建檔時用的同一組字典)。
// 用最後一個「・」分段,不是用 split 取固定索引,避免國家名本身含有這個分隔字元時取錯段落。
export function cityNameOf(region: string): string {
  const parts = region.split('・')
  return parts[parts.length - 1] ?? region
}

// useCityAttractionGlow——行程詳情頁的光暈資料來源(AttractionGlowSource 的行程詳情頁實作):依行程所在城市,經資料存取層
// 一次查好已建檔的景點區域,畫成主題點光暈(例如清邁行程的「尼曼文青咖啡巷」)。不是使用者觸發,頁面載入就查,所以沒有控制項。
// 查詢範圍是整個城市、不篩選跟這份行程站點有沒有關聯,與 InteractiveExploreMap 的既有行為一致。
// 查詢失敗(例如這個城市尚未建檔任何景點區域)不影響行程顯示:光暈只是疊加資訊,維持空陣列(不畫)即可。
// 這個頁面沒有「點光暈展開側欄」的互動設計,onSelect 是 no-op。
export function useCityAttractionGlow(region: string): AttractionGlowSource {
  const [attractions, setAttractions] = useState<GeoAttraction[]>([])
  useEffect(() => {
    let cancelled = false
    requireAttractionsByCity(publicDataSource, cityNameOf(region))
      .then((res) => {
        if (!cancelled) setAttractions(res)
      })
      .catch((err) => {
        console.error('[useCityAttractionGlow] requireAttractionsByCity 失敗:', err)
      })
    return () => {
      cancelled = true
    }
  }, [region])

  // 穩定參照包起來的查詢函式,傳給 attractionGlowLayer 的 placeDetails/photoAssets(主題點展開後查詢內部子景點與照片用)。
  const placeDetails = useCallback((placeId: string) => requireGeoPlaceDetails(publicDataSource, placeId), [])
  const photoAssets = useCallback((placeId: string) => requirePhotoAssets(publicDataSource, placeId), [])

  return useMemo(
    () => ({ attractionGlow: { attractions, onSelect: () => {}, placeDetails, photoAssets } }),
    [attractions, placeDetails, photoAssets],
  )
}
