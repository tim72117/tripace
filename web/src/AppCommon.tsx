import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ClientConfig } from './api'
import { ApiError } from './api'
import type { Trip } from './trip/types'
import type { User } from './user/types'
import type { Theme } from './theme'
import { Banner } from './components/Banner'
import styles from './AppCommon.module.css'

// AppCommon:App.tsx 拆出來的共用工具/元件/常數/型別,供 App.tsx 本身、
// 以及 ChatScreen.tsx/CliAuthPage.tsx 等其他檔案共同 import——這些原本
// 寄生在 App.tsx 底下,但語意上不屬於「App 這個進入點元件」,獨立成自己
// 的檔案避免其他檔案得為了一顆 ErrorBanner 就 import 整支 1500+ 行的
// App.tsx。useIsDesktop/useAppState/useTripsState 已移到 hooks/ 目錄
// (見 hooks/useIsDesktop.ts、hooks/useAppState.ts、hooks/useTripsState.ts)
// ——這裡保留的是它們仍會用到、但也被其他非 hook 檔案獨立引用的常數
// (BASE_URL/LS_DEFAULT_TRIP)與型別(ContentProps),不適合跟著搬進單一
// hook 檔案裡。

// baseURL 由建置時的 VITE_API_BASE 決定(見 .env.development),不開放使用者於 UI 修改;
// 未設時退回目前頁面 origin(production 前後端同源部署)。
export const BASE_URL: string =
  import.meta.env.VITE_API_BASE || `${window.location.protocol}//${window.location.host}`

// SITE_SEO_BASE_URL:正式對外網域(目前 tripace.io),給四個城市介紹頁
// (JiufenPage/KyotoPage/TainanPage/TainanChikanPage)的 SEO_URL 常數跟
// JSON-LD breadcrumb 的 item 欄位組網址用——這幾處原本直接寫死完整的
// https://tripace.io/... 字串,換網域(例如過去從 tripace.shuttle.tools
// 換成 tripace.io)時得在一堆檔案裡做大範圍字串取代。改成由這個常數
// 統一組出來,網域字串只存在於環境變數這一個地方。
// 不能沿用 BASE_URL——BASE_URL 是「API 呼叫目標」(可能指向不同 host 的
// 後端),這裡要的是「這個網站對外公開的 origin」,語意不同,刻意分開
// 兩個常數,不要混用。
// 對應 server 端 server/.env.example 的 SITE_BASE_URL
// 環境變數(同一個網域,但那是 Go 執行期讀的環境變數,跟這裡 Vite
// 建置期讀的 VITE_ 前綴變數是兩套不相關的環境變數機制,只是刻意選了
// 對應的命名,方便對照)。未設定時 fallback 回 https://tripace.io,與
// server 端的預設值保持一致。結尾不帶斜線,用到的地方自己補上
// (跟下方組 URL 的寫法保持一致)。
export const SITE_SEO_BASE_URL: string = import.meta.env.VITE_SITE_BASE_URL || 'https://tripace.io'
// 默認旅程 ID (用戶設定的「開啟時自動進入」)
export const LS_DEFAULT_TRIP = 'tripace.defaultTripID'

export interface ContentProps {
  cfg: ClientConfig
  activeTrip: Trip | null
  setActiveTrip: (t: Trip | null) => void
  token: string | null
  setToken: (t: string | null) => void
  user: User
  email: string
  isGuest: boolean
  onAuthed: (token: string, user: User, email: string) => void
  onLogout: () => void
  theme: Theme
  setTheme: (t: Theme) => void
}

// ---- 共用小元件 ----

export function Avatar({ user }: { user: { name: string; avatarColor: string } }) {
  const hasColor = !!user.avatarColor
  return (
    <div
      className={hasColor ? styles.avatar : `${styles.avatar} ${styles.empty}`}
      style={hasColor ? { background: user.avatarColor } : undefined}
    >
      {user.name.slice(0, 1)}
    </div>
  )
}

// ErrorBanner:薄包裝,轉呼叫共用的 components/Banner.tsx(icon 固定開啟
// ——這裡原本就是帶 AlertCircle 圖示的版本)。維持 ErrorBanner 這個名字與
// msg prop 不變,而不是直接把 13+ 處呼叫端全部改成 import Banner——
// ErrorBanner 已經是這個專案裡「錯誤訊息橫幅」的慣用稱呼與慣用 API
// (見本檔案開頭說明,被 chat/trip/home 底下多個檔案共用),沒有必要為了
// 這次重構去動一個跟這次目標(收斂 DOM 結構重複)無關的命名/介面。
export function ErrorBanner({ msg }: { msg: string | null }) {
  return <Banner message={msg} icon />
}

// 統一把 API 錯誤轉成可顯示訊息。
export function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return String(e)
}

// Enter 送出,但略過輸入法(注音/中日韓)組字中的 Enter——
// 組字選字時的 Enter 是「確認選字」,不該觸發送出。
export function isSubmitEnter(e: ReactKeyboardEvent): boolean {
  // isComposing:組字進行中。keyCode 229:IME 處理中的按鍵。
  return e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229
}

