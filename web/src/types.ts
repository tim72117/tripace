// 與 Go server 的 model.go / docs/API.md 嚴格對齊的型別。
// 任何欄位改動都應同步這裡與後端,測試台才能忠實反映後端回應。

export interface Channel {
  id: string
  name: string
  ownerID: string
  memberCount: number
  lastMessagePreview: string | null
  updatedAt: string // ISO8601
}

export interface Message {
  id: string
  channelID: string
  authorID: string
  authorName: string
  text: string
  category: string | null
  tags: string[]
  summary: string | null
  createdAt: string // ISO8601
}

export interface User {
  id: string
  name: string
  avatarColor: string
}

export interface SearchAnswer {
  answer: string
  citedMessageIDs: string[]
  confidence?: number
}

// POST /v1/auth/apple 的回應
export interface AuthResponse {
  token: string
  user: User
}

// 後端統一錯誤格式:{ "error": { "code", "message" } }
export interface APIErrorBody {
  error: {
    code: string
    message: string
  }
}
