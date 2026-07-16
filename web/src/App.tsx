import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  ChevronLeft,
  Send, AlertCircle, Plus, LogIn,
} from 'lucide-react'
import type { ClientConfig } from './api'
import * as api from './api'
import { ApiError } from './api'
import type { Channel, Entry, User } from './types'
import { LandingPage } from './LandingPage'
import { ChatScreen } from './ChatScreen'
import { MultiTrackTimeline } from './Timeline'

// baseURL 是連線設定,跨分頁共用 → localStorage。
const LS_BASE = 'shuttle.baseURL'
// 默認頻道 ID (用戶設定的「目前行程」)
export const LS_DEFAULT_CHANNEL = 'shuttle.defaultChannelID'
// token / user 是「登入身分」,改用 sessionStorage:每個分頁獨立,
// 讓不同分頁能登入不同使用者(也為 per-session 鋪路)。
const SS_TOKEN = 'shuttle.token'
const SS_USER = 'shuttle.user'
const SS_EMAIL = 'shuttle.email'


export function useAppState() {
  const [baseURL, setBaseURL] = useState(() => {
    const saved = localStorage.getItem(LS_BASE)
    if (saved) return saved
    // 未設定過:開發環境用 VITE_API_BASE(見 .env.development,固定指向 Go server),
    // 其他情況(production 部署,前後端同源)用目前頁面 origin。
    return import.meta.env.VITE_API_BASE || `${window.location.protocol}//${window.location.host}`
  })
  useEffect(() => localStorage.setItem(LS_BASE, baseURL), [baseURL])

  const [token, setToken] = useState<string | null>(
    () => sessionStorage.getItem(SS_TOKEN),
  )
  const [user, setUser] = useState<User | null>(() => {
    const raw = sessionStorage.getItem(SS_USER)
    return raw ? (JSON.parse(raw) as User) : null
  })
  const [email, setEmail] = useState<string>(
    () => sessionStorage.getItem(SS_EMAIL) ?? '',
  )

  const onAuthed = useCallback((tok: string, u: User, mail: string) => {
    sessionStorage.setItem(SS_TOKEN, tok)
    sessionStorage.setItem(SS_USER, JSON.stringify(u))
    sessionStorage.setItem(SS_EMAIL, mail)
    setToken(tok)
    setUser(u)
    setEmail(mail)
  }, [])

  const onLogout = useCallback(() => {
    sessionStorage.removeItem(SS_TOKEN)
    sessionStorage.removeItem(SS_USER)
    sessionStorage.removeItem(SS_EMAIL)
    setToken(null)
    setUser(null)
    setEmail('')
  }, [])

  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)

  const cfg: ClientConfig = { baseURL, token }
  const effectiveUser = user ?? GUEST_USER

  return {
    cfg, activeChannel, setActiveChannel,
    baseURL, setBaseURL, token, setToken,
    user: effectiveUser, email, isGuest: user == null,
    onAuthed, onLogout,
  }
}

export function App() {
  const props = useAppState()
  // 根路徑渲染產品介紹 landing page(全寬,不套 phone 外框)
  if (window.location.pathname === '/') {
    return <LandingPage />
  }
  // 偵測 /public/{token} 路徑，直接渲染公開分享頁
  const publicMatch = window.location.pathname.match(/^\/public\/([^/]+)$/)
  if (publicMatch) {
    return (
      <div className="web-app">
        <PublicViewScreen token={publicMatch[1]} />
      </div>
    )
  }
  // /app 路徑:開發測試台本體(套 iPhone 外框)
  return (
    <div className="web-app">
      <PhoneContent {...props} />
    </div>
  )
}

// 訪客身分(未登入),需與後端 guestUser 一致。
const GUEST_USER: User = { id: 'usr_me', name: '訪客', avatarColor: '#8e8e93' }

export interface ContentProps {
  cfg: ClientConfig
  activeChannel: Channel | null
  setActiveChannel: (c: Channel | null) => void
  baseURL: string
  setBaseURL: (s: string) => void
  token: string | null
  setToken: (t: string | null) => void
  user: User
  email: string
  isGuest: boolean
  onAuthed: (token: string, user: User, email: string) => void
  onLogout: () => void
}

