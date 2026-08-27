import { useEffect, useState } from 'react'
import * as api from '../api'
import { ApiError } from '../api'
import { ErrorBanner, errMsg } from '../AppCommon'
import { useAppState } from '../hooks/useAppState'
import { Button } from '../components/Button'
import { FormField } from '../components/FormField'
import { LoginForm, LoginCard } from './LoginForm'

type Status = 'entry' | 'checking' | 'ready' | 'approving' | 'approved' | 'error'

// DeviceAuthPage 是 `tripace-cli login --device` 開瀏覽器後,使用者會落地的
// 頁面(固定網址 /device,選填 ?code=... 預先帶入輸入框)。跟 CliAuthPage.tsx
// (loopback 回呼流程,/cli-auth?id=...)的關鍵差異:網址本身不是唯一憑證
// ——這裡的 userCode 是設計給人眼讀、手動輸入的短代碼,使用者也可以完全不點
// CLI 印出來的連結,直接手動打開這個固定網址、自己輸入代碼,兩者效果相同。
// 這正是 device code 流程(OAuth 2.0 Device Authorization Grant,RFC 8628)
// 存在的理由:核准的這台裝置完全不需要連得到 CLI 那台機器,細節見
// server/internal/store/cliauth.go 開頭的說明。
//
// 沒有「核准後導去 CLI 本地伺服器」這一步——CLI 自己輪詢
// POST /v1/cli-auth/{deviceCode}/exchange(見 server/cmd/cli/login.go 的
// runLoginDevice),這個頁面核准成功後只需要顯示「可以關閉了」,不做任何
// window.location.href 導向。
export function DeviceAuthPage() {
  const { cfg, user, isGuest, onAuthed } = useAppState()
  const prefilledCode = new URLSearchParams(window.location.search).get('code') ?? ''
  const [status, setStatus] = useState<Status>(prefilledCode ? 'checking' : 'entry')
  const [userCode, setUserCode] = useState(prefilledCode)
  const [cliName, setCliName] = useState('')
  const [error, setError] = useState<string | null>(null)

  // lookupName:輸入代碼後(或網址帶 ?code= 自動觸發)呼叫 getDeviceAuthName
  // 確認這組代碼存在,並取得要顯示的 CLI 名稱——找不到通常代表代碼打錯、
  // 過期,或已經被核准/使用過。
  function lookupName(code: string) {
    setStatus('checking')
    setError(null)
    api
      .getDeviceAuthName(cfg, code)
      .then(({ name }) => {
        setCliName(name)
        setStatus('ready')
      })
      .catch((err) => {
        setStatus('entry')
        setError(
          err instanceof ApiError && err.call.status === 404
            ? '這組代碼不存在、已過期,或已經被使用過,請回到終端機重新執行 `tripace-cli login --device`。'
            : errMsg(err),
        )
      })
  }

  // 網址帶 ?code= 進來時(CLI best-effort 開瀏覽器時已經帶入)自動查詢一次,
  // 不需要使用者自己再按一次「查詢」——但輸入框仍會顯示這組代碼,使用者
  // 可以看到、也可以手動修改後重新查詢(例如打錯字要更正)。
  useEffect(() => {
    if (prefilledCode) {
      lookupName(prefilledCode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function approve() {
    setStatus('approving')
    setError(null)
    try {
      await api.approveDeviceAuth(cfg, userCode)
      setStatus('approved')
    } catch (err) {
      setStatus('ready')
      setError(errMsg(err))
    }
  }

  if (status === 'entry') {
    return (
      <LoginCard title="裝置登入">
        <p>請輸入終端機顯示的代碼:</p>
        <form
          className="login-form pill"
          onSubmit={(e) => {
            e.preventDefault()
            if (userCode.trim()) lookupName(userCode.trim())
          }}
        >
          <FormField>
            <input
              type="text"
              value={userCode}
              onChange={(e) => setUserCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX"
              autoFocus
            />
          </FormField>
          <ErrorBanner msg={error} />
          <div className="login-form-actions">
            <Button type="submit" variant="primary" disabled={!userCode.trim()}>
              查詢
            </Button>
          </div>
        </form>
      </LoginCard>
    )
  }

  if (status === 'checking') {
    return <LoginCard>載入中…</LoginCard>
  }

  if (status === 'approved') {
    return (
      <LoginCard title="登入成功" subtitle="可以關閉這個分頁,回到終端機繼續。" />
    )
  }

  if (isGuest) {
    return (
      <LoginCard
        title="歡迎使用 Tripace"
        subtitle={<><strong>{cliName}</strong> 想要登入。請先登入或註冊帳號,才能核准這個請求。</>}
      >
        <LoginForm baseURL={cfg.baseURL} onAuthed={onAuthed} pill />
      </LoginCard>
    )
  }

  // 已登入,狀態為 'ready' 或 'approving':顯示核准畫面。
  return (
    <LoginCard
      title="裝置登入請求"
      subtitle={<><strong>{cliName}</strong> 想要以 <strong>{user.name}</strong> 的身分登入。</>}
    >
      <ErrorBanner msg={error} />
      <Button
        variant="primary"
        disabled={status === 'approving'}
        onClick={approve}
      >
        {status === 'approving' ? '核准中…' : '核准登入'}
      </Button>
    </LoginCard>
  )
}
