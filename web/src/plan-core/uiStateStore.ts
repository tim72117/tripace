// uiStateStore.ts — 前端維護「使用者目前在哪一個畫面、選了哪些項目」的
// 單一事實來源,供 LLM 透過 get_ui_state 工具讀取。
//
// 2026-10 新增(使用者明確要求「在前端維護一個使用者目前在哪一個畫面,
// 選了那些項目的資訊,提供一個新的工具讓 AI 讀取」)。
//
// 跟既有兩支查詢工具的分工——三者回答的是不同的問題,刻意不合併:
//   get_user_selection  「使用者最近『完成』的那一次選擇是什麼」
//                       (UserSelectionRecord,只有最後一次,選完才寫)
//   get_attraction_pool 「這次對話查過哪些景點」(placeId → 名稱的對照表)
//   get_ui_state        「使用者『現在』正在看什麼畫面、畫面上有哪些
//                       選項、已經選到哪裡」(此時此刻的畫面狀態)
//
// 為什麼需要第三支:前兩支都是「已經發生的事」的紀錄,答不出「現在」。
// LLM 常見的困境是它開完一個選單、這一輪就結束了(見 askPageTools.ts
// askPageOpenedResult 的完整說明:工具不等待),下一輪被叫起來時完全
//不知道使用者卡在哪一步——是還沒選?選到一半?還是早就選完了?
// 沒有這份資訊它只能猜,或是重複呼叫同一個開選單的工具(實機踩過的
// 迴圈,見該處的完整說明)。
//
// 為什麼是 module 層的單一實例、不是 React state:
// 讀取方是 AgentBridge 的工具 handler,它在 React 的渲染週期之外
// (WebSocket onmessage 回呼裡),拿不到 state 的最新值。寫入方是 UI
// 元件。這跟 attractionPoolStore.ts 面對的是同一個問題,沿用同一個
// 解法與形狀(module 單例 + put/get),不另外發明一套。
//
// 不持久化到 localStorage:這份資料描述的是「此刻的畫面」,重新整理頁面
// 之後畫面本來就重建了,留著上一次的畫面狀態只會誤導 LLM。這點跟
// 時間軸(要持久化)相反,也跟景點池(純記憶體)一致。

// PlanUiScreen——使用者目前在哪一個畫面。
//
// 值刻意對齊 AskPageInput 的各個形態(見 askPageTools.ts 該型別的完整
// 說明),不是另外發明一套畫面命名——前端這幾個「畫面」實際上就是詢問頁
// 的幾種形態,用同一套詞彙,LLM 讀到的名稱跟它呼叫的工具名稱對得上
// (在 country 畫面 ↔ 它剛呼叫過 ask_travel_country)。
//
//   timeline——沒有任何詢問頁開著,使用者看的是行程時間軸本身。這是
//     預設狀態,也是使用者「選完了、等你安排」的那個狀態。
//   country/city——國家/城市選單。
//   attractions——感興趣景點的候選卡片(含探查模式)。
//   transport——交通方式選單。
//   message——LLM 的純文字回覆氣泡。
export type PlanUiScreen = 'timeline' | 'country' | 'city' | 'attractions' | 'transport' | 'message'

// PlanUiOption——畫面上一個可選項目。
//
// id 是前端用來識別的值(景點是 placeId、國家/城市是那份固定清單的 id、
// 交通方式是 mode 字串),name 是人類可讀的名稱。兩個都給:LLM 要用
// name 跟使用者溝通、用 id 呼叫其他工具(例如 add_attraction 的 placeId)。
export interface PlanUiOption {
  id: string
  name?: string
}

// PlanUiState——回傳給 LLM 的完整畫面狀態。
export interface PlanUiState {
  screen: PlanUiScreen
  // title——畫面上實際顯示的標題文字(詢問頁的 reason,或各面板的預設
  // 標題)。給 LLM 知道使用者看到的提問是什麼——同一個 attractions
  // 畫面,標題是「選擇感興趣的景點」還是 LLM 自己帶的 reason,代表的
  // 情境不同。
  title?: string
  // options——這個畫面上有哪些選項可選。timeline/message 畫面沒有選項,
  // 是空陣列。
  options: PlanUiOption[]
  // selected——使用者在這個畫面上已經選了哪些(複選的景點畫面可能有
  // 多個;單選畫面選完就直接送出、畫面會跟著關掉,所以通常是空的)。
  selected: PlanUiOption[]
  // updatedAt——這份狀態是什麼時候記錄的(ISO 字串)。LLM 可以用它
  // 判斷讀到的是不是剛剛那一刻的畫面。
  updatedAt: string
}

const EMPTY: PlanUiState = { screen: 'timeline', options: [], selected: [], updatedAt: '' }

let current: PlanUiState = EMPTY

export const uiStateStore = {
  // set——整份覆寫。畫面切換是一次性的事件(開選單/收選單),沒有
  // 「部分更新」的語意,所以不做 merge——partial 更新會讓「上一個畫面
  // 殘留的 options 混進新畫面」這種 bug 有機會發生。
  set(next: Omit<PlanUiState, 'updatedAt'>): void {
    current = { ...next, updatedAt: new Date().toISOString() }
  },
  // setSelected——只更新「已選了哪些」,保留 screen/title/options。
  // 使用者在複選的景點畫面上逐張點選時用這支:畫面沒有切換,只有選取
  // 狀態在變。
  setSelected(selected: PlanUiOption[]): void {
    current = { ...current, selected, updatedAt: new Date().toISOString() }
  },
  // reset——回到 timeline 畫面(沒有詢問頁開著)。詢問頁關閉時呼叫。
  reset(): void {
    current = { screen: 'timeline', options: [], selected: [], updatedAt: new Date().toISOString() }
  },
  get(): PlanUiState {
    return current
  },
  // clear——測試用:把狀態還原成初始值(含空的 updatedAt),讓每個測試
  // 案例從乾淨狀態開始。對齊 attractionPoolStore 的同名方法。
  clear(): void {
    current = EMPTY
  },
}
