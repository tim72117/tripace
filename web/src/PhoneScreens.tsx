import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Send, AlertCircle, Plus, LogIn } from 'lucide-react'
import type { ClientConfig } from './api'
import * as api from './api'
import type { Channel, Entry, User } from './types'
import { MultiTrackTimeline } from './Timeline'
import type { AssistLang } from './assistLang'
import { ASSIST_LANG_KEY, getAssistLang } from './assistLang'
import {
  BASE_URL, useChannelsState,
  Avatar, ErrorBanner, errMsg, isSubmitEnter, LoginForm,
} from './AppCommon'
import { LangSelect, TokenDisplay } from './DesktopShared'

// PhoneScreens:手機版整頁畫面,從 App.tsx 拆出來——ChannelsScreen(頻道列表)
// /PublicViewScreen(公開分享頁)/SettingsScreen(設定頁)彼此不太耦合,但都
// 只在手機版 PhoneContent(見 App.tsx)裡被用到,合併成一個檔案。

// ---- 頻道列表頁(手機版:整頁卡片列表) ----

export function ChannelsScreen({
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
  const {
    channels, err, loading,
    creating, setCreating,
    newName, setNewName,
    submitCreate,
  } = useChannelsState(cfg, onOpen)
  const [showLogin, setShowLogin] = useState(false)

  return (
    <>
      <div className="navbar">
        <button className="btn icon-btn" onClick={() => setCreating((v) => !v)}>
          <Plus size={20} strokeWidth={1.8} />
        </button>
        <span className="title">行程</span>
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
            placeholder="新行程名稱…"
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
            {loading ? '載入中…' : '沒有行程。按左上 ＋ 建立一個。'}
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

export function PublicViewScreen({ token }: { token: string }) {
  const [data, setData] = useState<{ channelID: string; channelName: string; editable: boolean; entries: Entry[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const todayRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement)
  const bodyRef = useRef<HTMLDivElement>(null)

  const resolvedBase = BASE_URL

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
    return () => { document.title = 'Tripace' }
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
            ? <div className="empty">此行程尚無內容。</div>
            : <MultiTrackTimeline entries={data.entries} todayRef={todayRef} />
        )}
      </div>
      {data?.editable && (
        <div className="public-composer">
          <div className="public-composer-row">
          <input
            placeholder="新增行程…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => isSubmitEnter(e) && !e.shiftKey && send()}
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

export function SettingsScreen({
  cfg,
  user,
  email,
  isGuest,
  onAuthed,
  onLogout,
  onBack,
}: {
  cfg: ClientConfig
  user: User
  email: string
  isGuest: boolean
  onAuthed: (token: string, user: User, email: string) => void
  onLogout: () => void
  onBack?: () => void
}) {
  const [health, setHealth] = useState<string>('未測試')
  const [assistLang, setAssistLang] = useState<AssistLang>(() => getAssistLang())

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
            <LoginForm baseURL={cfg.baseURL} onAuthed={onAuthed} />
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
          <label>Base URL(由 VITE_API_BASE 設定,不可於此修改)</label>
          <input value={cfg.baseURL} readOnly disabled />
        </div>
        <div className="section-title">LLM 回答語言</div>
        <div className="field">
          <label>助理回答(assist/語意查詢)使用的語言,不影響介面文字</label>
          <LangSelect
            value={assistLang}
            onChange={(v) => {
              setAssistLang(v)
              localStorage.setItem(ASSIST_LANG_KEY, v)
            }}
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
          登入身分存於 localStorage,跨分頁共用同一身分。
          右側 debug panel 記錄每次 API 交易。
        </div>
      </div>
    </>
  )
}
