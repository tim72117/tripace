import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AlertCircle } from 'lucide-react'
import type { ClientConfig } from './api'
import * as api from './api'
import { ApiError } from './api'
import type { Trip, User } from './types'

// AppCommon:App.tsx 拆出來的共用工具/元件,供 App.tsx 本身、以及
// ChatScreen.tsx/CliAuthPage.tsx 等其他檔案共同 import——這些原本寄生在
// App.tsx 底下,但語意上不屬於「App 這個進入點元件」,獨立成自己的檔案
// 避免其他檔案得為了一顆 ErrorBanner 就 import 整支 1500+ 行的 App.tsx。

// baseURL 由建置時的 VITE_API_BASE 決定(見 .env.development),不開放使用者於 UI 修改;
// 未設時退回目前頁面 origin(production 前後端同源部署)。
export const BASE_URL: string =
  import.meta.env.VITE_API_BASE || `${window.location.protocol}//${window.location.host}`
// 默認行程 ID (用戶設定的「開啟時自動進入」)
export const LS_DEFAULT_TRIP = 'tripace.defaultTripID'
// 登入身分存 localStorage:跨分頁共用同一身分(一般網站慣例)。
const AUTH_TOKEN_KEY = 'tripace.auth.token'
const AUTH_USER_KEY = 'tripace.auth.user'
const AUTH_EMAIL_KEY = 'tripace.auth.email'

// 訪客身分(未登入),需與後端 guestUser 一致。
const GUEST_USER: User = { id: 'usr_me', name: '訪客', avatarColor: '#8C7B6A' }

// 桌面版斷點,需與 styles.css 的 @media (min-width: 768px) 一致。
const DESKTOP_BREAKPOINT = 768

// useIsDesktop:用 matchMedia 判斷目前寬度是否達到桌面斷點。
// 用 JS 判斷、只渲染其中一種佈局(而非兩份 DOM 都渲染、用 CSS 切換顯示),
// 是因為 ChatScreen 掛載時會建立 WebSocket 連線並各自 fetch 資料——
// 若手機版與桌面版兩棵 DOM 同時存在,選中行程時會同時掛載兩個 ChatScreen,
// 造成重複連線與重複請求。供 App.tsx 的 PhoneContent/PublicPaceDemoPage
// 共用,故放在這裡而非任一個消費端自己的檔案。
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`)
    const onChange = () => setIsDesktop(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}

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
}

export function useAppState() {
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem(AUTH_TOKEN_KEY),
  )
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem(AUTH_USER_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  })
  const [email, setEmail] = useState<string>(
    () => localStorage.getItem(AUTH_EMAIL_KEY) ?? '',
  )

  const onAuthed = useCallback((tok: string, u: User, mail: string) => {
    localStorage.setItem(AUTH_TOKEN_KEY, tok)
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(u))
    localStorage.setItem(AUTH_EMAIL_KEY, mail)
    setToken(tok)
    setUser(u)
    setEmail(mail)
  }, [])

  const onLogout = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(AUTH_USER_KEY)
    localStorage.removeItem(AUTH_EMAIL_KEY)
    setToken(null)
    setUser(null)
    setEmail('')
  }, [])

  const [activeTrip, setActiveTrip] = useState<Trip | null>(null)

  const cfg: ClientConfig = { baseURL: BASE_URL, token }
  const effectiveUser = user ?? GUEST_USER

  return {
    cfg, activeTrip, setActiveTrip,
    token, setToken,
    user: effectiveUser, email, isGuest: user == null,
    onAuthed, onLogout,
  }
}

// ---- 共用小元件 ----

export function Avatar({ user }: { user: { name: string; avatarColor: string } }) {
  const hasColor = !!user.avatarColor
  return (
    <div
      className={hasColor ? 'avatar' : 'avatar avatar-empty'}
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

// ---- 行程列表:共用資料邏輯(抓取/建立/自動導向預設行程) ----
// 手機版 PhoneNavDrawer 的行程列表分頁(見 PhoneNavDrawer.tsx)與桌面版
// 側欄列表 DesktopTripList(見 DesktopLayout.tsx)共用同一份 state 管理與
// API 呼叫,只有呈現方式(渲染 JSX)不同,避免整套重寫一份。放在這裡(而非
// DesktopLayout.tsx)是因為手機版也要用,放桌面檔案會讓 PhoneContent.tsx
// 得回頭 import 桌面檔案,形成循環依賴。
export function useTripsState(cfg: ClientConfig, onOpen: (t: Trip) => void) {
  const [trips, setTrips] = useState<Trip[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const hasAutoNavigatedRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    hasAutoNavigatedRef.current = false
    try {
      setTrips(await api.fetchTrips(cfg))
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (trips.length > 0 && !hasAutoNavigatedRef.current) {
      const defaultID = localStorage.getItem(LS_DEFAULT_TRIP)
      if (defaultID) {
        const defaultTrip = trips.find((t) => t.id === defaultID)
        if (defaultTrip) {
          hasAutoNavigatedRef.current = true
          onOpen(defaultTrip)
        }
      }
    }
  }, [trips, onOpen])

  const submitCreate = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      await api.createTrip(cfg, name)
      setNewName('')
      setCreating(false)
      load()
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  return {
    trips, err, loading,
    creating, setCreating,
    newName, setNewName,
    submitCreate,
  }
}
