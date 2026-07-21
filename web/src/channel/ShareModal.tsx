import { useEffect, useState } from 'react'
import { ChevronLeft, Copy, Check, Trash2 } from 'lucide-react'
import type { ClientConfig } from '../api'
import * as api from '../api'
import type { Channel } from '../types'
import { ErrorBanner, errMsg } from '../App'

// ---- 分享彈窗 ----

export function ShareModal({
  cfg,
  channel,
  isOwner,
  onClose,
}: {
  cfg: ClientConfig
  channel: Channel
  isOwner: boolean
  onClose: () => void
}) {
  const [token, setToken] = useState<string | null>(null)
  const [editable, setEditable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const publicURL = token ? `${window.location.origin}/public/${token}` : null

  useEffect(() => {
    api.getPublicLink(cfg, channel.id)
      .then((r) => { setToken(r.linkToken); setEditable(r.editable) })
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token, channel.id])

  const generate = async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await api.createPublicLink(cfg, channel.id, editable)
      setToken(r.linkToken)
      setEditable(r.editable)
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  const toggleEditable = async (val: boolean) => {
    setEditable(val)
    try {
      const r = await api.createPublicLink(cfg, channel.id, val)
      setToken(r.linkToken)
      setEditable(r.editable)
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  const revoke = async () => {
    setLoading(true)
    setErr(null)
    try {
      await api.deletePublicLink(cfg, channel.id)
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
            <div className="share-link-box">
              <div className="share-link-url">{publicURL}</div>
              <button className="share-link-copy" onClick={copy} title="複製連結">
                {copied ? <Check size={16} strokeWidth={2} /> : <Copy size={16} strokeWidth={1.8} />}
              </button>
            </div>
            <div style={{ padding: '8px 16px 0' }}>
              <button className="btn-primary" onClick={copy}>
                {copied ? '✅ 已複製' : '複製連結'}
              </button>
            </div>
            {isOwner && (
              <>
                <div className="share-toggle-row">
                  <span className="share-toggle-label">允許訪客新增行程</span>
                  <label className="ios-toggle">
                    <input type="checkbox" checked={editable} onChange={(e) => toggleEditable(e.target.checked)} />
                    <span className="ios-toggle-slider" />
                  </label>
                </div>
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
                <div className="share-toggle-row">
                  <span className="share-toggle-label">允許訪客新增行程</span>
                  <label className="ios-toggle">
                    <input type="checkbox" checked={editable} onChange={(e) => setEditable(e.target.checked)} />
                    <span className="ios-toggle-slider" />
                  </label>
                </div>
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
