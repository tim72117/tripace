import { useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import type { ClientConfig } from '../api'
import * as api from '../api'
import type { User } from './types'
import type { AssistLang } from '../assistLang'
import { ASSIST_LANG_KEY, getAssistLang } from '../assistLang'
import { Avatar, errMsg } from '../AppCommon'
import { LangSelect } from './LangSelect'
import { TokenDisplay } from './TokenDisplay'
import styles from './SettingsDialog.module.css'

// 桌面版「設定」dialog:點選 DesktopUserMenu 的「設定」項目後開啟,置中卡片彈窗,
// 視覺沿用原 RecommendedPlacesModal(已移除)留下的 .rp-modal-backdrop/.rp-modal
// 樣式骨架(見 styles.css),內容則對應手機版 SettingsScreen 扣除「登出」
// (登出已是選單裡的獨立項目)。疊加 .settings-dialog-backdrop 只覆寫 position
// 從 absolute 改為 fixed:.rp-modal-backdrop 原本用 absolute+inset:0 是相對
// 最近的 relative 祖先(.desktop-main)定位,只蓋住右側聊天區;這裡是從
// DesktopLayout.tsx 頂層渲染,需要蓋住整個桌面版佈局(含左側側欄),且不能被
// .desktop-layout 的 overflow: hidden 裁切,故改用 fixed。從 DesktopLayout.tsx
// 抽出獨立成檔案,搬移純粹是移動程式碼位置,不涉及邏輯重組。
export function SettingsDialog({
  cfg,
  user,
  email,
  onClose,
}: {
  cfg: ClientConfig
  user: User
  email: string
  onClose: () => void
}) {
  const [health, setHealth] = useState<string>('未測試')
  const [assistLang, setAssistLang] = useState<AssistLang>(() => getAssistLang())
  const [devOpen, setDevOpen] = useState(false)

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
    <div className="rp-modal-backdrop settings-dialog-backdrop" onClick={onClose}>
      <div className="rp-modal settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="rp-modal-head">
          <span className="rp-modal-title">設定</span>
          <button className="btn icon-btn" onClick={onClose} title="關閉">
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>
        <div className="rp-modal-body">
          <div className="section-title">目前登入</div>
          <div className="row">
            <Avatar user={user} />
            <div className="grow">
              <div className="name">{user.name}</div>
              <div className="sub">{email || user.id}</div>
            </div>
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
          <div className={styles.devToggle} onClick={() => setDevOpen((o) => !o)}>
            <span>開發</span>
            <ChevronDown
              size={16}
              strokeWidth={1.8}
              color="var(--ios-gray)"
              className={devOpen ? `${styles.devChevron} ${styles.devChevronOpen}` : styles.devChevron}
            />
          </div>
          {devOpen && (
            <>
              <div className="section-title">API Token (CLI 用)</div>
              <TokenDisplay token={cfg.token} />
              <div className="section-title">後端連線</div>
              <div className="field">
                <label>Base URL(由 VITE_API_BASE 設定,不可於此修改)</label>
                <input value={cfg.baseURL} readOnly disabled />
              </div>
              <div className="section-title">健康檢查</div>
              <div className="row" onClick={ping}>
                <div className="grow">
                  <div className="name">GET /health</div>
                  <div className="sub">{health}</div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
