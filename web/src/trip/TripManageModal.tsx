import { useCallback, useEffect, useState } from 'react'
import { X, Copy, Check, Trash2 } from 'lucide-react'
import QRCode from 'qrcode'
import type { ClientConfig, PublicLinkViewMode } from '../api'
import * as api from '../api'
import type { Trip } from './types'
import type { TripRole, Member } from '../user/types'
import { Avatar, ErrorBanner, errMsg, isSubmitEnter, LS_DEFAULT_TRIP } from '../AppCommon'
import styles from './TripManageModal.module.css'

// TripManageModal:行程管理彈窗,合併原本分開的 ShareModal(分享連結)與
// MembersScreen(成員管理),再加上原本掛在 ChatScreen navbar 的 TripMenu
// (開啟時自動進入)——三者都是「對某一個行程的管理操作」,合併成單一
// 入口(行程列表每筆項目的「管理」按鈕,見 DesktopTripList.tsx 的
// onManage),取代原本三個分散的觸發點。
//
// 用 .rp-modal-head/.rp-modal-body 骨架(而非原本 ShareModal/MembersScreen
// 各自帶的 .navbar/.screen-body)——這個彈窗是疊在 DesktopLayout.tsx 的
// .rp-modal 置中卡片裡渲染,.navbar/.screen-body 是給獨立全螢幕頁面設計的
// 高度公式,套進置中卡片裡跟同樣用 .rp-modal 骨架的 SettingsDialog 間距
// 對不齊(這是實際發生過的視覺不一致,不是預防性寫法)。
export function TripManageModal({
  cfg,
  trip,
  isOwner,
  onClose,
}: {
  cfg: ClientConfig
  trip: Trip
  isOwner: boolean
  onClose: () => void
}) {
  return (
    <>
      <div className="rp-modal-head">
        <span className="rp-modal-title">行程設定 · {trip.name}</span>
        <button className="btn icon-btn" onClick={onClose} title="關閉">
          <X size={18} strokeWidth={1.8} />
        </button>
      </div>
      <div className="rp-modal-body">
        <DefaultTripSection tripID={trip.id} />
        <div className={styles.sectionGap}>
          <ShareSection cfg={cfg} trip={trip} isOwner={isOwner} />
        </div>
        <div className={styles.sectionGap}>
          <MembersSection cfg={cfg} trip={trip} isOwner={isOwner} />
        </div>
      </div>
    </>
  )
}

// ---- 開啟時自動進入 ----
// 原 TripMenu.tsx 的 setAsDefault/clearDefault 邏輯搬移過來,改用跟分享
// 區塊一致的 .toggle 開關樣式(原本是下拉選單裡的兩顆文字按鈕,合併彈窗
// 情境下不需要再包一層選單,直接是彈窗裡的一個設定項)。
function DefaultTripSection({ tripID }: { tripID: string }) {
  const [isDefault, setIsDefault] = useState(() => localStorage.getItem(LS_DEFAULT_TRIP) === tripID)

  const toggle = (checked: boolean) => {
    if (checked) {
      localStorage.setItem(LS_DEFAULT_TRIP, tripID)
    } else {
      localStorage.removeItem(LS_DEFAULT_TRIP)
    }
    setIsDefault(checked)
  }

  return (
    <>
      <div className="section-title">開啟</div>
      <div className={styles.toggleRow}>
        <span className={styles.toggleLabel}>開啟時自動進入這個行程</span>
        <label className={styles.toggle}>
          <input type="checkbox" checked={isDefault} onChange={(e) => toggle(e.target.checked)} />
          <span className={styles.toggleSlider} />
        </label>
      </div>
    </>
  )
}

