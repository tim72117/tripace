// geoAreaSearchState:管理「搜尋這個區域」按鈕的顯示/查詢中狀態轉換,
// 從 GeoOutlineMap.tsx 抽成不依賴 google.maps SDK 的純 reducer——該元件
// 深度依賴 Google Maps JS API(OverlayView、importLibrary 等),整個元件
// 目前沒有任何測試覆蓋(mock 整個 Google Maps API 成本很高);但「使用者
// 拖曳地圖後該不該冒出搜尋按鈕、按下後該不該顯示查詢中、查詢完成/失敗
// 後該怎麼重置」這組動作順序決策,本身不需要碰到地圖 SDK,抽出來後才能
// 用一般的單元測試驗證順序正確,不必等到能操作真實地圖才發現順序寫錯。
//
// 對應 GeoOutlineMap.tsx 的欄位:
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
//                   屬於呼叫端的責任,見 GeoOutlineMap.tsx 的說明)。
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
