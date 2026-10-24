import type { DrawGroup } from './types'

// zOrder——所有繪製項目的疊放順序,集中在這一張表(數字越大越上面)。
//
// 目前只有 currentLocation 的數值是對照現有程式(currentLocationLayer 的 zIndex: 1,背景資訊,
// 不該蓋過使用者主動查詢或選中的東西)。marker 類群組(searchResult、tripEntry、planStop)的數值是
// 暫定的相對順序,遷移各功能時再對照現有 hook(強調態拉高、選中的搜尋結果等)校準。
//
// 線類群組只和同為線的項目比較(Google Maps 的 marker 與圖形在不同圖層,marker 一定在圖形上方):
// 轉乘 hover 虛線要蓋過連線,對照現有 996(整條路線)、997(轉乘虛線)的上下關係。
// (2026-10-24 起三個入口的連線都是 routeLineLayer,原本行程詳情頁專用的 routePolyline 群組已移除。)
export const GROUP_Z: Record<DrawGroup, number> = {
  currentLocation: 1,
  searchResult: 10,
  tripEntry: 20,
  // 搜尋結果的定位結果與選中態、行程 entry 的選中態:對照舊 hook 的 zIndex 998、999。
  searchResultGeocode: 998,
  searchResultSelected: 999,
  tripEntrySelected: 999,
  // 行程站點:一般站點在中間;主題展開的子景點小點在它下面;選中蓋過一般站點,hover 再蓋過選中
  // (對照舊圖層的 998、999;舊圖層一般站點與子景點不設 zIndex)。
  planStopChild: 25,
  planStop: 30,
  planStopSelected: 998,
  planStopHover: 999,
  // 連線的光暈底層(routeStyle.ts):所有顏色線的下面,這樣兩段交叉時光暈不會蓋到另一段的顏色線。
  routeCasing: 38,
  routeLine: 40,
  transitHoverLine: 50,
  attractionGlow: 5, // OverlayView 的疊放由 pane 決定,這個值 overlay 不讀,只為了表完整
}
