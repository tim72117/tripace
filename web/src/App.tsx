import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiCall, ClientConfig } from './api'
import * as api from './api'
import { ApiError, onApiCall } from './api'
import type { Channel, Message, SearchAnswer, User } from './types'
import { DebugPanel } from './DebugPanel'

// baseURL 是連線設定,跨分頁共用 → localStorage。
const LS_BASE = 'channel.baseURL'
// token / user 是「登入身分」,改用 sessionStorage:每個分頁獨立,
// 讓不同分頁能登入不同使用者(也為 per-session 鋪路)。
const SS_TOKEN = 'channel.token'
const SS_USER = 'channel.user'

type Tab = 'channels' | 'members' | 'search' | 'settings'

export function App() {
  // ---- 連線設定(可在設定頁改,存 localStorage,跨分頁共用) ----
  const [baseURL, setBaseURL] = useState(
    () => localStorage.getItem(LS_BASE) ?? 'http://localhost:8080',
  )
  useEffect(() => localStorage.setItem(LS_BASE, baseURL), [baseURL])

  // ---- 登入身分(sessionStorage,分頁獨立) ----
  const [token, setToken] = useState<string | null>(
    () => sessionStorage.getItem(SS_TOKEN),
  )
  const [user, setUser] = useState<User | null>(() => {
    const raw = sessionStorage.getItem(SS_USER)
    return raw ? (JSON.parse(raw) as User) : null
  })

  // 登入成功:存 token + user 到 sessionStorage。
  const onAuthed = useCallback((tok: string, u: User) => {
    sessionStorage.setItem(SS_TOKEN, tok)
    sessionStorage.setItem(SS_USER, JSON.stringify(u))
    setToken(tok)
    setUser(u)
  }, [])

  const onLogout = useCallback(() => {
    sessionStorage.removeItem(SS_TOKEN)
    sessionStorage.removeItem(SS_USER)
    setToken(null)
    setUser(null)
  }, [])

  const cfg: ClientConfig = { baseURL, token }

  // ---- API 交易 log(debug panel 用) ----
  const [calls, setCalls] = useState<ApiCall[]>([])
  useEffect(() => onApiCall((c) => setCalls((prev) => [c, ...prev].slice(0, 100))), [])

  // ---- 導航狀態 ----
  const [tab, setTab] = useState<Tab>('channels')
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)

  // 未登入 → 顯示登入頁(連線設定 baseURL 仍可調,因登入需要連對後端)。
  const loggedIn = token != null && user != null

  return (
    <div className="workbench">
      <div className="phone">
        <div className="phone-screen">
          <div className="notch" />
          <StatusBar user={user} />
          {!loggedIn ? (
            <LoginScreen
              baseURL={baseURL}
              setBaseURL={setBaseURL}
              onAuthed={onAuthed}
            />
          ) : (
            <PhoneContent
              cfg={cfg}
              tab={tab}
              setTab={setTab}
              activeChannel={activeChannel}
              setActiveChannel={setActiveChannel}
              baseURL={baseURL}
              setBaseURL={setBaseURL}
              token={token}
              setToken={setToken}
              user={user}
              onLogout={onLogout}
            />
          )}
        </div>
      </div>
      <DebugPanel calls={calls} onClear={() => setCalls([])} />
    </div>
  )
}

function StatusBar({ user }: { user: User | null }) {
  return (
    <div className="statusbar">
      <span>9:41</span>
      <span>{user ? user.name : ''} 📶 🔋</span>
    </div>
  )
}

interface ContentProps {
  cfg: ClientConfig
  tab: Tab
  setTab: (t: Tab) => void
  activeChannel: Channel | null
  setActiveChannel: (c: Channel | null) => void
  baseURL: string
  setBaseURL: (s: string) => void
  token: string | null
  setToken: (t: string | null) => void
  user: User
  onLogout: () => void
}

function PhoneContent(props: ContentProps) {
  const { cfg, tab, setTab, activeChannel, setActiveChannel } = props

  // 若在 channels tab 且選了頻道 → 顯示聊天頁(有返回)。
  const inChat = tab === 'channels' && activeChannel

  return (
    <>
      {inChat ? (
        <ChatScreen
          cfg={cfg}
          channel={activeChannel}
          user={props.user}
          onBack={() => setActiveChannel(null)}
        />
      ) : (
        <>
          <TabScreen {...props} />
          <TabBar tab={tab} setTab={setTab} />
        </>
      )}
    </>
  )
}

