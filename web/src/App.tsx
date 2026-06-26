import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import type { ApiCall, ClientConfig, PresentedEntry } from './api'
import * as api from './api'
import { ApiError, onApiCall } from './api'
import type { Channel, ChannelRole, Entry, Member, Message, Trip, User } from './types'
import { DebugPanel } from './DebugPanel'
import { listMessages, saveMessage } from './deviceDB'

// baseURL 是連線設定,跨分頁共用 → localStorage。
const LS_BASE = 'channel.baseURL'
// token / user 是「登入身分」,改用 sessionStorage:每個分頁獨立,
// 讓不同分頁能登入不同使用者(也為 per-session 鋪路)。
const SS_TOKEN = 'channel.token'
const SS_USER = 'channel.user'
const SS_EMAIL = 'channel.email'

type Tab = 'channels' | 'settings'

// 聊天訊息(後端 Message + 前端專用欄位)。
// presented:agent 用 present_entries 輸出、要在答案泡泡下用列表顯示的條目。
// pending:後端處理中的佔位泡泡,渲染海浪載入動畫(無文字),完成後就地替換。
type ChatMessage = Message & { presented?: PresentedEntry[]; pending?: boolean }

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
  // email 是私密資料(profile),只有自己看得到。
  const [email, setEmail] = useState<string>(
    () => sessionStorage.getItem(SS_EMAIL) ?? '',
  )

  // 登入成功:存 token + user + email(profile)到 sessionStorage。
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

  const cfg: ClientConfig = { baseURL, token }

  // ---- API 交易 log(debug panel 用) ----
  const [calls, setCalls] = useState<ApiCall[]>([])
  useEffect(() => onApiCall((c) => setCalls((prev) => [c, ...prev].slice(0, 100))), [])

  // ---- 導航狀態 ----
  const [tab, setTab] = useState<Tab>('channels')
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)

  // 對齊 iOS App:未登入也能用(訪客身分,後端視為 usr_me),設定頁才登入/登出。
  // 訪客 user 僅供顯示;cfg.token 為 null,後端據此當訪客。
  const effectiveUser = user ?? GUEST_USER

  return (
    <div className="workbench">
      <div className="phone">
        <div className="phone-screen">
          <div className="notch" />
          <StatusBar user={effectiveUser} />
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
            user={effectiveUser}
            email={email}
            isGuest={user == null}
            onAuthed={onAuthed}
            onLogout={onLogout}
          />
        </div>
      </div>
      <DebugPanel
        calls={calls}
        onClear={() => setCalls([])}
        cfg={cfg}
        channel={activeChannel}
      />
    </div>
  )
}

// 訪客身分(未登入),需與後端 guestUser 一致。
const GUEST_USER: User = { id: 'usr_me', name: '訪客', avatarColor: '#8e8e93' }

// 助手(assist 回答)的作者 ID,需與後端及 iOS ChatStore.assistantID 一致。
const ASSISTANT_ID = 'usr_assistant'

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
  email: string
  isGuest: boolean
  onAuthed: (token: string, user: User, email: string) => void
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
    case 'settings':
      return (
        <SettingsScreen
          cfg={props.cfg}
          baseURL={props.baseURL}
          setBaseURL={props.setBaseURL}
          user={props.user}
          email={props.email}
          isGuest={props.isGuest}
          onAuthed={props.onAuthed}
          onLogout={props.onLogout}
        />
      )
  }
}