// ---- 分享連結(原 ShareModal.tsx 內容) ----
function ShareSection({
  cfg,
  trip,
  isOwner,
}: {
  cfg: ClientConfig
  trip: Trip
  isOwner: boolean
}) {
  const [token, setToken] = useState<string | null>(null)
  const [editable, setEditable] = useState(false)
  const [viewMode, setViewMode] = useState<PublicLinkViewMode>('timeline')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [qrDataURL, setQrDataURL] = useState<string | null>(null)

  const publicURL = token ? `${window.location.origin}/public/${token}` : null

  useEffect(() => {
    api.getPublicLink(cfg, trip.id)
      .then((r) => { setToken(r.linkToken); setEditable(r.editable); setViewMode(r.viewMode) })
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token, trip.id])

  useEffect(() => {
    if (!publicURL) { setQrDataURL(null); return }
    let cancelled = false
    QRCode.toDataURL(publicURL, { width: 240, margin: 1 })
      .then((url) => { if (!cancelled) setQrDataURL(url) })
      .catch(() => { if (!cancelled) setQrDataURL(null) })
    return () => { cancelled = true }
  }, [publicURL])

  const generate = async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await api.createPublicLink(cfg, trip.id, editable, viewMode)
      setToken(r.linkToken)
      setEditable(r.editable)
      setViewMode(r.viewMode)
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  const toggleEditable = async (val: boolean) => {
    setEditable(val)
    try {
      const r = await api.createPublicLink(cfg, trip.id, val, viewMode)
      setToken(r.linkToken)
      setEditable(r.editable)
      setViewMode(r.viewMode)
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  const changeViewMode = async (val: PublicLinkViewMode) => {
    setViewMode(val)
    // 尚未建立連結時只更新本地狀態，等使用者按「建立公開連結」再一起送出。
    if (!token) return
    try {
      const r = await api.createPublicLink(cfg, trip.id, editable, val)
      setToken(r.linkToken)
      setEditable(r.editable)
      setViewMode(r.viewMode)
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  const revoke = async () => {
    setLoading(true)
    setErr(null)
    try {
      await api.deletePublicLink(cfg, trip.id)
      setToken(null)
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  const copy = () => {
    if (!publicURL) return
    navigator.clipboard.writeText(publicURL).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <>
      <ErrorBanner msg={err} />
      <div className="section-title">公開連結</div>
      <div className={styles.hint}>
        任何人取得連結後即可查看此行程的內容（無需登入）。
      </div>
      {loading ? (
        <div className="empty">載入中…</div>
      ) : token ? (
        <>
          <div className={styles.linkBox}>
            <div className={styles.linkUrl}>{publicURL}</div>
            <button className={styles.linkCopy} onClick={copy} title="複製連結">
              {copied ? <Check size={16} strokeWidth={2} /> : <Copy size={16} strokeWidth={1.8} />}
            </button>
          </div>
          <div className={styles.actionRow}>
            <button className="btn-primary" onClick={copy}>
              {copied ? '✅ 已複製' : '複製連結'}
            </button>
          </div>
          {qrDataURL && (
            <>
              <div className="section-title">QR Code</div>
              <div className={styles.qrBox}>
                <img src={qrDataURL} alt="分享連結 QR Code" className={styles.qrImage} />
              </div>
            </>
          )}
          {isOwner && (
            <>
              <div className={styles.toggleRow}>
                <span className={styles.toggleLabel}>允許訪客新增行程</span>
                <label className={styles.toggle}>
                  <input type="checkbox" checked={editable} onChange={(e) => toggleEditable(e.target.checked)} />
                  <span className={styles.toggleSlider} />
                </label>
              </div>
              <ViewModePicker value={viewMode} onChange={changeViewMode} />
              <div className={styles.actionRow}>
                <button className="btn-danger" onClick={revoke}>
                  <Trash2 size={14} strokeWidth={1.8} style={{ marginRight: 6 }} />
                  撤銷連結
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className={styles.emptyLeft}>
            尚未建立公開連結。
          </div>
          {isOwner && (
            <>
              <div className={styles.toggleRow}>
                <span className={styles.toggleLabel}>允許訪客新增行程</span>
                <label className={styles.toggle}>
                  <input type="checkbox" checked={editable} onChange={(e) => setEditable(e.target.checked)} />
                  <span className={styles.toggleSlider} />
                </label>
              </div>
              <ViewModePicker value={viewMode} onChange={changeViewMode} />
              <div className={styles.actionRow}>
                <button className="btn-primary" onClick={generate}>
                  建立公開連結
                </button>
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}

// ViewModePicker:公開頁要用「時間軸」還是「配速表」呈現——只是切換公開頁
// 的呈現方式，跟上面「允許訪客新增行程」是完全獨立的兩個設定，不是同一顆
// 開關的兩個狀態，所以用兩個分段按鈕而非沿用 .toggle 那顆開關樣式。
// 配速表模式只有在行程內的地點本身帶有配速表專屬的 detail 結構（segment/
// order 等）時才有內容可顯示——這是額外用 CLI／entry-update 手動標註的
// 資料，不是分享彈窗這裡能自動產生的，選了配速表但行程沒有這類資料時，
// 公開頁會顯示提示訊息而非空白或錯誤（見 PhoneScreens.tsx PublicViewScreen）。
function ViewModePicker({
  value,
  onChange,
}: {
  value: PublicLinkViewMode
  onChange: (v: PublicLinkViewMode) => void
}) {
  return (
    <div className={styles.toggleRow}>
      <span className={styles.toggleLabel}>公開頁顯示</span>
      <div className={styles.viewModeGroup}>
        <button
          type="button"
          className={value === 'timeline' ? `${styles.viewModeBtn} ${styles.viewModeBtnActive}` : styles.viewModeBtn}
          onClick={() => onChange('timeline')}
        >
          時間軸
        </button>
        <button
          type="button"
          className={value === 'pace' ? `${styles.viewModeBtn} ${styles.viewModeBtnActive}` : styles.viewModeBtn}
          onClick={() => onChange('pace')}
        >
          路徑
        </button>
      </div>
    </div>
  )
}

// ---- 成員管理(原 MembersScreen.tsx 內容) ----
function MembersSection({
  cfg,
  trip,
  isOwner,
}: {
  cfg: ClientConfig
  trip: Trip
  isOwner: boolean
}) {
  const [members, setMembers] = useState<Member[]>([])
  const [email, setEmail] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    try {
      setMembers(await api.fetchMembers(cfg, trip.id))
    } catch (e) {
      setErr(errMsg(e))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token, trip.id])

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
      setMembers(await api.addMember(cfg, trip.id, e, 'viewer'))
      setEmail('')
    } catch (err) {
      setErr(errMsg(err))
    } finally {
      setAdding(false)
    }
  }

  // owner 切換成員權限(editor ↔ viewer)。owner 自己不可改。
  const toggleRole = async (m: Member) => {
    if (m.id === trip.ownerID) return
    const next: TripRole = m.role === 'editor' ? 'viewer' : 'editor'
    setErr(null)
    try {
      setMembers(await api.setMemberRole(cfg, trip.id, m.id, next))
    } catch (err) {
      setErr(errMsg(err))
    }
  }

  return (
    <>
      <ErrorBanner msg={err} />
      <div className="section-title">行程成員</div>
      <ul className="list">
        {members.map((m) => {
          const isTripOwner = m.id === trip.ownerID
          const roleLabel = isTripOwner ? '擁有者' : m.role === 'editor' ? '可修改' : '查詢'
          return (
            <li key={m.id} className="row">
              <Avatar user={m} />
              <div className="grow">
                <div className="name">{m.name}</div>
                <div className="sub">{m.id}</div>
              </div>
              {isOwner && !isTripOwner ? (
                <button className={`${styles.chip} ${styles[m.role]}`} onClick={() => toggleRole(m)} title="點擊切換 修改/查詢 權限">
                  {roleLabel}
                </button>
              ) : (
                <span className={`${styles.chip} ${styles[isTripOwner ? 'owner' : m.role]} ${styles.static}`}>
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
          type="email"
          autoComplete="email"
          placeholder="輸入對方的 Email 後按 Enter"
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => isSubmitEnter(e) && invite()}
        />
      </div>
      <div className={styles.actionRow}>
        <button className="btn-primary" onClick={invite} disabled={adding || !email.includes('@')}>
          {adding ? '邀請中…' : '邀請加入'}
        </button>
      </div>
    </>
  )
}
