// 與 Go server 的 model.go / docs/API.md 嚴格對齊的型別。
// 任何欄位改動都應同步這裡與後端,前端才能忠實反映後端回應。

// Message 是使用者說的「原話」:純文字 + 作者 + 時間。
// LLM 處理後的結構化資訊(分類/標籤/摘要/事件時間)改放在 Entry(types.ts)。
export interface Message {
  id: string
  tripID: string
  authorID: string
  authorName: string
  text: string
  createdAt: string // ISO8601
}