function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: { key: Tab; ico: string; label: string }[] = [
    { key: 'channels', ico: '💬', label: '頻道' },
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

// Enter 送出,但略過輸入法(注音/中日韓)組字中的 Enter——
// 組字選字時的 Enter 是「確認選字」,不該觸發送出。
function isSubmitEnter(e: ReactKeyboardEvent): boolean {
  // isComposing:組字進行中。keyCode 229:IME 處理中的按鍵。
  return e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229
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
              if (isSubmitEnter(e)) submitCreate()
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
  // owner 輸入=發訊息;成員輸入=語意查詢(回答顯示在訊息流,對齊 iOS App)。
  const isOwner = channel.ownerID === user.id
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // Entry:LLM(record_entry 工具)從訊息解析出的條目,按 messageID 掛到對應訊息下方。
  const [entries, setEntries] = useState<Entry[]>([])
  // Trip:後端依時間自動歸組的行程;頻道上方以按鈕列呈現,點入列出組內 entries。
  const [trips, setTrips] = useState<Trip[]>([])
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null)
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // 成員管理在頻道內開啟(對齊 iOS App 的聊天頁右上角入口)。
  const [showMembers, setShowMembers] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  // 點選項目時顯示詳細資訊。
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      // 原話從「裝置端 DB」讀(與 server 隔離);entry/trip 從後端讀(僅 owner)。
      const [msgs, ents, trps] = await Promise.all([
        listMessages(channel.id),
        // Entry/Trip 只有 owner 看得到自己頻道的(成員聊天為空,無需載入)。
        isOwner ? api.fetchEntries(cfg, channel.id) : Promise.resolve([]),
        isOwner ? api.fetchTrips(cfg, channel.id) : Promise.resolve([]),
      ])
      // owner 視角:記事原話已歸 entry(顯示在上方卡片),訊息流不顯示原話泡泡,
      // 只保留本地查詢問答泡泡;member 視角才把自己裝置的原話灌進訊息流。對齊 iOS。
      setMessages(isOwner ? [] : msgs)
      setEntries(ents)
      setTrips(trps)
    } catch (e) {
      setErr(errMsg(e))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token, channel.id, isOwner])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    bodyRef.current?.scrollTo(0, bodyRef.current.scrollHeight)
  }, [messages])

  // 本地訊息(不寫入後端,純前端顯示用):查詢的提問/回答泡泡。
  const mkLocalMsg = (
    id: string,
    authorID: string,
    authorName: string,
    text: string,
  ): ChatMessage => ({
    id, channelID: channel.id, authorID, authorName, text,
    createdAt: new Date().toISOString(),
  })

  // owner 用:統一輸入送進 assist,LLM 自主判斷記錄事項或回答提問。
  const send = async () => {
    const text = draft.trim()
    if (!text) return
    setSending(true)
    setErr(null)
    setDraft('')
    // 立刻插入處理中佔位泡泡(海浪動畫);完成後就地替換、失敗則移除。
    const pendingID = `pending_${Date.now()}`
    const pending = mkLocalMsg(pendingID, ASSISTANT_ID, '', '')
    pending.pending = true
    setMessages((prev) => [...prev, pending])
    const drop = () => setMessages((prev) => prev.filter((m) => m.id !== pendingID))
    // record 時 agent 非同步寫 entry,記下送出前的數量當基準,輪詢到變多才算寫完。
    const baseCount = entries.length
    try {
      const res = await api.assist(cfg, channel.id, text)
      if (res.kind === 'recorded') {
        // 記錄了 → 把原話存進「裝置端 DB」(原話的權威來源,與 server 隔離)。
        // res.text 為原話;後端不存原話,僅回它供前端落地裝置 DB。
        await saveMessage({
          id: `msg_${Date.now()}`,
          channelID: channel.id,
          authorID: user.id,
          authorName: user.name,
          text: res.text,
          createdAt: new Date().toISOString(),
        }).catch(() => {})
        // 波浪持續到 entry 真的寫入並顯示後才停。
        // 輪詢 fetchEntries 直到筆數比送出前多(agent 寫好);逾時則放棄等待先停。
        const deadline = Date.now() + 20000 // 上限 20s,避免 agent 卡住時無限轉
        let shown = false
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1000))
          let next: Entry[]
          try {
            next = await api.fetchEntries(cfg, channel.id)
          } catch {
            continue // 暫時抓失敗就再試
          }
          if (next.length > baseCount) {
            setEntries(next) // entry 已顯示在最上方列表
            shown = true
            break
          }
        }
        if (!shown) {
          // 逾時沒等到新 entry:仍刷新一次列表(可能 agent 沒產生條目)。
          await api.fetchEntries(cfg, channel.id).then(setEntries).catch(() => {})
        }
        // 記錄了 → 原話已歸入上方 entry 卡,訊息流不保留這則原話泡泡(移除佔位)。
        // 對齊 iOS:記事原話存而不顯,內容由 entry 承載。
        drop()
      } else {
        // 回答了 → 佔位泡泡換成「提問 + 答案」兩個本地泡泡(不寫入頻道)。
        // 答案泡泡掛上 agent 用 present_entries 輸出的條目,前端用列表元件顯示。
        const ans = mkLocalMsg(`ans_${Date.now()}`, ASSISTANT_ID, '', res.answer)
        ans.presented = res.entries
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== pendingID),
          mkLocalMsg(`ask_${Date.now()}`, user.id, user.name, text),
          ans,
        ])
      }
    } catch (e) {
      drop()
      setErr(errMsg(e))
      setDraft(text) // 失敗時還回草稿
    } finally {
      setSending(false)
    }
  }

  // 成員用:自然語言查詢頻道。問答持久化進裝置端 DB(重開頻道仍在,後端不存)。
  const ask = async () => {
    const q = draft.trim()
    if (!q) return
    setSending(true)
    setErr(null)
    setDraft('')
    // 提問泡泡(持久化)+ 處理中佔位泡泡(海浪動畫,暫態)。
    const askMsg = mkLocalMsg(`ask_${Date.now()}`, user.id, user.name, q)
    const pendingID = `pending_${Date.now()}`
    const pending = mkLocalMsg(pendingID, ASSISTANT_ID, '', '')
    pending.pending = true
    setMessages((prev) => [...prev, askMsg, pending])
    // 提問存裝置 DB。
    void saveMessage(askMsg).catch(() => {})
    try {
      const a = await api.semanticQuery(cfg, channel.id, q)
      // 佔位泡泡就地換成答案,並把答案也存進裝置 DB。
      const ansMsg = mkLocalMsg(`ans_${Date.now()}`, ASSISTANT_ID, '助手', a.answer)
      void saveMessage(ansMsg).catch(() => {})
      setMessages((prev) =>
        prev.map((m) => (m.id === pendingID ? ansMsg : m)),
      )
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== pendingID))
      setErr(errMsg(e))
    } finally {
      setSending(false)
    }
  }

  // 頻道內的成員管理(對齊 iOS App:聊天頁 → 成員)。
  if (showMembers) {
    return (
      <MembersScreen
        cfg={cfg}
        channel={channel}
        isOwner={isOwner}
        onBack={() => setShowMembers(false)}
      />
    )
  }

  // 時間軸:依行程(粗線) + 條目(細線)排列。
  if (showTimeline) {
    return (
      <TimelineScreen trips={trips} entries={entries} onBack={() => setShowTimeline(false)} />
    )
  }

  // 點選項目時顯示詳細資訊。
  if (selectedEntry) {
    return (
      <EntryDetailModal
        entry={selectedEntry}
        onBack={() => setSelectedEntry(null)}
      />
    )
  }

  // 行程:點頻道上方的 Trip 按鈕 → 列出該行程的條目。
  if (activeTrip) {
    return (
      <TripEntriesScreen
        cfg={cfg}
        channel={channel}
        trip={activeTrip}
        onBack={() => setActiveTrip(null)}
      />
    )
  }

  return (
    <>
      <div className="navbar">
        <button className="btn" onClick={onBack}>
          ‹ 頻道
        </button>
        <span className="title">{channel.name}</span>
        {/* 時間軸只對 owner 有意義(entry 只有 owner 看得到);有 entry 才顯示 */}
        {entries.length > 0 && (
          <button
            className="btn"
            onClick={() => setShowTimeline(true)}
            title="時間軸"
          >
            🕐
          </button>
        )}
        <button className="btn" onClick={() => setShowMembers(true)} title="成員">
          👥
        </button>
      </div>
      {/* 行程按鈕列:後端歸組出的 Trip,點入列出組內條目 */}
      {trips.length > 0 && (
        <div className="trip-bar">
          {trips.map((t) => {
            const count = entries.filter((e) => e.tripID === t.id).length
            return (
              <button
                key={t.id}
                className="trip-chip"
                onClick={() => setActiveTrip(t)}
                title={`${t.start ?? ''}${t.end ? ` ~ ${t.end}` : ''}`}
              >
                🧳 {t.title}
                {count > 0 && <span className="trip-count">{count}</span>}
              </button>
            )
          })}
        </div>
      )}
      <div className="screen-body" ref={bodyRef}>
        <ErrorBanner msg={err} />
        {/* 以 entry 為主體:頻道的事件/條目列在最上方,點開可看關聯的來源訊息 */}
        {entries.length > 0 && (
          <div className="entry-list">
            <div className="entry-list-title">事件 / 條目</div>
            {entries.map((e) => (
              <div key={e.id} onClick={() => setSelectedEntry(e)} style={{ cursor: 'pointer' }}>
                <EntryCard entry={e} />
              </div>
            ))}
          </div>
        )}
        <div className="chat-list">
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} meID={user.id} />
          ))}
          {messages.length === 0 && !err && (
            <div className="empty">
              {isOwner
                ? '在下方輸入:記事(如「明天三點開會」)會存檔,提問(如「我哪天開會?」)會回答。'
                : '你是這個頻道的成員。在下方用自然語言查詢頻道內容,回答會顯示在這裡。'}
            </div>
          )}
        </div>
      </div>
      <div className="composer">
        <input
          value={draft}
          placeholder={isOwner ? '記事或提問…' : '用自然語言查詢這個頻道…'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => isSubmitEnter(e) && (isOwner ? send() : ask())}
        />
        <button
          onClick={isOwner ? send : ask}
          disabled={sending || !draft.trim()}
        >
          {sending ? '…' : isOwner ? '送出' : '查詢'}
        </button>
      </div>
    </>
  )
}

