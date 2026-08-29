import { useState } from 'react'
import type { ReactNode } from 'react'
import { Navigation } from 'lucide-react'
import type { ClientConfig } from '../api'
import * as api from '../api'
import type { User } from '../user/types'
import { ErrorBanner, errMsg, isSubmitEnter } from '../AppCommon'
import { useGoogleSignIn } from '../hooks/useGoogleSignIn'
import { Button } from '../components/Button'
import { FormField } from '../components/FormField'
import './LoginForm.css'
import loginFieldStyles from './LoginForm.module.css'

// build time 注入的 Google OAuth Client ID(GSI 模式,見 useGoogleSignIn.ts
// 開頭的完整背景說明)。未設定時整個 Google 登入按鈕不會渲染——這是
// tripace 選擇的優雅降級方式:直接讓前端檢查自己的 build-time 環境變數
// 決定要不要顯示按鈕,不需要額外打一支 /auth/config 之類的 API 才能知道
// (這個值本來就是 build time 決定、不會在執行期間變動)。
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as
  | string
  | undefined

// LoginForm.tsx——從 AppCommon.tsx 拆出來的登入相關元件(LoginCard/
// LoginForm),原本跟 useIsDesktop/useTripsState 等完全不相關的工具擠在
// 同一個檔案裡。ErrorBanner/errMsg/isSubmitEnter 這三個更泛用的小工具
// (被 13+ 個檔案共用,不只登入相關頁面)仍留在 AppCommon.tsx,這裡只是
// import 回來用,不重複定義。樣式(.login-screen/.login-card/.login-form
// 系列)原本在全域的 styles-login.css(main.tsx import),現已改成
// LoginForm.tsx 自己 import 同名的 LoginForm.css,原檔案已刪除——這些
// class 仍是全域 class(非 CSS Module),只是載入責任從 main.tsx 移交給
// 這個元件自己。

// ---- 登入卡片殼(全螢幕置中,歡迎文字獨立於卡片外+卡片本身只放表單) ----

// LoginCard:App.tsx 的訪客登入頁與 CliAuthPage.tsx 的 CLI 登入核准頁
// (載入中/錯誤/成功/待登入/待核准共 5 種狀態)共用的卡片殼——原本這 6 處
// 各自手寫了一份幾乎一模一樣的 .login-screen > .login-card > .login-card-header
// 結構,只有標題/副標/內容不同,現在抽成一顆元件避免重複維護。
//
// 品牌 logo/標題/副標刻意放在 .login-card 外面(獨立的 .login-welcome
// 區塊),不是塞進卡片內部——「歡迎使用 Tripace」這類迎賓文字是給人讀的
// 招呼語,跟卡片裡「輸入 email/密碼」這種操作型內容,語意層級不同,擠在
// 同一個帶陰影的方框裡會讓歡迎詞降格成表單的一部分,兩者都因此變得平淡。
// 拆開後 .login-welcome 讀起來像一段小型 hero(對齊 HomePage.tsx 的
// .hero-eyebrow/.hero-title 那種「先讀文字、再進入操作」的節奏),卡片
// 本身只保留最單純的操作介面,兩者各自的份量都更清楚。
// title 留空時不渲染歡迎區塊(對齊 CliAuthPage 的「載入中…」狀態:只有
// .login-card 包一段純文字,沒有 logo/標題)。
export function LoginCard({
  title,
  subtitle,
  children,
}: {
  title?: string
  subtitle?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="login-screen">
      {title && (
        <div className="login-welcome">
          {/* Tripace 字樣本身就是回首頁的連結,對齊 HomePage.tsx 的
              .brand-mark(點品牌字回首頁)慣例——不額外加一顆「回首頁」
              按鈕造成視覺負擔。 */}
          <a className="login-welcome-logo" href="/">
            <Navigation size={20} strokeWidth={2} />
            <span>Tripace</span>
          </a>
          <h1 className="login-welcome-title">{title}</h1>
          {subtitle && <p className="login-welcome-subtitle">{subtitle}</p>}
        </div>
      )}
      <div className="login-card">
        {children}
      </div>
    </div>
  )
}

// ---- 登入表單(內嵌於設定頁,訪客可登入 / 註冊) ----

