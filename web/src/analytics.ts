// analytics.ts:GTM(Google Tag Manager)dataLayer 事件推送的共用工具——
// 只負責 window.dataLayer.push(...),不直接呼叫 gtag(...)、也不另外
// 載入 gtag.js——web/index.html 已經有寫死的 GTM 容器(GTM-563D8TXG),
// 哪個 dataLayer 事件會觸發哪個 GA4/Ads 標籤,由 GTM 容器後台的設定
// 決定,不是這個檔案的職責。
//
// trackEvent 是唯一、通用的進入點——新增一個追蹤事件只需要在呼叫端寫
// trackEvent('新事件名稱', {...}),不需要回這個檔案新增一個專屬的
// fire*() 函式。這是配合 GTM 後台的「萬用 GA4 事件」設定(見下方
// trackEvent 的完整說明):GTM 只要建一次「Custom Event trigger(比對
// 所有事件名稱)+ GA4 Event tag(Event Name 讀 {{Event}} 變數)」,
// 之後任何新的 trackEvent 呼叫都會自動流進 GA4,不需要每加一個事件就
// 回 GTM 後台手動設定一次。
//
// 例外:Google Ads 轉換(例如 fireRegistrationConversion 用的
// 'sign_up')沒辦法比照這套萬用機制——Ads 的轉換動作綁定特定的轉換
// ID/標籤,新增一種轉換類型仍然需要在 GTM/Ads 後台各自設定一個對應的
// tag,這是 Google Ads 平台本身的限制,不是這裡的程式碼能繞過的。
//
// VITE_DISABLE_ANALYTICS:本機開發時排除追蹤的關閉開關——
// web/index.html 的 GTM 容器腳本是純靜態 HTML(在任何 React/Vite 程式碼
// 執行之前就已經載入),無法在那裡讀 import.meta.env 做條件式載入,故
// 排除機制收斂在這裡:trackEvent 是所有追蹤事件(含 sign_up 這個 Ads
// 轉換)唯一的 dataLayer.push 進入點,只要這裡直接 no-op,本機測試登入/
// 註冊/點擊互動地圖等動作就不會把任何事件送進 GTM 容器,自然也不會誤觸發
// 正式環境才該計入的 Google Ads 轉換數據或 GA4 事件——不需要額外去改
// index.html 或猜測 GTM 容器裡還有沒有其他不經過 trackEvent 的 tag。
// 對齊 onagent 參考實作(/Users/caitingyu/Documents/onagent/apps/console)
// 同名環境變數的用途,預設(未設定)是啟用追蹤,需要在本機
// .env.development.local 明確加上 VITE_DISABLE_ANALYTICS=1 才會關閉。
const analyticsDisabled = import.meta.env.VITE_DISABLE_ANALYTICS === '1'

export function trackEvent(name: string, data?: Record<string, unknown>) {
  if (analyticsDisabled) return
  const w = window as unknown as { dataLayer?: Record<string, unknown>[] }
  w.dataLayer = w.dataLayer ?? []
  w.dataLayer.push({ event: name, ...data })
}

// fireRegistrationConversion:註冊轉換事件——事件名稱固定用 'sign_up'
// 這個精確字串,GTM 容器後台的「Ads Conversion - 註冊」trigger 綁定的
// 就是這個字串。若之後在這裡改名而沒有同步更新 GTM 容器設定,轉換會
// 「安靜地」失效(不會報錯,只是資料不會進來)——這是 Ads 轉換的例外
// 情況,不吃上面 trackEvent 的萬用機制(見該函式的完整說明),仍然保留
// 成獨立具名函式,方便一眼看出這是特別重要、需要對應 GTM 設定的事件,
// 不會被誤認成一般的 trackEvent 呼叫。
//
// 呼叫時機:只在確定「剛建立了一筆新帳號」時才呼叫,不是使用者點下
// 「註冊」按鈕當下就呼叫——見 web/src/home/LoginForm.tsx 的呼叫處,
// 帳密註冊靠 api.register() resolve(email 已存在會被後端擋在 409,
// 不會走到這裡)、第三方登入(Google/Apple)靠後端回傳的
// AuthResponse.isNewUser 欄位判斷,避免同一個帳號每次登入都誤觸發
// 一次註冊轉換。
export function fireRegistrationConversion() {
  trackEvent('sign_up')
}
