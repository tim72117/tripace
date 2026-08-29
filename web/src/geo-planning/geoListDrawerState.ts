// geoListDrawerState:管理手機版地點清單抽屜(GeoOutlinePhoneListDrawer)
// 開關/載入中狀態轉換的純 reducer——比照 geoAreaSearchState.ts 的既有
// 模式,把「多個查詢入口該不該打開清單、該不該顯示載入中」這組決策從
// GeoOutlinePhoneView.tsx 抽出來,不依賴任何 UI/地圖 SDK,可以直接單元
// 測試,不必等到能操作真實畫面才發現時機寫錯。
//
// 背景(這是第二次因為同一類原因出 bug 才抽出這個 reducer):
//   1. 第一次:「打開清單」的邏輯原本只寫在城市搜尋框專屬的 onSearch
//      inline callback 裡,子代理重構搜尋路徑時繞開了 onSearch(改讓
//      類別標籤/搜尋這個區域直接呼叫底層查詢函式,理由見
//      GeoOutlineMap.tsx 的說明),完全沒意識到 onSearch 背負了這個隱藏
//      副作用,導致那兩個入口查到結果後清單不會自動打開。
//   2. 第二次:改成掛在 onSearchResultsChange(查詢結果真正回來的那一刻)
//      後,又踩到 React useEffect 天生會在元件掛載時執行一次的陷阱——
//      即使 searchResults 從未被使用者操作真正改變過,掛載當下那一次
//      執行仍會呼叫 onSearchResultsChange,導致使用者剛進入規劃地圖畫面
//      (什麼都還沒搜尋)清單就憑空自動打開。
// 兩次 bug 的共通點都是「多個觸發點需要同步產生一致副作用」這件事,散落
// 在不同檔案的 inline callback 裡,沒有一個地方能一眼看出完整的狀態
// 轉換規則、也沒有測試守著。收斂成這個 reducer 後,三個查詢入口(城市
// 搜尋框/類別標籤/搜尋這個區域)都必須明確 dispatch 'search-started'
// 才會開清單——不再是某個 callback 字面命名底下的隱藏副作用,遺漏會在
// 呼叫端的程式碼裡直接看得出來(沒有 dispatch 這個事件),而非要等實際
// 操作才發現。
export interface ListDrawerState {
  open: boolean
  loading: boolean
}

export const initialListDrawerState: ListDrawerState = {
  open: false,
  loading: false,
}

// ListDrawerEvent 對應三個實際觸發時機:
//   search-started  使用者觸發查詢的當下——城市搜尋框按下搜尋/Enter、
//                    點類別標籤、按「搜尋這個區域」按鈕,三個入口共用
//                    同一個事件,不分別各自處理。
//   results-arrived 查詢結果真正回來——resultCount 帶實際筆數,見下方
//                    reducer 的「唯一解」判斷。
//   user-closed     使用者手動關閉清單(點清單項目、按關閉鈕、拖曳
//                    收合到底)。
export type ListDrawerEvent =
  | { type: 'search-started' }
  | { type: 'results-arrived'; resultCount: number }
  | { type: 'user-closed' }

// reduceListDrawerState:給定目前狀態 + 事件,回傳新狀態。
//
// 各事件的轉換理由:
//   search-started:立刻打開清單、進入載入中——使用者按下查詢的當下就該
//     有視覺回饋(清單抽屜滑出、顯示載入動畫),不用等查詢真的跑完才讓
//     使用者知道「有東西在發生」。這是使用者明確要求的行為(「輸入搜尋後
//     要開始搜尋時才出現搜尋清單」「點下搜尋/標籤的當下就開,顯示載入中,
//     不等結果回來」)。
//   results-arrived:resultCount === 1 時不開清單——使用者明確要求「搜尋
//     結果只有一個就不要出現地點清單」,唯一解本身已經由
//     GeoOutlinePanel.tsx 的既有邏輯自動觸發 onSearchResultSelect 打開
//     資訊卡(見該檔案 searchTrigger effect 的說明),使用者不需要再從
//     清單裡挑選僅有的這一筆,清單反而是多餘的一層。resultCount !== 1
//     (含 0 筆、2 筆以上)才開清單、結束載入中——0 筆也要開清單是既有
//     行為(讓使用者看到「查無結果」的空狀態文案,見
//     GeoOutlinePhoneListDrawer.tsx 的 isEmpty 分支),不是這次改動的
//     範圍。
//   user-closed:清單關閉、載入中狀態一併清空(避免使用者關閉後,若還有
//     一個延遲中的查詢結果之後才回來,誤留著已經不該存在的載入中視覺)。
export function reduceListDrawerState(state: ListDrawerState, event: ListDrawerEvent): ListDrawerState {
  switch (event.type) {
    case 'search-started':
      return { open: true, loading: true }
    case 'results-arrived':
      return { open: event.resultCount !== 1, loading: false }
    case 'user-closed':
      return { open: false, loading: false }
    default:
      return state
  }
}