function MessageBubble({
  msg,
  meID,
}: {
  msg: ChatMessage
  meID: string
}) {
  // 新模型:message 只剩原話,LLM 標注已移至 entry(在上方事件列表顯示)。
  const mine = msg.authorID === meID
  // 只有助理「回答」訊息用 Markdown 渲染;使用者輸入/記事訊息維持純文字。
  const isAnswer = msg.authorID === ASSISTANT_ID
  return (
    <div className={`bubble-group ${mine ? 'mine' : ''}`}>
      <div className={`bubble ${mine ? 'mine' : ''} ${msg.pending ? 'pending' : ''}`}>
        {/* 助手回答泡泡不顯示作者名(不出現「助手」);對齊 iOS MessageRow */}
        {!mine && !isAnswer && msg.authorName && (
          <div className="sub" style={{ marginBottom: 2 }}>
            {msg.authorName}
          </div>
        )}
        {msg.pending ? (
          // 後端處理中:海浪載入動畫(色塊群組依序起伏)。
          <WaveLoader />
        ) : isAnswer ? (
          <div className="text markdown">
            <ReactMarkdown>{msg.text}</ReactMarkdown>
          </div>
        ) : (
          <div className="text">{msg.text}</div>
        )}
      </div>
      {/* agent 用 present_entries 輸出的條目,在答案泡泡下用列表顯示 */}
      {msg.presented?.map((e, i) => (
        <PresentedCard key={`p${i}`} entry={e} />
      ))}
    </div>
  )
}

