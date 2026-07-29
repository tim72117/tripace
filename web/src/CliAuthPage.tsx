import { useEffect, useState } from 'react'
import * as api from './api'
import { ApiError } from './api'
import { useAppState, LoginForm, LoginCard, ErrorBanner, errMsg } from './AppCommon'

type Status = 'checking' | 'ready' | 'approving' | 'approved' | 'error'

// CliAuthPage 是 `tripace-cli login --web` 開啟瀏覽器後,使用者會落地的頁面
// (網址 /cli-auth?id=...)。網址上自始至終只帶著一個東西——
// POST /v1/cli-auth/start 換回的 opaque、單次使用的 id(見
// server/internal/store/cliauth.go 開頭的說明)——從未帶著 CLI 本地伺服器的
// 位址本身,也從未帶著要核發的 token。這個 id 與 CLI 本地伺服器位址的對應
// 關係,自始至終只在伺服器端、只在 CLI 自己呼叫 start 時建立過一次,這頁面
// 從不讀取也不能控制那個對應關係,這正是為什麼一個惡意連結沒辦法把剛核發的
// token 導到攻擊者選的網址。
//
// 這頁面走的是 tripace 全站唯一的一種登入狀態(localStorage 存的 JWT,見
// App.tsx 的 useAppState),不像 onagent 用 cookie session——已登入與否直接
// 從 useAppState() 的 isGuest 同步取得,不需要額外呼叫一個「已登入才會成功」
// 的端點來試探。
export function CliAuthPage() {
  const { cfg, user, isGuest, onAuthed } = useAppState()
  const [status, setStatus] = useState<Status>('checking')
  const [cliName, setCliName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const id = new URLSearchParams(window.location.search).get('id') ?? ''

  useEffect(() => {
    if (!id) {
      setStatus('error')
      setError('這個登入連結缺少必要的 id 參數。')
      return
    }
    api
      .getCliAuthName(cfg, id)
      .then(({ name }) => {
        setCliName(name)
        setStatus('ready')
      })
      .catch((err) => {
        setStatus('error')
        setError(
          err instanceof ApiError && err.call.status === 404
            ? '這個登入連結已過期或已被使用過,請回到終端機重新執行 `tripace-cli login --web`。'
            : errMsg(err),
        )
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function approve() {
    setStatus('approving')
    setError(null)
    try {
      const { redirectUri } = await api.approveCliAuth(cfg, id)
      setStatus('approved')
      const url = new URL(redirectUri)
      url.searchParams.set('code', id)
      window.location.href = url.toString()
    } catch (err) {
      setStatus('ready')
      setError(errMsg(err))
    }
  }

  if (status === 'checking') {
    return <LoginCard>載入中…</LoginCard>
  }

  if (status === 'error') {
    return (
      <LoginCard title="無法完成登入">
        <ErrorBanner msg={error} />
      </LoginCard>
    )
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
      title="CLI 登入請求"
      subtitle={<><strong>{cliName}</strong> 想要以 <strong>{user.name}</strong> 的身分登入。</>}
    >
      <ErrorBanner msg={error} />
      <button
        type="button"
        className="btn-primary"
        disabled={status === 'approving'}
        onClick={approve}
      >
        {status === 'approving' ? '核准中…' : '核准登入'}
      </button>
    </LoginCard>
  )
}
