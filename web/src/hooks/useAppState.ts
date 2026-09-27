import { useCallback, useEffect, useState } from 'react'
import { onUnauthorized, type ClientConfig } from '../api'
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

// clearAuthStorage:清空 token/user/email 三個 localStorage key——
// readAuthState(初始化一致性檢查失敗時)與 onLogout 共用同一組 key,
// 抽出來避免日後新增第四個登入相關 key(例如 refresh token)時,兩處各自
// 修改容易漏掉其中一處。
function clearAuthStorage() {
  localStorage.removeItem(AUTH_TOKEN_KEY)
  localStorage.removeItem(AUTH_USER_KEY)
  localStorage.removeItem(AUTH_EMAIL_KEY)
}

// readAuthState:一次讀取 localStorage 裡的 token/user/email 三項,並在
// 這裡做一致性檢查——2026-09 發現的實際案例:token/user 各自存在獨立的
// localStorage key,若手動(或瀏覽器儲存空間清理、部分寫入失敗等外部
// 原因)只清掉其中一個 key,重整頁面後兩個 useState 的 lazy initializer
// 各自獨立執行、互不知道對方的值,原本的 isGuest 判斷式又是看 user 是否
// 為 null(不是看 token)——結果會是「user 還在,畫面判定已登入」但
// 「token 已經消失,cfg.token 是 null,任何 API 請求都不會帶
// Authorization header」,使用者卡在一個看起來已登入、但依賴登入的功能
// 全部悄悄失敗的不一致狀態,且不會被 401 全域登出機制(onUnauthorized,
// 見下方説明)攔到——那個機制假設「先前確實帶著 token 發過請求」,這裡
// 卻是根本沒有 token 可帶。故初始化時就檢查兩者是否同時存在,任一方
// 缺席就視為整組登入態已經失效,兩者(連同 email)一併清空,不是各自
// 獨立讀取。
function readAuthState(): { token: string | null; user: User | null; email: string } {
  const token = localStorage.getItem(AUTH_TOKEN_KEY)
  const rawUser = localStorage.getItem(AUTH_USER_KEY)
  const user = rawUser ? (JSON.parse(rawUser) as User) : null
  const email = localStorage.getItem(AUTH_EMAIL_KEY) ?? ''

  if ((token == null) !== (user == null)) {
    clearAuthStorage()
    return { token: null, user: null, email: '' }
  }
  return { token, user, email }
}

export function useAppState() {
  const [authState, setAuthState] = useState(readAuthState)
  const { token, user, email } = authState
  const setToken = useCallback((tok: string | null) => {
    setAuthState((s) => ({ ...s, token: tok }))
  }, [])

  const onAuthed = useCallback((tok: string, u: User, mail: string) => {
    localStorage.setItem(AUTH_TOKEN_KEY, tok)
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(u))
    localStorage.setItem(AUTH_EMAIL_KEY, mail)
    setAuthState({ token: tok, user: u, email: mail })
  }, [])

  const [activeTrip, setActiveTrip] = useState<Trip | null>(null)

  // onLogout:除了清空 auth 三項(token/user/email),也要清掉
  // activeTrip/LS_DEFAULT_TRIP——否則登出後換帳號登入,舊帳號選過的旅程
  // (activeTrip 這個 state、以及 localStorage 記住的預設旅程 ID)會原封
  // 不動留著,新帳號一登入就會拿著上一位使用者的 tripID 建 WebSocket、
  // 呼叫 fetchEntries(該旅程不屬於新帳號,後端回 403),畫面標題還會短暫
  // 顯示前一位使用者的旅程名稱,直到使用者自己手動切換旅程才會發現不對。
  const onLogout = useCallback(() => {
    clearAuthStorage()
    localStorage.removeItem(LS_DEFAULT_TRIP)
    setAuthState({ token: null, user: null, email: '' })
    setActiveTrip(null)
  }, [])

  // 2026-09 加入:訂閱 api.ts 的全域 401 通知(見 onUnauthorized 的完整
  // 說明)——任何一次帶著登入 token 的請求收到 401,代表這個 token 已經
  // 過期或失效(見 server/internal/api/middleware.go internalAuth 的
  // 完整說明:這種情況後端訊息已經改成中性的「登入已過期,請重新登入」,
  // 不再假設呼叫端是 CLI),直接呼叫既有的 onLogout() 清空登入態、導回
  // 登入畫面,不需要使用者自己發現查詢一直悄悄失敗才手動登出。
  useEffect(() => onUnauthorized(onLogout), [onLogout])

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
    // isGuest 依 token(而非 user)判斷——token 才是實際決定 API 請求
    // 能不能帶 Authorization header 的關鍵(見 cfg 的組裝),user 只是
    // 顯示用的身分快照。readAuthState 已經保證初始化時兩者同步存在或
    // 同時清空,這裡改看 token 是額外一層防禦,避免未來任何繞過
    // readAuthState 的路徑(理論上不該有,但欄位語意上 token 才是那個
    // 唯一重要的真相來源)重新引入同一種不一致。
    user: effectiveUser, email, isGuest: token == null,
    onAuthed, onLogout,
    theme, setTheme,
  }
}
