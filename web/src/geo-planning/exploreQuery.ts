import type { GeoAttraction } from '../api'

// exploreMapConstants——PlanMap 與從它抽出來的 hook(useExploreQueries 等)共用的常數與
// 小函式。獨立成檔是為了避免 hook 反過來 import PlanMap.tsx 造成循環引用。

// EXPLORE_CATEGORY:「探索」標籤的類別值(查自建景點區域,不走 Google 文字搜尋)。
// PlanMap.tsx 仍會 re-export,既有的 import 路徑不變。
export const EXPLORE_CATEGORY = 'attraction'

// SEARCH_BOX_CATEGORY_LABELS:會把標籤文字寫進搜尋框、走 Google 文字搜尋的三個類別。
export const SEARCH_BOX_CATEGORY_LABELS: Record<string, string> = {
  tourist_attraction: '景點',
  lodging: '飯店',
  restaurant: '餐廳',
}

// 類別標籤與「搜尋這個區域」查詢的固定半徑(公尺)。
export const CATEGORY_QUERY_RADIUS_METERS = 1500

// sameAttractionsContent:兩份景點清單的內容(名稱與座標)是否相同——相同就沿用舊陣列參照,
// 避免光暈整批銷毀重畫造成閃爍。
export function sameAttractionsContent(a: GeoAttraction[], b: GeoAttraction[]): boolean {
  if (a.length !== b.length) return false
  return a.every((d, i) => d.name === b[i].name && d.lat === b[i].lat && d.lng === b[i].lng)
}

// 查「附近景點區域」的半徑:/ai-plan 與登入後共用的探索查詢
// (useExploreQueries)共用,原本各寫一份相同的公式。

// 上限 50 公里:縮得很小(看得很廣)時避免一次掃全國。
export const ATTRACTION_QUERY_MAX_RADIUS_METERS = 50000

// radiusForZoom——縮放 12 是基準(20 公里),每放大一級半徑減半、每縮小一級加倍,封頂 50 公里。
export function radiusForZoom(zoom: number): number {
  return Math.min(ATTRACTION_QUERY_MAX_RADIUS_METERS, 20000 * Math.pow(2, 12 - zoom))
}

// geoAreaSearchState:管理「搜尋這個區域」按鈕的顯示/查詢中狀態轉換,
// 從 PlanMap.tsx 抽成不依賴 google.maps SDK 的純 reducer——該元件
// 深度依賴 Google Maps JS API(OverlayView、importLibrary 等),整個元件
// 目前沒有任何測試覆蓋(mock 整個 Google Maps API 成本很高);但「使用者
// 拖曳地圖後該不該冒出搜尋按鈕、按下後該不該顯示查詢中、查詢完成/失敗
// 後該怎麼重置」這組動作順序決策,本身不需要碰到地圖 SDK,抽出來後才能
// 用一般的單元測試驗證順序正確,不必等到能操作真實地圖才發現順序寫錯。
//
// 對應 PlanMap.tsx 的欄位:
//   areaDirty  → 是否顯示「搜尋這個區域」按鈕
//   searching  → 按鈕上的放大鏡是否要換成載入圈圈
export interface AreaSearchState {
  areaDirty: boolean
  searching: boolean
}

export const initialAreaSearchState: AreaSearchState = {
  areaDirty: false,
  searching: false,
}

// AreaSearchEvent 對應四個實際觸發時機:
//   map-idle       地圖拖曳/縮放動畫結束(idle 事件),且未被
//                   suppressNextIdleQueryRef 抑制——呼叫端只在「不該抑制」
//                   時才 dispatch 這個事件,「該不該抑制」的判斷不在這個
//                   reducer 裡(那是 panTarget 是否為程式化移動的判斷,
//                   屬於呼叫端的責任,見 PlanMap.tsx 的說明)。
//   search-pressed 使用者按下「搜尋這個區域」按鈕
//   query-succeeded 按下後觸發的查詢成功回來
//   query-failed    按下後觸發的查詢失敗(網路錯誤/伺服器錯誤)
export type AreaSearchEvent =
  | { type: 'map-idle' }
  | { type: 'search-pressed' }
  | { type: 'query-succeeded' }
  | { type: 'query-failed' }

// reduceAreaSearchState:給定目前狀態 + 事件,回傳新狀態。
//
// 各事件的轉換理由:
//   map-idle:不論目前是否正在查詢中,都讓 areaDirty 變 true——地圖被
//     移動了,舊資料已經不對應目前可視範圍,該提示使用者「按下才能看到
//     這個範圍的資料」。若這次 idle 剛好與正在進行的查詢重疊(使用者在
//     查詢跑完前又拖了一下),searching 維持不變,查詢跑完後仍會依
//     query-succeeded/query-failed 的規則處理——不因為又被拖曳了就取消
//     或提前結束查詢中狀態。
//   search-pressed:進入查詢中(searching=true),同時先把 areaDirty 收
//     起來(false)——按鈕按下的當下就該消失,不需要等查詢真的完成才
//     消失,使用者按下去的回饋要即時。若查詢失敗,areaDirty 會在
//     query-failed 分支重新設回 true(見下方),讓按鈕重新出現、使用者
//     可以再按一次重試。
//   query-succeeded:結束查詢中狀態,areaDirty 維持 false(不用再顯示
//     按鈕,已經是這個範圍的最新資料了)。
//   query-failed:結束查詢中狀態,但 areaDirty 重新設回 true——查詢沒有
//     成功,目前顯示的仍是查詢前的舊資料,對應範圍已經不對,重新出現
//     按鈕讓使用者可以再按一次重試,不是靜靜地假裝「已經是最新的」。
export function reduceAreaSearchState(state: AreaSearchState, event: AreaSearchEvent): AreaSearchState {
  switch (event.type) {
    case 'map-idle':
      return { ...state, areaDirty: true }
    case 'search-pressed':
      return { areaDirty: false, searching: true }
    case 'query-succeeded':
      return { areaDirty: false, searching: false }
    case 'query-failed':
      return { areaDirty: true, searching: false }
    default:
      return state
  }
}
