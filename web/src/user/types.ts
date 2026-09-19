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

// Me 是登入後的自己:公開身分 + 私密資料。GET /v1/me 回傳此結構。
export interface Me {
  user: User
  profile: Profile
}

// login / register / apple 的回應:Me + token。
export interface AuthResponse {
  token: string
  user: User
  profile: Profile
  // isNewUser:這次驗證是否剛建立了一筆新帳號(見後端 issueToken 的完整
  // 說明)——login/register 兩種方式必然是確定值(login 恆 false、
  // register 恆 true),Google/Apple 第三方登入才需要靠這個欄位分辨
  // 「這次是查到既有帳號還是剛建立」。web/src/analytics.ts 的
  // fireRegistrationConversion 靠這個欄位決定要不要觸發註冊轉換事件,
  // 避免同一個第三方帳號每次登入都誤觸發一次轉換。
  isNewUser: boolean
}
