// 登入後 App(PhoneContent.tsx/DesktopLayout.tsx 及底下畫面)的介面深色/淺色
// 模式偏好。
//
// 跟 home/ 底下 HomePage.tsx/LegalPage.tsx 那套獨立、純記憶體(state 存在
// 元件內、reload 就重置)的機制不同——這裡是登入後正式 App,使用者切一次
// 之後應該要記得,故改成寫 localStorage(比照 assistLang.ts 的既有模式:
// 獨立成這個小檔案、型別 + key 常數 + getter,而非直接放進 useAppState.ts
// 或 App.tsx)。
//
// null 代表「跟隨系統」——不寫入 data-theme 屬性,交給 CSS 的
// prefers-color-scheme media query 決定,不需要額外的 matchMedia JS 邏輯
// (跟 HomePage.tsx/LegalPage.tsx 為了「切換鈕要顯示正確的下一個狀態圖示」
// 才需要的 systemPrefersDark state 不同,這裡的三段式選單不需要這件事)。
export type Theme = 'dark' | 'light' | null

export const THEME_KEY = 'tripace.theme'

// getTheme:讀取目前的主題偏好;未設定或值非法時回退 null(跟隨系統)。
export function getTheme(): Theme {
  const v = localStorage.getItem(THEME_KEY)
  return v === 'dark' || v === 'light' ? v : null
}