function TabScreen(props: ContentProps) {
  switch (props.tab) {
    case 'channels':
      return (
        <ChannelsScreen
          cfg={props.cfg}
          user={props.user}
          onOpen={(c) => props.setActiveChannel(c)}
        />
      )
    case 'members':
      return <MembersScreen cfg={props.cfg} channel={props.activeChannel} />
    case 'search':
      return <SearchScreen cfg={props.cfg} channel={props.activeChannel} />
    case 'settings':
      return (
        <SettingsScreen
          cfg={props.cfg}
          baseURL={props.baseURL}
          setBaseURL={props.setBaseURL}
          user={props.user}
          onLogout={props.onLogout}
        />
      )
  }
}

function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: { key: Tab; ico: string; label: string }[] = [
    { key: 'channels', ico: '💬', label: '頻道' },
    { key: 'members', ico: '👥', label: '成員' },
    { key: 'search', ico: '🔍', label: '查詢' },
    { key: 'settings', ico: '⚙️', label: '設定' },
  ]
  return (
    <div className="tabbar">
      {tabs.map((t) => (
        <button
          key={t.key}
          className={`tab ${tab === t.key ? 'active' : ''}`}
          onClick={() => setTab(t.key)}
        >
          <span className="ico">{t.ico}</span>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ---- 共用小元件 ----

function Avatar({ user }: { user: { name: string; avatarColor: string } }) {
  return (
    <div className="avatar" style={{ background: user.avatarColor }}>
      {user.name.slice(0, 1)}
    </div>
  )
}

function ErrorBanner({ msg }: { msg: string | null }) {
  if (!msg) return null
  return <div className="banner">⚠️ {msg}</div>
}

// 統一把 API 錯誤轉成可顯示訊息。
function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return String(e)
}

// ---- 頻道列表頁 ----

function ChannelsScreen({
  cfg,
  user,
  onOpen,
}: {
  cfg: ClientConfig
  user: User
  onOpen: (c: Channel) => void
}) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // 建頻道用 inline 輸入列(不用瀏覽器原生 prompt,VSCode 內建瀏覽器也能用)。
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
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
        <button className="btn" onClick={load} disabled={loading}>
          ↻
        </button>
        <span className="title">頻道</span>
        <button
          className="btn"
          onClick={() => setCreating((v) => !v)}
        >
          {creating ? '✕' : '＋'}
        </button>
      </div>
      {creating && (
        <div className="composer">
          <input
            autoFocus
            value={newName}
            placeholder="新頻道名稱…"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCreate()
              if (e.key === 'Escape') {
                setCreating(false)
                setNewName('')
              }
            }}
          />
          <button onClick={submitCreate} disabled={!newName.trim()}>
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
                <Avatar user={{ name: c.name, avatarColor: '#007aff' }} />
                <div className="grow">
                  <div className="name">
                    {c.name}
                    {c.ownerID === user.id && (
                      <span className="cat" style={{ marginLeft: 6 }}>
                        我的
                      </span>
                    )}
                  </div>
                  <div className="sub">
                    {c.lastMessagePreview ?? '尚無訊息'} · {c.memberCount} 人
                  </div>
                </div>
                <span className="chev">›</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

// ---- 聊天頁 ----

function ChatScreen({
  cfg,
  channel,
  user,
  onBack,
}: {
  cfg: ClientConfig
  channel: Channel
  user: User
  onBack: () => void
}) {
  // 只有 owner 能發訊息;非 owner(普通成員)只能用查詢分頁。
  const isOwner = channel.ownerID === user.id
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      setMessages(await api.fetchMessages(cfg, channel.id))
    } catch (e) {
      setErr(errMsg(e))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token, channel.id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    bodyRef.current?.scrollTo(0, bodyRef.current.scrollHeight)
  }, [messages])

  const send = async () => {
    const text = draft.trim()
    if (!text) return
    setSending(true)
    setErr(null)
    setDraft('')
    try {
      const msg = await api.postMessage(cfg, channel.id, text)
      setMessages((prev) => [...prev, msg])
    } catch (e) {
      setErr(errMsg(e))
      setDraft(text) // 失敗時還回草稿
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <div className="navbar">
        <button className="btn" onClick={onBack}>
          ‹ 頻道
        </button>
        <span className="title">{channel.name}</span>
        <button className="btn" onClick={load}>
          ↻
        </button>
      </div>
      <div className="screen-body" ref={bodyRef}>
        <ErrorBanner msg={err} />
        <div className="chat-list">
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} meID={user.id} />
          ))}
          {messages.length === 0 && !err && (
            <div className="empty">
              {isOwner
                ? '尚無訊息,在下方輸入發送看看 LLM 怎麼標注。'
                : '你是這個頻道的成員。成員看不到歷史訊息,也不能發送;\n請到「查詢」分頁用自然語言詢問頻道內容。'}
            </div>
          )}
        </div>
      </div>
      {isOwner ? (
        <div className="composer">
          <input
            value={draft}
            placeholder="輸入訊息…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          <button onClick={send} disabled={sending || !draft.trim()}>
            {sending ? '…' : '送出'}
          </button>
        </div>
      ) : null}
    </>
  )
}