export function PhoneContent(props: ContentProps) {
  const { cfg, activeChannel, setActiveChannel } = props
  const [inSettings, setInSettings] = useState(false)

  if (props.isGuest) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-card-header">
            <div className="login-card-title">歡迎使用 Shuttle</div>
            <div className="login-card-subtitle">請先登入或註冊帳號,才能查看與使用頻道功能。</div>
          </div>
          <LoginForm baseURL={cfg.baseURL} onAuthed={props.onAuthed} />
        </div>
      </div>
    )
  }

  if (activeChannel) {
    return (
      <ChatScreen
        cfg={cfg}
        channel={activeChannel}
        user={props.user}
        onBack={() => setActiveChannel(null)}
      />
    )
  }

  if (inSettings) {
    return (
      <SettingsScreen
        cfg={props.cfg}
        baseURL={props.baseURL}
        setBaseURL={props.setBaseURL}
        user={props.user}
        email={props.email}
        isGuest={props.isGuest}
        onAuthed={props.onAuthed}
        onLogout={() => { props.onLogout(); setInSettings(false) }}
        onBack={() => setInSettings(false)}
      />
    )
  }

  return (
    <ChannelsScreen
      cfg={props.cfg}
      user={props.user}
      isGuest={props.isGuest}
      onAuthed={props.onAuthed}
      onOpen={(c) => setActiveChannel(c)}
      onOpenSettings={() => setInSettings(true)}
    />
  )
}


// ---- 共用小元件 ----