// WaveLoader:後端處理中的海浪載入動畫。
// 多個色塊依序上下起伏(animation-delay 漸進),整體像海浪由左而右流動。
function WaveLoader() {
  const bars = 5
  return (
    <div className="wave" aria-label="處理中" role="status">
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className="wave-bar"
          style={{ animationDelay: `${i * 0.12}s` }}
        />
      ))}
    </div>
  )
}

// PresentedCard 顯示 present_entries 輸出的條目(查詢結果列表用)。
function PresentedCard({ entry }: { entry: PresentedEntry }) {
  const when = entry.start
    ? entry.allDay
      ? entry.start.slice(0, 10)
      : entry.start
    : '未指定時間'
  return (
    <div className="entry-card">
      <span className="entry-ico">📅</span>
      <div className="entry-body">
        <div className="entry-item">{entry.item}</div>
        <div className="entry-when">
          {when}
          {entry.end ? ` ~ ${entry.end}` : ''}
        </div>
      </div>
    </div>
  )
}

// EntryCard 顯示 record_entry 工具解析出的條目(事項 + 時間)。
function EntryCard({ entry }: { entry: Entry }) {
  const when = entry.start
    ? entry.allDay
      ? entry.start.slice(0, 10)
      : entry.start
    : '未指定時間'
  return (
    <div className="entry-card">
      <span className="entry-ico">📅</span>
      <div className="entry-body">
        <div className="entry-item">{entry.item}</div>
        <div className="entry-when">
          {when}
          {entry.end ? ` ~ ${entry.end}` : ''}
        </div>
        {/* 地點(可空);對齊 iOS,放在事項/時間之後、標注之前 */}
        {entry.location && (
          <div className="entry-loc">📍 {entry.location}</div>
        )}
        {/* LLM 標注(已移至 entry;後端目前先留空,有值才顯示) */}
        {/* 後端可能回 tags:null(標注未填),以 ?? [] 收斂避免讀 length/map 出錯 */}
        {(entry.category || (entry.tags ?? []).length > 0) && (
          <div className="meta">
            {entry.category && <span className="cat">{entry.category}</span>}
            {(entry.tags ?? []).map((t) => (
              <span key={t} className="tag">
                #{t}
              </span>
            ))}
          </div>
        )}
        {entry.summary && <div className="summary">摘要:{entry.summary}</div>}
      </div>
    </div>
  )
}

