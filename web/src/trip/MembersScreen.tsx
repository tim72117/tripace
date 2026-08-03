import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import type { ClientConfig } from '../api'
import * as api from '../api'
import type { Trip, TripRole, Member } from '../types'
import { Avatar, ErrorBanner, errMsg, isSubmitEnter } from '../AppCommon'
import styles from './MembersScreen.module.css'

// ---- 成員頁 ----

export function MembersScreen({
  cfg,
  trip,
  isOwner,
  onBack,
}: {
  cfg: ClientConfig
  trip: Trip
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
      <div className="navbar">
        <button className="btn icon-btn" onClick={onBack}>
          <ChevronLeft size={20} strokeWidth={1.8} />
        </button>
        <span className="title">成員</span>
        <span style={{ width: 36 }} />
      </div>
      <div className="screen-body">
        <ErrorBanner msg={err} />
        <div className="section-title">行程成員 · {trip.name}</div>
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
        <div style={{ padding: '8px 16px 0' }}>
          <button className="btn-primary" onClick={invite} disabled={adding || !email.includes('@')}>
            {adding ? '邀請中…' : '邀請加入'}
          </button>
        </div>
      </div>
    </>
  )
}
