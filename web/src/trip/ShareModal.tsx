import { useEffect, useState } from 'react'
import { ChevronLeft, Copy, Check, Trash2 } from 'lucide-react'
import QRCode from 'qrcode'
import type { ClientConfig, PublicLinkViewMode } from '../api'
import * as api from '../api'
import type { Trip } from '../types'
import { ErrorBanner, errMsg } from '../AppCommon'
import styles from './ShareModal.module.css'

// ---- 分享彈窗 ----

export function ShareModal({
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
      <div className="navbar">
        <button className="btn icon-btn" onClick={onClose}>
          <ChevronLeft size={20} strokeWidth={1.8} />
        </button>
        <span className="title">分享行程</span>
        <span style={{ width: 36 }} />
      </div>
      <div className="screen-body">
        <ErrorBanner msg={err} />
        <div className="section-title">公開連結</div>
        <div className="field" style={{ color: 'var(--ios-gray)', fontSize: 13 }}>
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
            <div style={{ padding: '8px 16px 0' }}>
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
                <div style={{ padding: '12px 16px 0' }}>
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
            <div className="empty" style={{ padding: '24px 16px', textAlign: 'left' }}>
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
                <div style={{ padding: '8px 16px 0' }}>
                  <button className="btn-primary" onClick={generate}>
                    建立公開連結
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
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
