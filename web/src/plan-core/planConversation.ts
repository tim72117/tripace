// planConversation.ts — 規劃對話(AI 與使用者的文字訊息、連線錯誤訊息)的資料結構與純函式。
//
// 2026-10-24 從 PlanTimeline 獨立出來(使用者明確要求「把對話內容獨立出來」):原本對話是時間軸天裡
// type 為 'message' 的節點,夾在站點之間。那個做法讓行程資料混著對話——行程草稿存檔會帶著對話、
// 視圖要處處判斷節點型別、AI 的 list_itinerary 也得過濾掉訊息。現在對話有自己的資料層與 hook
// (見 usePlanConversation.ts),與行程完全分離;而且只存在記憶體,不持久化(使用者定案,重整後清空)。
//
// 三個設計決定(都是使用者定案):
//   1. 完全獨立的狀態:這個模組不 import 任何 planTimeline.ts 的東西,行程草稿只存行程。
//   2. 訊息只依發生順序:不記錄發生在哪一天或哪個站點之後,所以資料就是一個陣列,越後面越新。
//   3. 畫面呈現維持現有:訊息沒有位置之後,桌面時間軸把它們渲染在時間軸最下方(見 PlanTimelineView 的 messages prop)。
//
// 全部是純函式(回傳新物件、沒有變動就原樣回傳同一個參照),風格同 planTimeline.ts,測試不需要 mock 任何東西。

// PlanMessage——一則訊息。
//   - id:穩定 id,呼叫端產生(例如 agent-msg-<uuid>),同一份對話內必須唯一。
//   - text:訊息內容(AI 的回覆是 markdown)。
//   - stale:已淡化。新訊息出現或新增站點代表話題推進,舊訊息就標成 stale,渲染成收合/淡化的單行小字,
//     而不是被刪除(語意沿用過去時間軸 message 節點的 stale)。只負責承載狀態,不內建計時器。
export interface PlanMessage {
  id: string
  text: string
  stale?: boolean
}

// PlanConversation——依發生順序排列的訊息(index 0 最舊)。包成物件而不是直接用陣列,
// 讓日後要加欄位(例如 conversationId)時不必改所有簽名。
export interface PlanConversation {
  messages: PlanMessage[]
}

export function createEmptyConversation(): PlanConversation {
  return { messages: [] }
}

export function hasMessage(conv: PlanConversation, id: string): boolean {
  return conv.messages.some((m) => m.id === id)
}

// appendMessage——把一則訊息接在最後(發生順序)。id 已存在時不重複加入、原樣回傳(同一則訊息被重送不該出現兩次)。
export function appendMessage(conv: PlanConversation, message: PlanMessage): PlanConversation {
  if (hasMessage(conv, message.id)) return conv
  return { ...conv, messages: [...conv.messages, message] }
}

// staleAllMessages——把所有還沒淡化的訊息標成 stale(新增站點時用:話題已經推進);沒有要改的就原樣回傳。
export function staleAllMessages(conv: PlanConversation): PlanConversation {
  if (!conv.messages.some((m) => !m.stale)) return conv
  return { ...conv, messages: conv.messages.map((m) => (m.stale ? m : { ...m, stale: true })) }
}

// staleOtherMessages——把 excludeId 以外還沒淡化的訊息標成 stale(一則新訊息出現時,舊的淡化、新的維持完整);
// 沒有要改的就原樣回傳。語意對應過去 planTimeline.ts 的 staleOtherAgentMessages。
export function staleOtherMessages(conv: PlanConversation, excludeId: string): PlanConversation {
  if (!conv.messages.some((m) => m.id !== excludeId && !m.stale)) return conv
  return { ...conv, messages: conv.messages.map((m) => (m.id !== excludeId && !m.stale ? { ...m, stale: true } : m)) }
}

// clearConversation——清空(交接給推論層時用;「新行程」是元件重新掛載)。已經是空的就原樣回傳。
export function clearConversation(conv: PlanConversation): PlanConversation {
  return conv.messages.length === 0 ? conv : createEmptyConversation()
}
