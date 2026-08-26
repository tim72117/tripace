import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import type { ClientConfig } from '../api'
import * as api from '../api'
import type { User } from './types'
import type { AssistLang } from '../assistLang'
import { ASSIST_LANG_KEY, getAssistLang } from '../assistLang'
import type { Theme } from '../theme'
import { Avatar, errMsg } from '../AppCommon'
import { LoginForm } from '../home/LoginForm'
import { LangSelect } from './LangSelect'
import { ThemeToggle } from './ThemeToggle'
import { TokenDisplay } from './TokenDisplay'

// SettingsScreen:手機版設定整頁(連線設定 + 測試 health)——從
// PhoneScreens.tsx 拆成獨立檔案,只有這一個元件在用,不再跟 PublicViewScreen
// 共用同一個檔案。樣式沿用 styles.css 的全站共用 class(.navbar/.row/
// .section-title/.field 等),刻意不建立專屬 CSS Module——這些 class 是
// ChatScreen/PhoneNavDrawer 等多處畫面刻意共用的一套,拆成 CSS Module
// 只會製造重複定義,不是這次分拆的目的(這次只拆元件檔案本身)。
export function SettingsScreen({
  cfg,
  user,
  email,
  isGuest,
  onAuthed,
  onLogout,
  onBack,
  theme,
  setTheme,
}: {
  cfg: ClientConfig
  user: User
  email: string
  isGuest: boolean
  onAuthed: (token: string, user: User, email: string) => void
  onLogout: () => void
  onBack?: () => void
  theme: Theme
  setTheme: (v: Theme) => void
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
        <div className="section-title">外觀</div>
        <div className="field">
          <label>介面深色/淺色模式,「跟隨系統」會依裝置設定自動切換</label>
          <ThemeToggle value={theme} onChange={setTheme} />
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
