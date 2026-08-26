import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AlertCircle } from 'lucide-react'
import type { ClientConfig } from './api'
import { ApiError } from './api'
import type { Trip } from './trip/types'
import type { User } from './user/types'
import type { Theme } from './theme'
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

export function ErrorBanner({ msg }: { msg: string | null }) {
  if (!msg) return null
  return <div className="banner"><AlertCircle size={14} strokeWidth={2} style={{verticalAlign: 'middle', marginRight: 6}} />{msg}</div>
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

