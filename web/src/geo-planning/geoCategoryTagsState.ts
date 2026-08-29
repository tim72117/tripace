// geoCategoryTagsState:管理地圖上方類別標籤列(景點/飯店/餐廳/探索)
// 該不該顯示的純 reducer——比照 geoListDrawerState.ts 的既有模式,把
// 「查詢開始就隱藏標籤列,查詢結果回來後再依內容決定要不要重新顯示」
// 這件事從「顯示與否直接看 hideCategoryTags 這個布林值」的做法,收斂成
// 明確事件驅動的狀態機。
//
// 背景:原本 GeoOutlineMap.tsx 用一個布林運算式決定標籤列顯示與否——
// 手機版 hideCategoryTags 直接吃 listDrawerState.open(清單開關狀態機的
// 衍生值),桌面版沒有傳這個 prop 時退回 searchResults.length > 0——
// 兩邊各自一套邏輯,且都是「結果有沒有東西」的衍生值,不是「查詢開始
// 這個時間點」本身,導致標籤列要等到查詢完成、結果回來才隱藏,查詢中
// 這段空窗期仍然顯示,容易讓使用者誤以為可以再點別的標籤。使用者明確
// 要求「開始搜尋就隱藏」——這正是 search-started 事件本該表達的時機,
// 不該再從搜尋結果反推。
//
// 手機版/桌面版共用同一個狀態機(不再各自維護一套判斷式)——查詢入口
// (城市搜尋框的 onSearch、類別標籤/搜尋這個區域共用的 onSearchStart)
// 跟 geoListDrawerState.ts 三個入口完全相同,呼叫端(GeoOutlinePhoneView.tsx/
// DesktopLayout.tsx)在同一個地方一併 dispatch 兩個 reducer 即可,不需要
// 這個檔案內部知道另一個 reducer 的存在。
export interface CategoryTagsState {
  hidden: boolean
}

export const initialCategoryTagsState: CategoryTagsState = {
  hidden: false,
}

// CategoryTagsEvent:
//   search-started   查詢開始的當下(城市搜尋框/類別標籤/搜尋這個區域
//                     三個入口共用)——立刻隱藏標籤列。
//   results-arrived  查詢結果回來(不論筆數)——結果非空時維持隱藏(避免
//                     标籤列疊在清單/候選籃內容上方,理由同原本
//                     searchResults.length > 0 隱藏的既有邏輯);結果為
//                     空時重新顯示,讓使用者能立刻換一顆標籤再查,不用
//                     先手動清空搜尋框。
//   user-closed      使用者關閉清單/候選籃結果(手機版清單抽屜關閉、
//                     桌面版候選籃側欄收合等)——重新顯示標籤列。
export type CategoryTagsEvent =
  | { type: 'search-started' }
  | { type: 'results-arrived'; hasResults: boolean }
  | { type: 'user-closed' }

export function reduceCategoryTagsState(state: CategoryTagsState, event: CategoryTagsEvent): CategoryTagsState {
  switch (event.type) {
    case 'search-started':
      return { hidden: true }
    case 'results-arrived':
      return { hidden: event.hasResults }
    case 'user-closed':
      return { hidden: false }
    default:
      return state
  }
}
