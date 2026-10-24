// guestId.ts — 未登入訪客的穩定識別碼。
//
// 背景:/ai-plan 展示頁(planning/preview/LivePlanLayer.tsx)讓未登入訪客
// 體驗真實 AI 對話排行程,送出的訊息會打 POST /internal/plan-ai/chat 存檔
// (見 server/internal/api/plan_ai_chat.go)。那支端點原本直接擋掉未登入
// 請求,理由是後端 userFor() 對沒有合法 JWT 的請求一律回退成固定共用的
// s.guestUser(ID 固定 "usr_me")——若放行,所有訪客的對話記錄會混在同一個
// userID 下,不只是體驗問題:PlanAiChatMessageBelongsToUser(見該函式的
// 完整說明)用 userID 當權限邊界判斷「這筆 messageID 是不是你的」,共用
// 同一個 ID 代表任一訪客都能對另一個訪客開的 conversationID 回報內容,是
// 真正的跨訪客資料污染/竄改風險。
//
// 使用者明確要求「沒登入時給一個獨立 id」:每個瀏覽器各自生成一個隨機
// id、存在 localStorage,之後每次請求都帶上(見 api.ts 的 request()
// 如何使用這個函式),後端收到時把它當這次請求的 userID 使用(見
// server/internal/api/auth.go userFor 的訪客分支),不再共用固定的
// guestUser.ID。重整頁面、重新打開瀏覽器都拿到同一個 id(存在
// localStorage,不是每次重新生成)——同一位訪客的多次對話串能正確歸在
// 同一個識別碼下;不同瀏覽器/無痕視窗各自是獨立的 id,彼此不會混淆。
//
// 不要求跟真實登入帳號的 ID 格式相容(真實帳號是 "usr_" 前綴,見
// internal/api/auth.go handleRegister 等處的 newID() 用法)——訪客 id 用
// 獨立的 "guest_" 前綴,讓後端一眼就能分辨這個 userID 是訪客身分還是真實
// 帳號,不需要額外查資料庫才能判斷。

const GUEST_ID_KEY = 'tripace.guestId'

// randomGuestId — 不依賴 crypto.randomUUID() 以外的任何函式庫,瀏覽器
// 原生支援(Chrome 92+/Safari 15.4+/Firefox 95+,這個專案鎖定的目標瀏覽器
// 範圍內都支援,見 index.html 既有的瀏覽器相容性假設)。
function randomGuestId(): string {
  return `guest_${crypto.randomUUID()}`
}

// getGuestId — 取得(必要時建立)這個瀏覽器的訪客識別碼。
//
// 讀寫失敗(localStorage 被停用、無痕模式配額等)一律降級成每次呼叫都
// 重新生成一個新 id——理由同 planning/timeline/storage.ts saveTimeline
// 的既有降級慣例:持久化是加值功能,失敗時這次請求仍然應該能送出(降級
// 的代價只是「這次之後重整頁面會換一個新 id」,不是整個功能不可用)。
export function getGuestId(): string {
  try {
    const existing = localStorage.getItem(GUEST_ID_KEY)
    if (existing) return existing
    const id = randomGuestId()
    localStorage.setItem(GUEST_ID_KEY, id)
    return id
  } catch {
    return randomGuestId()
  }
}
