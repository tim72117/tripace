// ChatScreen.tsx 與 MessageBubble.tsx 共用的型別/常數,獨立成檔案避免兩者
// 互相 import 對方造成循環依賴(ChatScreen 需要 MessageBubble 元件本身,
// MessageBubble 需要這裡的 ChatMessage/ASSISTANT_ID/ENTRY_QUERY_BATCH_KEY)。
import type { AssistPlace, PresentedEntry } from './api'
import type { Message } from './types'

// 助手(assist 回答)的作者 ID,需與後端及 iOS ChatStore.assistantID 一致。
export const ASSISTANT_ID = 'usr_assistant'

// 聊天訊息(後端 Message + 前端專用欄位)。
// presented:agent 用 present_entries 輸出、要在答案泡泡下用列表顯示的條目。
// recommendedPlaces:agent 用 recommend_nearby 查到、要在答案泡泡下用卡片列表
//   顯示的候選景點(取代先前透過 WS recommended_places 事件整批塞進全域 state、
//   彈出 RecommendedPlacesModal 蓋住畫面的做法——現在跟 presented 一樣掛在觸發
//   它的這則訊息底下,同一輪對話連續觸發兩次也不會互相覆蓋)。
// pending:後端處理中的佔位泡泡,渲染海浪載入動畫(無文字),完成後就地替換。
// tripListTriggered:這一輪 send()/api.assist() 期間偵測到 clientToolsBatches
//   有變化(entry_query 的 entries_loaded WS 事件、或 trip_entry_add/update 觸發
//   ClientToolsBridge 呼叫 setAllBatches 任一個把它改了),記下「具體
//   是哪些 key 變了」——旅程清單現在分成多個獨立批次(key),同一輪工具呼叫
//   可能只動到其中一個 key,也可能因為連續呼叫(如同一輪先後對兩個不同批次
//   新增)動到多個,故存陣列而非單一 key 或布林值。純標記、不存清單內容快照
//   ——渲染時 MessageBubble 即時讀取當下最新的 clientToolsBatches state 裡
//   這些 key 各自對應的清單顯示(見下方 send() 判斷邏輯與 MessageBubble 的
//   tripBatches prop)。不持久化(重新整理頁面後這個標記會消失,可接受)。
export type ChatMessage = Message & {
  presented?: PresentedEntry[]
  recommendedPlaces?: AssistPlace[]
  pending?: boolean
  tripListTriggered?: string[]
}

// ENTRY_QUERY_BATCH_KEY：entry_query(見 server/internal/wanttools/entry_query.go)
// 查到的條目透過 entries_loaded WS 事件推播進來時,存放進 clientToolsBatches
// 底下的固定 key。entry_query 跟這次「多批次(key)支援」改動範圍外——它查的
// 是 Postgres entries 表,不是 trip_entry_* 這組操作的前端記憶體清單,完全沒有
// key 概念(LLM 呼叫它時不會、也不需要指定 key)。但它查到的結果仍然掛在同一個
// clientToolsBatches 狀態、同一套 MessageBubble/TripListTable 渲染邏輯下顯示,
// 所以仍需要一個 key 把它放進去——用底線開頭的固定字串,不會與 LLM 自訂的
// 語意化 key(如 tokyo_trip)或時間戳格式 key 撞名(assistant_agent.go 教 LLM
// 用的命名規則都不會產生底線開頭的字串)。
export const ENTRY_QUERY_BATCH_KEY = '_entry_query'
