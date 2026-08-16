// 與 Go server 的 model.go / docs/API.md 嚴格對齊的型別。
// 任何欄位改動都應同步這裡與後端,前端才能忠實反映後端回應。

export interface Trip {
  id: string
  name: string
  ownerID: string
  memberCount: number
  lastMessagePreview: string | null
  updatedAt: string // ISO8601
}
