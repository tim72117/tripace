// 與 Go server 的 model.go / docs/API.md 嚴格對齊的型別。
// 任何欄位改動都應同步這裡與後端,前端才能忠實反映後端回應。

export interface Channel {
  id: string
  name: string
  ownerID: string
  memberCount: number
  lastMessagePreview: string | null
  updatedAt: string // ISO8601
}

// Message 是使用者說的「原話」:純文字 + 作者 + 時間。
// LLM 處理後的結構化資訊(分類/標籤/摘要/事件時間)改放在 Entry。
export interface Message {
  id: string
  channelID: string
  authorID: string
  authorName: string
  text: string
  createdAt: string // ISO8601
}

// User 是公開身分(成員列表、訊息作者等),不含私密資料。
export interface User {
  id: string
  name: string
  avatarColor: string
}

// 頻道成員角色:editor 可記事/編輯,viewer 只能查詢。對應後端 model 的 role。
export type ChannelRole = 'editor' | 'viewer'

// Member 是頻道成員:公開身分 + 在該頻道的角色。對應後端 model.Member(扁平結構)。
export interface Member extends User {
  role: ChannelRole
}

// Profile 是私密資料,只在「自己的帳號」端點回傳。
export interface Profile {
  email: string
}

// Me 是登入後的自己:公開身分 + 私密資料。GET /v1/me 回傳此結構。
export interface Me {
  user: User
  profile: Profile
}

export interface SearchAnswer {
  answer: string
  citedMessageIDs: string[]
  confidence?: number
}

// Entry 是主體:LLM 處理訊息後產出的「事件/條目」,承載所有結構化結果。
// 可獨立存在,並可關聯多則來源訊息(多對多)。
//
// 時間欄位(2026-07 從字串改為 ISO 8601 timestamp,見後端
// server/internal/store/entity.go 的完整說明):startAt/endAt 是 UTC 絕對
// 時刻,tz 是事件所屬的 IANA 時區(如 "Asia/Tokyo")。顯示前一律要用
// timefmt.ts 的 formatLocal/formatLocalDisplay 依 tz 換算,不要直接把
// startAt 當本地時間讀——旅遊行程的時間是「目的地當地時間」,不是「檢視者
// 所在地時間」,兩者在使用者抵達目的地前後會不一致。allDay=true 時 startAt
// 是當日在 tz 時區的 00:00,顯示應忽略時刻部分。
// Go 的 `omitempty` 讓這些欄位在對應零值(nil/""/false)時整個從 JSON
// 消失,故都宣告成 optional(?),而非 string | null。
export interface Entry {
  id: string
  channelID: string
  title: string // 事項描述
  startAt?: string // ISO 8601(UTC);不存在=無時間資訊
  endAt?: string // ISO 8601(UTC);不存在=無結束時間
  tz?: string // IANA 時區名,如 "Asia/Tokyo"
  allDay?: boolean // true=全日事件(忽略 startAt 的時刻部分)
  location?: string | null // 地點(可空);目前由人工/前端填,LLM 暫不自動抽取
  lat?: number | null
  lng?: number | null
  tripID?: string | null // 所屬行程;後端依時間自動歸組,未歸組為 null
  // LLM 標注(原本在 Message 上,改放 Entry;目前後端先留空)。
  // 後端標注未填時 tags 會回 null(非 []),消費端需 ?? [] 收斂。
  category: string | null
  tags: string[] | null
  note: string | null
  createdAt: string // ISO8601
}

// Trip 是 entries 的行程分組(後端依時間自動歸組)。時間欄位語意同 Entry。
export interface Trip {
  id: string
  channelID: string
  title: string
  startAt?: string | null
  endAt?: string | null
  tz?: string
  createdAt: string
}

// login / register / apple 的回應:Me + token。
export interface AuthResponse {
  token: string
  user: User
  profile: Profile
}

// 後端統一錯誤格式:{ "error": { "code", "message" } }
export interface APIErrorBody {
  error: {
    code: string
    message: string
  }
}