// 匯出供 CliAuthPage.tsx 重用(CLI 瀏覽器登入核准頁未登入時顯示的登入表單,
// 與這裡登入前主畫面用的是同一顆元件,不另外刻一份 UI)。
// pill:是否套用大圓角膠囊風格(見 styles.css 的 .login-form.pill)——
// LoginForm 自己決定要不要套用,不再依賴外層容器(.login-card)用複合
// 選擇器從外面蓋樣式。掛在 LoginCard(App.tsx 訪客頁、CliAuthPage.tsx)
// 裡時傳 pill;掛在 .login-dropdown/SettingsScreen 訪客區塊/
// DesktopUserMenu popover 這幾處維持預設(不傳,保留原本的一般樣式)。
export function LoginForm({
  baseURL,
  onAuthed,
  pill,
}: {
  baseURL: string
  onAuthed: (token: string, user: User, email: string) => void
  pill?: boolean
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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

  // Google 登入(GSI 模式):按鈕由 Google 官方 SDK 渲染,成功時直接拿到
  // credential(ID Token),送給後端驗證換自家 token,回呼跟帳密登入共用
  // 同一個 onAuthed。busy 沿用同一個旗標避免使用者在請求進行中重複點擊
  // (帳密表單的輸入框/按鈕與 Google 按鈕共用同一個忙碌狀態的體感)。
  const { buttonRef: googleButtonRef, error: googleErr } = useGoogleSignIn(
    GOOGLE_CLIENT_ID,
    (credential) => {
      setErr(null)
      setBusy(true)
      api
        .signInWithGoogle(cfg, credential)
        .then((res) => onAuthed(res.token, res.user, res.profile.email))
        .catch((e) => setErr(errMsg(e)))
        .finally(() => setBusy(false))
    },
  )

  return (
    <div className={pill ? 'login-form pill' : 'login-form'}>
      <FormField className={loginFieldStyles.loginFormField}>
        <input
          value={email}
          type="email"
          autoComplete="email"
          onChange={(e) => setEmail(e.target.value)}
          placeholder="輸入你的 Email"
        />
      </FormField>
      <FormField className={loginFieldStyles.loginFormField}>
        <input
          type="password"
          value={password}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => isSubmitEnter(e) && submit()}
          placeholder="輸入密碼"
        />
      </FormField>
      {mode === 'register' && (
        <FormField className={loginFieldStyles.loginFormField}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="顯示名稱(可選,留空則用 email)"
          />
        </FormField>
      )}
      <ErrorBanner msg={err} />
      <div className="login-form-actions">
        <Button
          variant="primary"
          onClick={submit}
          disabled={busy || !email.trim() || !password}
        >
          {busy ? '處理中…' : mode === 'login' ? '登入' : '註冊並登入'}
        </Button>
        {/* GOOGLE_CLIENT_ID 未設定(VITE_GOOGLE_OAUTH_CLIENT_ID 沒填)時
            完全不渲染這一整塊——不顯示壞掉的按鈕,也不留一段空白的分隔線,
            對齊 useGoogleSignIn 開頭說明的優雅降級原則。googleErr 只在
            SDK 載入/初始化本身失敗時才會有值(例如網路擋掉
            accounts.google.com),同樣直接不渲染按鈕區塊,不額外顯示
            一則多餘的錯誤訊息干擾主要的帳密登入流程。 */}
        {GOOGLE_CLIENT_ID && !googleErr && (
          <>
            <div className="login-form-divider">
              <span>或</span>
            </div>
            <div className="login-form-google" ref={googleButtonRef} />
          </>
        )}
        <div className="login-form-switch">
          <span className="login-form-switch-hint">
            {mode === 'login' ? '還沒有帳號?' : '已有帳號?'}
          </span>{' '}
          <span
            className="login-form-switch-action"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login')
              setErr(null)
            }}
          >
            {mode === 'login' ? '註冊' : '登入'}
          </span>
        </div>
      </div>
      <div className="login-form-consent">
        註冊或登入即表示你同意<a href="/terms" target="_blank" rel="noreferrer">服務條款</a>
      </div>
    </div>
  )
}
