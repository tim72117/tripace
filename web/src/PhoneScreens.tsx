import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Send, AlertCircle } from 'lucide-react'
import type { ClientConfig, PublicLinkViewMode } from './api'
import * as api from './api'
import type { Entry, User } from './types'
import { MultiTrackTimeline } from './Timeline'
import type { AssistLang } from './assistLang'
import { ASSIST_LANG_KEY, getAssistLang } from './assistLang'
import {
  BASE_URL,
  Avatar, errMsg, isSubmitEnter, LoginForm,
} from './AppCommon'
import { LangSelect, TokenDisplay } from './DesktopShared'
import paceStyles from './PublicPaceView.module.css'

// PhoneScreens:手機版整頁畫面,從 App.tsx 拆出來——PublicViewScreen(公開
// 分享頁)/SettingsScreen(設定頁)彼此不太耦合,但都只在手機版 PhoneContent
// 裡被用到,合併成一個檔案。(原本的 ChannelsScreen 頻道列表已改為
// PhoneNavDrawer.tsx 的行程列表分頁,不再是整頁元件。)

// ---- 配速表模式的檢查站資料形狀 ----
// 對應後端 Entry.detail 這個自訂 JSON 欄位裡,配速表專屬會用到的子集
// (完整定義/寫入端說明見 PaceChart.tsx 的 PublicEntry/PaceSegment)。
// Entry 型別本身(types.ts)沒有宣告 detail,是後端沒有固定 schema 的
// 欄位,故這裡跟 PaceChart.tsx 一樣用局部型別 + 執行期做防呆判斷,不
// 假設任何一筆地點一定有這個形狀。
interface PaceDetail {
  km: number | null
  isStart?: boolean
  isFinish?: boolean
  dwellMin?: number | null
  tag?: string
  departTime: string | null
  arriveTime: string | null
  order: number
  segment: string
}

function entryPaceDetail(e: Entry): PaceDetail | null {
  const d = (e as unknown as { detail?: unknown }).detail
  if (!d || typeof d !== 'object') return null
  const detail = d as Partial<PaceDetail>
  if (typeof detail.segment !== 'string' || typeof detail.order !== 'number') return null
  return detail as PaceDetail
}

// hasPaceData:分享彈窗選了「配速表」時,公開頁要判斷這個頻道的地點是否
// 真的帶有配速表用的 detail 結構——這是額外用 CLI/entry-update 手動標註
// 的資料,不是分享彈窗本身能自動產生的,沒有這類資料時要顯示提示訊息,
// 而不是渲染一個空清單假裝正常。
function hasPaceData(entries: Entry[]): boolean {
  return entries.some((e) => entryPaceDetail(e) !== null)
}

// PublicPaceList:配速表模式下的檢查站清單——依 detail.segment 分組、組內
// 依 detail.order 排序,呈現方式刻意精簡(不比照 PaceChart.tsx 那套固定
// 路線分頁/摘要版面,那份版面綁定「花東193公路」demo 頻道寫死的路線標題
// 與里程,不適合套用在任意頻道上),只列出各檢查站的名稱/里程/時刻。
function PublicPaceList({ entries }: { entries: Entry[] }) {
  const bySegment = useMemo(() => {
    const groups = new Map<string, { entry: Entry; detail: PaceDetail }[]>()
    for (const e of entries) {
      const detail = entryPaceDetail(e)
      if (!detail) continue
      const list = groups.get(detail.segment) ?? []
      list.push({ entry: e, detail })
      groups.set(detail.segment, list)
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.detail.order - b.detail.order)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [entries])

  return (
    <div className={paceStyles.list}>
      {bySegment.map(([segment, items]) => (
        <div key={segment}>
          {items.map(({ entry, detail }) => {
            const time = detail.isFinish ? detail.arriveTime : (detail.departTime ?? detail.arriveTime)
            return (
              <div className={paceStyles.card} key={entry.id}>
                <div className={paceStyles.cardLeft}>
                  <div className={paceStyles.name}>{entry.title}</div>
                  <div className={paceStyles.meta}>
                    {detail.tag ? `${detail.tag} ・ ` : ''}
                    {detail.km !== null ? `${detail.km.toFixed(1)} km` : '—'}
                  </div>
                </div>
                <div className={paceStyles.time}>{time ?? '—'}</div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ---- 公開分享頁（/public/{token}，無需登入） ----

export function PublicViewScreen({ token }: { token: string }) {
  const [data, setData] = useState<{ channelID: string; channelName: string; editable: boolean; viewMode: PublicLinkViewMode; entries: Entry[] } | null>(null)
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
            : data.viewMode === 'pace'
              ? (
                hasPaceData(data.entries)
                  ? <PublicPaceList entries={data.entries} />
                  // 分享者選了「配速表」,但這個頻道的地點沒有配速表需要的
                  // detail 結構(那是額外用 CLI/entry-update 手動標註的資料,
                  // 分享彈窗本身不會自動產生)——顯示明確提示,不要求訪客
                  // 自己猜「怎麼是空的」,也不要靜默退回時間軸掩蓋掉分享者
                  // 原本的選擇。
                  : <div className="empty">此行程尚無配速表資料。</div>
              )
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
