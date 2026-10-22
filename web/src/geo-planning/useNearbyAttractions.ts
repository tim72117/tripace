import { useMemo, useState } from 'react'
import type { GeoAttraction } from '../api'
import { computeNearbyAttractions } from './geoNearbyAttractions'
import { curatedCategoryOf, type CuratedCategory } from './geoCuratedCategoryStub'

// useNearbyAttractions / useRevealedAttractionNames——「附近景點」清單與地圖揭露集合的共用計算(2026-10 從桌面
// desktop/Content.tsx 與手機 geo-planning/PlanPhoneView.tsx 各一份相同的 state 與 useMemo 抽出)。純計算在
// geoNearbyAttractions.ts,這裡只是把「地圖查到的清單 state + 兩個衍生值」收成 hook。
//
// NEARBY_ATTRACTION_LIMIT:「附近景點」清單最多顯示幾筆——2026-09 使用者明確要求清單不設數量上限,改成完整列出這個
// 主題底下所有精選點,跟地圖上 revealedAttractionNames 揭露的集合一致(原本兩者刻意允許不一致:清單只取前 N 筆、
// 地圖全部顯示,但使用者體感上會覺得「地圖上明明看得到,清單卻沒列出來」,故不再各自有不同的裁切規則)。傳 Infinity
// 給 computeNearbyAttractions 的 limit 參數(見該函式與 geoNearbyAttractions.test.ts 已有的「不限制筆數」測試案例),
// 等同不做 slice 裁切,只保留距離排序。
const NEARBY_ATTRACTION_LIMIT = Infinity

// useNearbyAttractions
//   geoAttractions:PlanMap 目前查到的景點區域完整清單(即時反映地圖移動/縮放後重新查詢的結果,見 PlanMap.tsx
//     onAttractionsChange 的說明)——供算「附近景點」用,不是給地圖繪製本身用(地圖自己另外依 zoom 做知名度分級篩選,
//     見 geoAttractionOverlay.ts 的 filteredAttractions,兩者是分開的兩份資料,這裡拿到的是篩選之前的原始清單)。
//     呼叫端把 setGeoAttractions 接到 PlanMap 的 onAttractionsChange。
//   nearbyAttractions:離目前錨點(attractionContent)最近的精選點,依距離由近到遠排序——資料來源限定在 geoAttractions
//     (地圖已經查到、不另發 API,見 docs/handoff-radar-map-prototype-2026-08.md「附近候選來源」的決策)。
//     主題點/精選點的區分:isTheme === true 視為「主題點」(地圖預設就會顯示),其餘一律視為「精選點」,預設不在地圖上顯示,
//     只有使用者點開某個主題點(錨點本身 isTheme === true)後,才依附近距離揭露該主題底下的精選點——純粹的距離篩選
//     (方向 C,見 docs/research-curated-attraction-relationships-2026-08.md),不是資料庫裡的固定父子關聯。若目前錨點本身
//     不是主題點(例如直接點了一個已被揭露的精選點卡片),不計算附近清單——精選點不該再遞迴揭露下一層。
export function useNearbyAttractions(attractionContent: GeoAttraction | null) {
  const [geoAttractions, setGeoAttractions] = useState<GeoAttraction[]>([])
  const nearbyAttractions = useMemo(() => {
    if (!attractionContent || !attractionContent.isTheme) return []
    return computeNearbyAttractions(
      attractionContent,
      geoAttractions.filter((a) => !a.isTheme),
      NEARBY_ATTRACTION_LIMIT,
    )
  }, [geoAttractions, attractionContent])
  return { geoAttractions, setGeoAttractions, nearbyAttractions }
}

// useRevealedAttractionNames:目前應該在地圖上顯示的精選點名稱集合——nearbyAttractions 是「附近景點」清單這個 UI 的
// 資料(已排序),地圖上的揭露規則直接用同一批候選(見 attractionGlowLayer.ts 對這個 prop 的說明):兩者資料來源相同、
// 呈現內容一致,只是排序方式各自獨立(清單依距離排序,地圖揭露不排序)。null 代表目前沒有開著主題卡、不做揭露過濾;
// categoryFilter 是清單上方分類下拉選單目前選中的分類(null 不篩選)。
// 獨立成第二個 hook:桌面版的 categoryFilter 來自 useThemeAttractionSelection(宣告順序在 useNearbyAttractions 之後)。
export function useRevealedAttractionNames(
  attractionContent: GeoAttraction | null,
  geoAttractions: GeoAttraction[],
  categoryFilter: CuratedCategory | null,
): Set<string> | null {
  return useMemo(() => {
    if (!attractionContent || !attractionContent.isTheme) return null
    const nearbyPool = geoAttractions.filter((a) => !a.isTheme)
    if (!categoryFilter) return new Set(nearbyPool.map((a) => a.name))
    return new Set(
      nearbyPool.filter((a) => curatedCategoryOf(a.category) === categoryFilter).map((a) => a.name),
    )
  }, [geoAttractions, attractionContent, categoryFilter])
}
