// 與 Go server 的 model.go / docs/API.md 嚴格對齊的型別。
// 任何欄位改動都應同步這裡與後端,前端才能忠實反映後端回應。

// User 是公開身分(成員列表、訊息作者等),不含私密資料。
export interface User {
  id: string
  name: string
  avatarColor: string
}

// 旅程成員角色:editor 可記事/編輯,viewer 只能查詢。對應後端 model 的 role。
export type TripRole = 'editor' | 'viewer'

// Member 是旅程成員:公開身分 + 在該旅程的角色。對應後端 model.Member(扁平結構)。
export interface Member extends User {
  role: TripRole
}

// Profile 是私密資料,只在「自己的帳號」端點回傳。
export interface Profile {
  email: string
}

// PlanTier 是訂閱方案代號,對應後端 model.PlanTier——"free"(免費版)或
// "fan"(粉絲專案版)。見 web/src/plan-subscription/ 底下的完整說明
// (方案機制第一階段:只建置方案定義跟訂閱介面,不做任何功能限制)。
export type PlanTier = 'free' | 'fan'

// Me 是登入後的自己:公開身分 + 私密資料 + 目前的訂閱方案代號。
// GET /v1/me、login/register/apple/google 皆回傳此結構(planTier 隨同
// 既有欄位一起回傳,前端不需要額外呼叫一支新 API 才能知道自己是什麼
// 方案——見後端 model.Me 的完整設計說明)。
export interface Me {
  user: User
  profile: Profile
  planTier: PlanTier
}

// login / register / apple 的回應:Me + token。
export interface AuthResponse {
  token: string
  user: User
  profile: Profile
  planTier: PlanTier
  // isNewUser:這次驗證是否剛建立了一筆新帳號(見後端 issueToken 的完整
  // 說明)——login/register 兩種方式必然是確定值(login 恆 false、
  // register 恆 true),Google/Apple 第三方登入才需要靠這個欄位分辨
  // 「這次是查到既有帳號還是剛建立」。web/src/analytics.ts 的
  // fireRegistrationConversion 靠這個欄位決定要不要觸發註冊轉換事件,
  // 避免同一個第三方帳號每次登入都誤觸發一次轉換。
  isNewUser: boolean
}
