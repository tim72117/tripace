import { useCallback, useState } from 'react'
import type { ClientConfig } from '../api'
import type { Trip } from '../trip/types'
import type { User } from '../user/types'
import { BASE_URL, LS_DEFAULT_TRIP } from '../AppCommon'
import { type Theme, THEME_KEY, getTheme } from '../theme'

// 登入身分存 localStorage:跨分頁共用同一身分(一般網站慣例)。
const AUTH_TOKEN_KEY = 'tripace.auth.token'
const AUTH_USER_KEY = 'tripace.auth.user'
const AUTH_EMAIL_KEY = 'tripace.auth.email'

// 訪客身分(未登入),需與後端 guestUser 一致。
const GUEST_USER: User = { id: 'usr_me', name: '訪客', avatarColor: '#8C7B6A' }

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

  const [activeTrip, setActiveTrip] = useState<Trip | null>(null)

  // onLogout:除了清空 auth 三項(token/user/email),也要清掉
  // activeTrip/LS_DEFAULT_TRIP——否則登出後換帳號登入,舊帳號選過的旅程
  // (activeTrip 這個 state、以及 localStorage 記住的預設旅程 ID)會原封
  // 不動留著,新帳號一登入就會拿著上一位使用者的 tripID 建 WebSocket、
  // 呼叫 fetchEntries(該旅程不屬於新帳號,後端回 403),畫面標題還會短暫
  // 顯示前一位使用者的旅程名稱,直到使用者自己手動切換旅程才會發現不對。
  const onLogout = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(AUTH_USER_KEY)
    localStorage.removeItem(AUTH_EMAIL_KEY)
    localStorage.removeItem(LS_DEFAULT_TRIP)
    setToken(null)
    setUser(null)
    setEmail('')
    setActiveTrip(null)
  }, [])

  // theme:登入後 App 的深色/淺色模式偏好,見 theme.ts 開頭說明。狀態提升到
  // 這裡(而非留在 App.tsx 或掛載點元件本地)是因為要被 App.tsx(掛在
  // .app-theme-root 的 data-theme 屬性)跟 SettingsDialog.tsx/
  // SettingsScreen.tsx(兩個不同層級的設定畫面)共同消費——專案沒有
  // Context/全域狀態管理慣例,既有模式就是 useAppState() 回傳的 props 一路
  // 往下傳,這裡沿用同一套。持久化邏輯集中寫在 setTheme 內(不像
  // assistLang 那樣留給每個呼叫端各自 inline 處理 localStorage),因為
  // theme 有多個消費端,寫在單一入口才不會有地方漏寫。
  const [theme, setThemeState] = useState<Theme>(() => getTheme())
  const setTheme = useCallback((t: Theme) => {
    if (t === null) localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, t)
    setThemeState(t)
  }, [])

  const cfg: ClientConfig = { baseURL: BASE_URL, token }
  const effectiveUser = user ?? GUEST_USER

  return {
    cfg, activeTrip, setActiveTrip,
    token, setToken,
    user: effectiveUser, email, isGuest: user == null,
    onAuthed, onLogout,
    theme, setTheme,
  }
}