// ---- 時間軸頁 ----

// dayKey 取 entry 的日期部分(YYYY-MM-DD)作為分組鍵;無 start 歸「未指定時間」。
function dayKey(e: Entry): string {
  return e.start ? e.start.slice(0, 10) : '未指定時間'
}

// groupByDay 把已排序的 entries 依日期分組,保留原順序。
// 回傳 [{ day, entries }],每組一個時間軸節點(日期標題 + 當天事項)。
function groupByDay(entries: Entry[]): { day: string; items: Entry[] }[] {
  const groups: { day: string; items: Entry[] }[] = []
  for (const e of entries) {
    const day = dayKey(e)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push(e)
    else groups.push({ day, items: [e] })
  }
  return groups
}

// TimelineScreen 把行程(粗線主軸) + 條目(細線分支)排成垂直時間軸。
// trips 依時間排列,各 trip 下掛屬於它的 entries。
function TimelineScreen({
  trips,
  entries,
  onBack,
}: {
  trips: Trip[]
  entries: Entry[]
  onBack: () => void
}) {
  // 建立 tripID → entries 的對應(快速查詢某行程的條目)。
  const entriesByTrip = new Map<string | null, Entry[]>()
  for (const e of entries) {
    const tripID = e.tripID ?? null
    if (!entriesByTrip.has(tripID)) entriesByTrip.set(tripID, [])
    entriesByTrip.get(tripID)!.push(e)
  }

  // 有行程則按行程顯示;否則按日期分組(兼容舊數據)。
  const hasTrips = trips.length > 0

  return (
    <>
      <div className="navbar">
        <button className="btn" onClick={onBack}>
          ‹ 返回
        </button>
        <span className="title">時間軸</span>
        <span className="btn" style={{ visibility: 'hidden' }}>
          ‹
        </span>
      </div>
      <div className="screen-body">
        {entries.length === 0 ? (
          <div className="empty">還沒有條目。在頻道裡記事後,會在這裡依時間排列。</div>
        ) : hasTrips ? (
          <div className="timeline">
            {/* 粗線主軸: 行程 */}
            {trips.map((trip, i) => {
              const tripEntries = entriesByTrip.get(trip.id) ?? []
              return (
                <TimelineTripRow
                  key={trip.id}
                  trip={trip}
                  entries={tripEntries}
                  isFirst={i === 0}
                  isLast={i === trips.length - 1}
                />
              )
            })}
            {/* 沒歸到行程的條目(tripID=null) */}
            {entriesByTrip.has(null) && (
              <TimelineUntrippedRow entries={entriesByTrip.get(null)!} isLast={true} />
            )}
          </div>
        ) : (
          // 兼容無 Trip 的舊模式:按日期分組
          <div className="timeline">
            {groupByDay(entries).map((g, i) => (
              <TimelineRow
                key={g.day}
                day={g.day}
                items={g.items}
                isFirst={i === 0}
                isLast={i === groupByDay(entries).length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// TripEntriesScreen 列出某行程(Trip)底下的所有條目。
// 自帶 navbar 與本地 entries state(獨立載入,避免回流閃動);複用 EntryCard。
function TripEntriesScreen({
  cfg,
  channel,
  trip,
  onBack,
}: {
  cfg: ClientConfig
  channel: Channel
  trip: Trip
  onBack: () => void
}) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    setLoading(true)
    api
      .fetchTripEntries(cfg, channel.id, trip.id)
      .then((es) => {
        if (live) setEntries(es)
      })
      .catch((e) => {
        if (live) setErr(errMsg(e))
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token, channel.id, trip.id])

  const range =
    trip.start ? `${trip.start}${trip.end ? ` ~ ${trip.end}` : ''}` : ''

  return (
    <>
      <div className="navbar">
        <button className="btn" onClick={onBack}>
          ‹ 返回
        </button>
        <span className="title">🧳 {trip.title}</span>
        <span className="btn" style={{ visibility: 'hidden' }}>
          ‹
        </span>
      </div>
      <div className="screen-body">
        {range && <div className="entry-list-title">{range}</div>}
        <ErrorBanner msg={err} />
        {loading ? (
          <div className="empty">載入中…</div>
        ) : entries.length === 0 ? (
          <div className="empty">這個行程還沒有條目。</div>
        ) : (
          <div className="entry-list">
            {entries.map((e) => (
              <EntryCard key={e.id} entry={e} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// TimelineTripRow 是粗線行程軸:左側粗線跨 trip 時間段,右側行程名稱 + 其條目細線。
function TimelineTripRow({
  trip,
  entries,
  isFirst,
  isLast,
}: {
  trip: Trip
  entries: Entry[]
  isFirst: boolean
  isLast: boolean
}) {
  const range = trip.start ? `${trip.start}${trip.end ? ` ~ ${trip.end}` : ''}` : ''
  return (
    <div className="tl-trip-row">
      {/* 左側粗線軸 */}
      <div className="tl-rail">
        <div className={`tl-line tl-line-thick tl-line-top ${isFirst ? 'hidden' : ''}`} />
        <div className="tl-dot tl-dot-trip">🧳</div>
        <div className={`tl-line tl-line-thick tl-line-bot ${isLast && entries.length === 0 ? 'hidden' : ''}`} />
      </div>
      <div className="tl-group">
        {/* 行程標題與時間範圍 */}
        <div className="tl-trip-header">
          <div className="tl-trip-title">{trip.title}</div>
          {range && <div className="tl-trip-range">{range}</div>}
        </div>
        {/* 行程內的條目(細線分支) */}
        {entries.map((e, ei) => (
          <TimelineTripEntryRow
            key={e.id}
            entry={e}
            isLastEntry={ei === entries.length - 1}
            isLastTrip={isLast}
          />
        ))}
      </div>
    </div>
  )
}

// TimelineTripEntryRow 是細線條目:從粗線分出細線到具體條目。
function TimelineTripEntryRow({
  entry,
  isLastEntry,
  isLastTrip,
}: {
  entry: Entry
  isLastEntry: boolean
  isLastTrip: boolean
}) {
  const when = entry.start
    ? entry.allDay
      ? entry.start.slice(0, 10)
      : entry.start
    : '未指定時間'
  return (
    <div className="tl-entry-row">
      {/* 細線:從粗軸分出 */}
      <div className="tl-rail">
        <div className={`tl-line tl-line-fine tl-line-top ${isLastEntry && isLastTrip ? 'hidden' : ''}`} />
        <div className="tl-dot tl-dot-entry" />
        <div className={`tl-line tl-line-fine tl-line-bot hidden`} />
      </div>
      <div className="tl-item-card">
        <div className="tl-item">{entry.item}</div>
        {entry.location && <div className="entry-loc">📍 {entry.location}</div>}
        <div className="tl-time-label">{when}</div>
        {(entry.category || (entry.tags ?? []).length > 0) && (
          <div className="meta">
            {entry.category && <span className="cat">{entry.category}</span>}
            {(entry.tags ?? []).map((t) => (
              <span key={t} className="tag">
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// TimelineUntrippedRow 顯示未歸屬於任何 Trip 的條目。
function TimelineUntrippedRow({
  entries,
  isLast,
}: {
  entries: Entry[]
  isLast: boolean
}) {
  return (
    <div className="tl-untripped-row">
      {entries.map((e) => (
        <div key={e.id} className="tl-card">
          <div className="tl-item">{e.item}</div>
          {e.location && <div className="entry-loc">📍 {e.location}</div>}
          {(e.category || (e.tags ?? []).length > 0) && (
            <div className="meta">
              {e.category && <span className="cat">{e.category}</span>}
              {(e.tags ?? []).map((t) => (
                <span key={t} className="tag">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// TimelineRow 是時間軸的一節:左側軸線 + 圓點,右側「日期標題 + 當天所有事項」。
// 圓點對齊日期那一行;當天多筆事項依序列在日期下方。
function TimelineRow({
  day,
  items,
  isFirst,
  isLast,
}: {
  day: string
  items: Entry[]
  isFirst: boolean
  isLast: boolean
}) {
  // 非全日事件取時刻(start 的 HH:MM 部分)顯示在事項旁;全日/無時間則不顯示。
  const timeOf = (e: Entry): string => {
    if (e.allDay || !e.start || e.start.length <= 10) return ''
    return e.start.slice(11) // 'YYYY-MM-DD HH:MM' → 'HH:MM'
  }
  return (
    <div className="tl-row">
      {/* 左側軸線:首節不畫上半、末節不畫下半,讓軸線頭尾收齊 */}
      <div className="tl-rail">
        <div className={`tl-line tl-line-top ${isFirst ? 'hidden' : ''}`} />
        <div className="tl-dot" />
        <div className={`tl-line tl-line-bot ${isLast ? 'hidden' : ''}`} />
      </div>
      <div className="tl-group">
        {/* 日期標題(對齊軸點) */}
        <div className="tl-day">{day}</div>
        {/* 當天的每一筆事項 */}
        {items.map((e) => (
          <div key={e.id} className="tl-card">
            <div className="tl-item">
              {timeOf(e) && <span className="tl-time">{timeOf(e)}</span>}
              {e.item}
            </div>
            {e.location && <div className="entry-loc">📍 {e.location}</div>}
            {(e.category || (e.tags ?? []).length > 0) && (
              <div className="meta">
                {e.category && <span className="cat">{e.category}</span>}
                {(e.tags ?? []).map((t) => (
                  <span key={t} className="tag">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- 成員頁 ----

function MembersScreen({
  cfg,
  channel,
  isOwner,
  onBack,
}: {
  cfg: ClientConfig
  channel: Channel
  isOwner: boolean
  onBack: () => void
}) {
  const [members, setMembers] = useState<Member[]>([])
  const [email, setEmail] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    try {
      setMembers(await api.fetchMembers(cfg, channel.id))
    } catch (e) {
      setErr(errMsg(e))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token, channel.id])

  useEffect(() => {
    load()
  }, [load])

  // 以 email 邀請(對齊 iOS App);新成員預設 viewer(查詢權限)。
  const invite = async () => {
    const e = email.trim().toLowerCase()
    if (!e.includes('@')) return
    setAdding(true)
    setErr(null)
    try {
      setMembers(await api.addMember(cfg, channel.id, e, 'viewer'))
      setEmail('')
    } catch (err) {
      setErr(errMsg(err))
    } finally {
      setAdding(false)
    }
  }

  // owner 切換成員權限(editor ↔ viewer)。owner 自己不可改。
  const toggleRole = async (m: Member) => {
    if (m.id === channel.ownerID) return
    const next: ChannelRole = m.role === 'editor' ? 'viewer' : 'editor'
    setErr(null)
    try {
      setMembers(await api.setMemberRole(cfg, channel.id, m.id, next))
    } catch (err) {
      setErr(errMsg(err))
    }
  }

  return (
    <>
      <div className="navbar">
        <button className="btn" onClick={onBack}>
          ‹ 返回
        </button>
        <span className="title">成員</span>
        <button className="btn" onClick={load}>
          ↻
        </button>
      </div>
      <div className="screen-body">
        <>
          <ErrorBanner msg={err} />
          <div className="section-title">頻道成員 · {channel.name}</div>
            <ul className="list">
              {members.map((m) => {
                const isChannelOwner = m.id === channel.ownerID
                const roleLabel = isChannelOwner
                  ? '擁有者'
                  : m.role === 'editor'
                    ? '可修改'
                    : '查詢'
                return (
                  <li key={m.id} className="row">
                    <Avatar user={m} />
                    <div className="grow">
                      <div className="name">{m.name}</div>
                      <div className="sub">{m.id}</div>
                    </div>
                    {/* owner 可切換非 owner 成員的權限;其餘只顯示角色標籤 */}
                    {isOwner && !isChannelOwner ? (
                      <button
                        className={`role-chip ${m.role}`}
                        onClick={() => toggleRole(m)}
                        title="點擊切換 修改/查詢 權限"
                      >
                        {roleLabel}
                      </button>
                    ) : (
                      <span className={`role-chip ${isChannelOwner ? 'owner' : m.role} static`}>
                        {roleLabel}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
            <div className="section-title">以 Email 邀請</div>
            <div className="field">
              <input
                value={email}
                placeholder="輸入對方的 Email 後按 Enter"
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => isSubmitEnter(e) && invite()}
              />
            </div>
            <div style={{ padding: '0 16px' }}>
              <button
                onClick={invite}
                disabled={adding || !email.includes('@')}
                style={{
                  width: '100%',
                  padding: 10,
                  border: 'none',
                  borderRadius: 10,
                  background:
                    adding || !email.includes('@') ? '#b3d4ff' : 'var(--ios-blue)',
                  color: '#fff',
                  fontSize: 15,
                  cursor: 'pointer',
                }}
              >
                {adding ? '邀請中…' : '邀請加入'}
              </button>
            </div>
        </>
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
  email,
  isGuest,
  onAuthed,
  onLogout,
}: {
  cfg: ClientConfig
  baseURL: string
  setBaseURL: (s: string) => void
  user: User
  email: string
  isGuest: boolean
  onAuthed: (token: string, user: User, email: string) => void
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
                <div className="name" style={{ color: 'var(--ios-red)' }}>
                  登出
                </div>
              </div>
              <span className="chev">›</span>
            </div>
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

// ---- 登入表單(內嵌於設定頁,訪客可登入 / 註冊) ----

function LoginForm({
  baseURL,
  onAuthed,
}: {
  baseURL: string
  onAuthed: (token: string, user: User, email: string) => void
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
        <div style={{ textAlign: 'center', marginTop: 14, fontSize: 14 }}>
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

// 項目詳細資訊彈窗。
function EntryDetailModal({
  entry,
  onBack,
}: {
  entry: Entry
  onBack: () => void
}) {
  const when = entry.start
    ? entry.allDay
      ? entry.start.slice(0, 10)
      : entry.start
    : '未指定時間'

  return (
    <>
      <div className="navbar">
        <button className="btn" onClick={onBack}>
          ‹ 返回
        </button>
        <span className="title">項目詳情</span>
        <span className="btn" style={{ visibility: 'hidden' }} />
      </div>
      <div className="screen-body" style={{ padding: '16px' }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: 'var(--ios-gray)', marginBottom: 4 }}>
            名稱
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
            {entry.item}
          </div>

          {entry.location && (
            <>
              <div style={{ fontSize: 12, color: 'var(--ios-gray)', marginBottom: 4 }}>
                地點
              </div>
              <div style={{ fontSize: 16, marginBottom: 16 }}>
                📍 {entry.location}
              </div>
            </>
          )}

          <div style={{ fontSize: 12, color: 'var(--ios-gray)', marginBottom: 4 }}>
            時間
          </div>
          <div style={{ fontSize: 16, marginBottom: 16 }}>
            🕐 {when}
            {entry.end ? ` ~ ${entry.end}` : ''}
          </div>

          {entry.summary && (
            <>
              <div style={{ fontSize: 12, color: 'var(--ios-gray)', marginBottom: 4 }}>
                摘要
              </div>
              <div style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>
                {entry.summary}
              </div>
            </>
          )}

          {(entry.category || (entry.tags && entry.tags.length > 0)) && (
            <>
              <div style={{ fontSize: 12, color: 'var(--ios-gray)', marginBottom: 4 }}>
                標籤
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {entry.category && (
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '4px 10px',
                      background: '#e8f0ff',
                      color: '#007aff',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    {entry.category}
                  </span>
                )}
                {entry.tags?.map((t) => (
                  <span
                    key={t}
                    style={{
                      display: 'inline-block',
                      padding: '4px 10px',
                      background: '#f2f2f7',
                      color: '#666',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  >
                    #{t}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