export function Avatar({ user }: { user: { name: string; avatarColor: string } }) {
  return (
    <div className="avatar" style={{ background: user.avatarColor }}>
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

// ---- 頻道列表頁 ----

function ChannelsScreen({
  cfg,
  user,
  isGuest,
  onAuthed,
  onOpen,
  onOpenSettings,
}: {
  cfg: ClientConfig
  user: User
  isGuest: boolean
  onAuthed: (token: string, user: User, email: string) => void
  onOpen: (c: Channel) => void
  onOpenSettings: () => void
}) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [showLogin, setShowLogin] = useState(false)
  const hasAutoNavigatedRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    hasAutoNavigatedRef.current = false
    try {
      setChannels(await api.fetchChannels(cfg))
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
    if (channels.length > 0 && !hasAutoNavigatedRef.current) {
      const defaultID = localStorage.getItem(LS_DEFAULT_CHANNEL)
      if (defaultID) {
        const defaultChannel = channels.find((c) => c.id === defaultID)
        if (defaultChannel) {
          hasAutoNavigatedRef.current = true
          onOpen(defaultChannel)
        }
      }
    }
  }, [channels, onOpen])

  const submitCreate = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      await api.createChannel(cfg, name)
      setNewName('')
      setCreating(false)
      load()
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  return (
    <>
      <div className="navbar">
        <button className="btn icon-btn" onClick={() => setCreating((v) => !v)}>
          <Plus size={20} strokeWidth={1.8} />
        </button>
        <span className="title">頻道</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {isGuest ? (
            <button className="btn icon-btn" onClick={() => setShowLogin(v => !v)} title="登入">
              <LogIn size={18} strokeWidth={1.8} />
            </button>
          ) : (
            <button className="btn icon-btn" style={{ padding: 0 }} onClick={onOpenSettings} title="設定">
              <Avatar user={user} />
            </button>
          )}
        </div>
      </div>
      {showLogin && isGuest && (
        <div className="login-dropdown">
          <LoginForm baseURL={cfg.baseURL} onAuthed={(tok, u, mail) => {
            onAuthed(tok, u, mail)
            setShowLogin(false)
          }} />
        </div>
      )}
      {creating && (
        <div className="new-channel-composer">
          <input
            autoFocus
            value={newName}
            placeholder="新頻道名稱…"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (isSubmitEnter(e)) submitCreate()
              if (e.key === 'Escape') {
                setCreating(false)
                setNewName('')
              }
            }}
          />
          <button className="btn-primary" onClick={submitCreate} disabled={!newName.trim()}>
            建立
          </button>
        </div>
      )}
      <div className="screen-body">
        <ErrorBanner msg={err} />
        {channels.length === 0 && !err ? (
          <div className="empty">
            {loading ? '載入中…' : '沒有頻道。按右上 ＋ 建立一個。'}
          </div>
        ) : (
          <ul className="list">
            {channels.map((c) => (
              <li key={c.id} className="row" onClick={() => onOpen(c)}>
                <Avatar user={{ name: c.name, avatarColor: 'var(--color-accent)' }} />
                <div className="grow">
                  <div className="name">
                    {c.name}
                    {c.ownerID === user.id && (
                      <span className="cat" style={{ marginLeft: 6 }}>我的</span>
                    )}
                  </div>
                  <div className="sub">
                    {c.lastMessagePreview ?? '尚無訊息'} · {c.memberCount} 人
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

// ---- 公開分享頁（/public/{token}，無需登入） ----

function PublicViewScreen({ token }: { token: string }) {
  const [data, setData] = useState<{ channelID: string; channelName: string; editable: boolean; entries: Entry[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const todayRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement)
  const bodyRef = useRef<HTMLDivElement>(null)

  const resolvedBase = (() => {
    const saved = localStorage.getItem('shuttle.baseURL')
    if (saved && !saved.includes(window.location.host)) return saved
    return window.location.origin
  })()

  const reload = () =>
    api.fetchPublicView(resolvedBase, token).then(setData).catch((e) => setErr(errMsg(e)))

  useEffect(() => {
    api.fetchPublicView(resolvedBase, token)
      .then(setData)
      .catch((e) => setErr(errMsg(e)))
      .finally(() => setLoading(false))
  }, [resolvedBase, token])

  useEffect(() => {
    if (data?.channelName) document.title = data.channelName
    return () => { document.title = 'Shuttle · 後端測試台' }
  }, [data?.channelName])

  useEffect(() => {
    if (data && todayRef.current && bodyRef.current) {
      bodyRef.current.scrollTo({ top: todayRef.current.offsetTop - 60, behavior: 'instant' })
    }
  }, [data])

  const send = async () => {
    if (!draft.trim() || sending) return
    setSending(true)
    try {
      await api.publicAssist(resolvedBase, token, draft.trim())
      setDraft('')
      await reload()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <div className="navbar">
        <span style={{ width: 36 }} />
        <span className="title">{data?.channelName ?? '行程'}</span>
        <span style={{ width: 36 }} />
      </div>
      <div className="screen-body" ref={bodyRef}>
        {loading && <div className="empty">載入中…</div>}
        {err && <div className="banner"><AlertCircle size={14} strokeWidth={2} style={{ verticalAlign: 'middle', marginRight: 6 }} />{err}</div>}
        {data && (
          data.entries.length === 0
            ? <div className="empty">此頻道尚無行程。</div>
            : <MultiTrackTimeline entries={data.entries} todayRef={todayRef} />
        )}
      </div>
      {data?.editable && (
        <div className="composer">
          <div className="composer-row">
          <input
            placeholder="新增行程…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
            disabled={sending}
          />
          <button onClick={send} disabled={sending || !draft.trim()}>
            <Send size={16} strokeWidth={2} />
          </button>
          </div>
        </div>
      )}
    </>
  )
}

// ---- 設定頁(連線設定 + 測試 health) ----

function SettingsScreen({
  cfg,
  baseURL,
  setBaseURL,
  user,
  email,
  isGuest,
  onAuthed,
  onLogout,
  onBack,
}: {
  cfg: ClientConfig
  baseURL: string
  setBaseURL: (s: string) => void
  user: User
  email: string
  isGuest: boolean
  onAuthed: (token: string, user: User, email: string) => void
  onLogout: () => void
  onBack?: () => void
}) {
  const [health, setHealth] = useState<string>('未測試')

  const ping = async () => {
    setHealth('測試中…')
    try {
      const r = await api.health(cfg)
      setHealth(`✅ ${r.status}`)
    } catch (e) {
      setHealth(`❌ ${errMsg(e)}`)
    }
  }

  return (
    <>
      <div className="navbar">
        {onBack ? (
          <button className="btn icon-btn" onClick={onBack}>
            <ChevronLeft size={20} strokeWidth={1.8} />
          </button>
        ) : (
          <span style={{ width: 36 }} />
        )}
        <span className="title">設定</span>
        <span style={{ width: 36 }} />
      </div>
      <div className="screen-body">
        {isGuest ? (
          <>
            <div className="section-title">目前身分</div>
            <div className="row">
              <Avatar user={user} />
              <div className="grow">
                <div className="name">訪客</div>
                <div className="sub">登入後發送的訊息會以你的身分顯示</div>
              </div>
            </div>
            <LoginForm baseURL={baseURL} onAuthed={onAuthed} />
          </>
        ) : (
          <>
            <div className="section-title">目前登入</div>
            <div className="row">
              <Avatar user={user} />
              <div className="grow">
                <div className="name">{user.name}</div>
                <div className="sub">{email || user.id}</div>
              </div>
            </div>
            <div className="row" onClick={onLogout}>
              <div className="grow">
                <div className="name" style={{ color: 'var(--ios-red)' }}>登出</div>
              </div>
              <ChevronLeft size={16} strokeWidth={1.5} color="#c7c7cc" style={{ transform: 'rotate(180deg)' }} />
            </div>
            <div className="section-title">API Token (CLI 用)</div>
            <TokenDisplay token={cfg.token} />
          </>
        )}
        <div className="section-title">後端連線</div>
        <div className="field">
          <label>Base URL</label>
          <input
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder="http://localhost:8080"
          />
        </div>
        <div className="section-title">健康檢查</div>
        <div className="row" onClick={ping}>
          <div className="grow">
            <div className="name">GET /health</div>
            <div className="sub">{health}</div>
          </div>
          <ChevronLeft size={16} strokeWidth={1.5} color="#c7c7cc" style={{ transform: 'rotate(180deg)' }} />
        </div>
        <div className="section-title">說明</div>
        <div className="field" style={{ color: 'var(--ios-gray)', fontSize: 13 }}>
          開發用後端測試台。登入身分存於 sessionStorage(分頁獨立),
          不同分頁可登入不同使用者。右側 debug panel 記錄每次 API 交易。
        </div>
      </div>
    </>
  )
}

// ---- 登入表單(內嵌於設定頁,訪客可登入 / 註冊) ----

function LoginForm({
  baseURL,
  onAuthed,
}: {
  baseURL: string
  onAuthed: (token: string, user: User, email: string) => void
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const cfg: ClientConfig = { baseURL, token: null }

  const submit = async () => {
    setErr(null)
    setBusy(true)
    try {
      const res =
        mode === 'login'
          ? await api.login(cfg, email.trim(), password)
          : await api.register(cfg, email.trim(), password, name.trim())
      onAuthed(res.token, res.user, res.profile.email)
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="section-title">{mode === 'login' ? '登入' : '註冊'}</div>
      <div className="field">
        <label>Email</label>
        <input
          value={email}
          type="email"
          autoComplete="email"
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <div className="field">
        <label>密碼</label>
        <input
          type="password"
          value={password}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => isSubmitEnter(e) && submit()}
          placeholder="至少 6 字元"
        />
      </div>
      {mode === 'register' && (
        <div className="field">
          <label>顯示名稱(可選)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="留空則用 email"
          />
        </div>
      )}
      <ErrorBanner msg={err} />
      <div className="login-form-actions">
        <button
          className="btn-primary"
          onClick={submit}
          disabled={busy || !email.trim() || !password}
        >
          {busy ? '處理中…' : mode === 'login' ? '登入' : '註冊並登入'}
        </button>
        <div className="login-form-switch">
          <span style={{ color: 'var(--ios-gray)' }}>
            {mode === 'login' ? '還沒有帳號?' : '已有帳號?'}
          </span>{' '}
          <span
            style={{ color: 'var(--color-accent)', cursor: 'pointer' }}
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login')
              setErr(null)
            }}
          >
            {mode === 'login' ? '註冊' : '登入'}
          </span>
        </div>
      </div>
      <div
        className="field"
        style={{ color: 'var(--ios-gray)', fontSize: 13 }}
      >
        開發測試:可用 seed 帳號 alice@channel.dev / password
        (另有 bob、carol、dave)。或註冊新帳號。
      </div>
    </>
  )
}


function TokenDisplay({ token }: { token: string | null }) {
  const [copied, setCopied] = useState(false)

  const copyToken = () => {
    if (token) {
      navigator.clipboard.writeText(token).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  if (!token) return null

  const displayToken = token.substring(0, 20) + '...' + token.substring(token.length - 10)

  return (
    <>
      <div className="token-box">{displayToken}</div>
      <div style={{ padding: '0 16px 12px' }}>
        <button className={`btn-secondary${copied ? ' success' : ''}`} onClick={copyToken}>
          {copied ? '✅ 已複製' : '複製 Token'}
        </button>
      </div>
    </>
  )
}
