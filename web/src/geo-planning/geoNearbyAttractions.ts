import type { GeoAttraction } from '../api'
import { haversineMeters, walkMinutesEstimate } from './geoDistance'
import { curatedCategoryOf, type CuratedCategory } from './geoCuratedCategoryStub'

// geoNearbyAttractions:「附近景點」清單的純邏輯部分(距離排序、分類篩選
// 規則)——DesktopLayout.tsx(算 nearby 清單本身)與 AttractionInfoPanel.tsx
// (算 nearbyCategoryPresent/filteredNearby)原本各自把這幾段算式寫死在
// 各自的 useMemo 裡,完全沒有共用,GeoOutlinePhoneView.tsx/
// GeoOutlinePhoneInfoSheet.tsx 要新增附近景點清單時只能重新抄一份或
// import 桌面版檔案(職責邊界混亂)。這裡抽出來的三支都是零 React/DOM
// 依賴的純函式,不涉及互動邏輯/UI 呈現(那些桌面/手機本來就不同,刻意
// 不抽,見各自呼叫端的說明)。

export interface NearbyAttraction {
  attraction: GeoAttraction
  minutes: number
}

// computeNearbyAttractions:算出離 anchor 最近的 limit 個候選,依步行
// 分鐘數由近到遠排序——對齊 DesktopLayout.tsx 原本 nearbyAttractions
// useMemo 的邏輯(排除錨點自身,理由同該處說明:錨點本身不該出現在自己
// 的附近清單裡)。pool 由呼叫端決定來源(桌面版是地圖可視範圍查詢結果,
// 手機版比照桌面版傳 ExploreMap 的 onAttractionsChange 拿到的同一批
// 資料,展示頁是固定城市查詢的全部非主題點,見各自呼叫端的說明),這支
// 函式不關心資料怎麼來的。
export function computeNearbyAttractions(
  anchor: GeoAttraction,
  pool: GeoAttraction[],
  limit: number,
): NearbyAttraction[] {
  return pool
    .filter((a) => !(
      a.name === anchor.name
      && a.lat === anchor.lat
      && a.lng === anchor.lng
    ))
    .map((a) => ({ attraction: a, minutes: walkMinutesEstimate(haversineMeters(anchor, a)) }))
    .sort((a, b) => a.minutes - b.minutes)
    .slice(0, limit)
}

// nearbyCategoriesPresent:這批清單裡實際出現過的分類集合——篩選 UI
// (桌面版下拉選單/手機版 chip 列)只列出這些分類,不列出用不到的分類,
// 對齊 AttractionInfoPanel.tsx 原本 nearbyCategoryPresent 的邏輯。
export function nearbyCategoriesPresent(list: NearbyAttraction[]): Set<CuratedCategory> {
  const set = new Set<CuratedCategory>()
  for (const { attraction } of list) {
    const category = curatedCategoryOf(attraction.category)
    if (category) set.add(category)
  }
  return set
}

// filterNearbyByCategory:套用分類篩選——filter 為 null 時不篩選,回傳
// 完整清單;有值時只留下符合分類的項目,沒有分類資料的項目(curatedCategoryOf
// 回傳 null)一律不顯示,理由同 AttractionInfoPanel.tsx 原本 filteredNearby
// 的說明:「篩選」的語意是「只看這個分類」,無法歸類的項目不屬於使用者
// 選中的任何分類。
export function filterNearbyByCategory(
  list: NearbyAttraction[],
  filter: CuratedCategory | null,
): NearbyAttraction[] {
  if (!filter) return list
  return list.filter(({ attraction }) => curatedCategoryOf(attraction.category) === filter)
}