function MessageBubble({ msg, meID }: { msg: Message; meID: string }) {
  // 測試台:把 LLM 標注(category / tags / summary)直接攤在泡泡上,一眼看後端回了什麼。
  const mine = msg.authorID === meID
  return (
    <div className={`bubble ${mine ? 'mine' : ''}`}>
      {!mine && (
        <div className="sub" style={{ marginBottom: 2 }}>
          {msg.authorName}
        </div>
      )}
      <div className="text">{msg.text}</div>
      {(msg.category || msg.tags.length > 0) && (
        <div className="meta">
          {msg.category && <span className="cat">{msg.category}</span>}
          {msg.tags.map((t) => (
            <span key={t} className="tag">
              #{t}
            </span>
          ))}
        </div>
      )}
      {msg.summary && <div className="summary">摘要:{msg.summary}</div>}
    </div>
  )
}

// ---- 成員頁 ----

function MembersScreen({
  cfg,
  channel,
}: {
  cfg: ClientConfig
  channel: Channel | null
}) {
  const [members, setMembers] = useState<User[]>([])
  const [results, setResults] = useState<User[]>([])
  const [kw, setKw] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!channel) return
    setErr(null)
    try {
      setMembers(await api.fetchMembers(cfg, channel.id))
    } catch (e) {
      setErr(errMsg(e))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token, channel?.id])

  useEffect(() => {
    load()
  }, [load])

  const search = async () => {
    setErr(null)
    try {
      setResults(await api.searchUsers(cfg, kw.trim()))
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  const add = async (u: User) => {
    if (!channel) return
    try {
      setMembers(await api.addMember(cfg, channel.id, u))
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  return (
    <>
      <div className="navbar">
        <span className="btn" style={{ visibility: 'hidden' }}>
          ←
        </span>
        <span className="title">成員</span>
        <button className="btn" onClick={load} disabled={!channel}>
          ↻
        </button>
      </div>
      <div className="screen-body">
        {!channel ? (
          <div className="empty">請先在「頻道」頁選一個頻道。</div>
        ) : (
          <>
            <ErrorBanner msg={err} />
            <div className="section-title">頻道成員 · {channel.name}</div>
            <ul className="list">
              {members.map((u) => (
                <li key={u.id} className="row">
                  <Avatar user={u} />
                  <div className="grow">
                    <div className="name">{u.name}</div>
                    <div className="sub">{u.id}</div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="section-title">搜尋並邀請</div>
            <div className="field">
              <input
                value={kw}
                placeholder="輸入關鍵字後按 Enter"
                onChange={(e) => setKw(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && search()}
              />
            </div>
            <ul className="list">
              {results.map((u) => (
                <li key={u.id} className="row" onClick={() => add(u)}>
                  <Avatar user={u} />
                  <div className="grow">
                    <div className="name">{u.name}</div>
                    <div className="sub">點擊加入頻道</div>
                  </div>
                  <span className="chev">＋</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  )
}

// ---- 語意查詢頁 ----

function SearchScreen({
  cfg,
  channel,
}: {
  cfg: ClientConfig
  channel: Channel | null
}) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<SearchAnswer | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const ask = async () => {
    if (!channel || !question.trim()) return
    setLoading(true)
    setErr(null)
    setAnswer(null)
    try {
      setAnswer(await api.semanticQuery(cfg, channel.id, question.trim()))
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="navbar">
        <span className="btn" style={{ visibility: 'hidden' }}>
          ←
        </span>
        <span className="title">語意查詢</span>
        <span className="btn" style={{ visibility: 'hidden' }}>
          ←
        </span>
      </div>
      <div className="screen-body">
        {!channel ? (
          <div className="empty">請先在「頻道」頁選一個頻道。</div>
        ) : (
          <>
            <div className="section-title">對「{channel.name}」提問</div>
            <div className="field">
              <input
                value={question}
                placeholder="例:上週有討論到預算的決議嗎?"
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && ask()}
              />
            </div>
            <ErrorBanner msg={err} />
            {loading && <div className="empty">查詢中…</div>}
            {answer && (
              <div className="answer-card">
                <div className="ans">{answer.answer}</div>
                {answer.citedMessageIDs.length > 0 && (
                  <div className="cites">
                    引用:{answer.citedMessageIDs.join(', ')}
                    {answer.confidence != null &&
                      ` · 信心 ${(answer.confidence * 100).toFixed(0)}%`}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

// ---- 設定頁(連線設定 + 測試 health) ----

function SettingsScreen({
  cfg,
  baseURL,
  setBaseURL,
  user,
  onLogout,
}: {
  cfg: ClientConfig
  baseURL: string
  setBaseURL: (s: string) => void
  user: User
  onLogout: () => void
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
        <span className="btn" style={{ visibility: 'hidden' }}>
          ←
        </span>
        <span className="title">設定</span>
        <span className="btn" style={{ visibility: 'hidden' }}>
          ←
        </span>
      </div>
      <div className="screen-body">
        <div className="section-title">目前登入</div>
        <div className="row">
          <Avatar user={user} />
          <div className="grow">
            <div className="name">{user.name}</div>
            <div className="sub">{user.id}</div>
          </div>
        </div>
        <div className="row" onClick={onLogout}>
          <div className="grow">
            <div className="name" style={{ color: 'var(--ios-red)' }}>
              登出
            </div>
          </div>
          <span className="chev">›</span>
        </div>
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
          <span className="chev">測試 ›</span>
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

// ---- 登入頁(帳密登入 / 註冊) ----

function LoginScreen({
  baseURL,
  setBaseURL,
  onAuthed,
}: {
  baseURL: string
  setBaseURL: (s: string) => void
  onAuthed: (token: string, user: User) => void
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('alice@channel.dev')
  const [password, setPassword] = useState('password')
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
      onAuthed(res.token, res.user)
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="navbar">
        <span className="title">{mode === 'login' ? '登入' : '註冊'}</span>
      </div>
      <div className="screen-body">
        <div className="section-title">Channel 帳號</div>
        <div className="field">
          <label>Email</label>
          <input
            value={email}
            autoComplete="username"
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
            onKeyDown={(e) => e.key === 'Enter' && submit()}
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
        <div style={{ padding: 16 }}>
          <button
            onClick={submit}
            disabled={busy || !email.trim() || !password}
            style={{
              width: '100%',
              padding: 12,
              border: 'none',
              borderRadius: 12,
              background: busy ? '#b3d4ff' : 'var(--ios-blue)',
              color: '#fff',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            {busy ? '處理中…' : mode === 'login' ? '登入' : '註冊並登入'}
          </button>
          <div
            style={{ textAlign: 'center', marginTop: 14, fontSize: 14 }}
          >
            <span style={{ color: 'var(--ios-gray)' }}>
              {mode === 'login' ? '還沒有帳號?' : '已有帳號?'}
            </span>{' '}
            <span
              style={{ color: 'var(--ios-blue)', cursor: 'pointer' }}
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login')
                setErr(null)
              }}
            >
              {mode === 'login' ? '註冊' : '登入'}
            </span>
          </div>
        </div>
        <div className="section-title">後端連線</div>
        <div className="field">
          <label>Base URL</label>
          <input
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder="http://localhost:8080"
          />
        </div>
        <div
          className="field"
          style={{ color: 'var(--ios-gray)', fontSize: 13 }}
        >
          開發測試:可用 seed 帳號 alice@channel.dev / password
          (另有 bob、carol、dave)。或註冊新帳號。
        </div>
      </div>
    </>
  )
}
