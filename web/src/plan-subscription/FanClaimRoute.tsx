import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as api from '../api'
import { useAppState } from '../hooks/useAppState'
import { LoginForm, LoginCard } from '../home/LoginForm'
import { ErrorBanner, errMsg } from '../AppCommon'
import { Button } from '../components/Button'
import styles from '../trip-plan/TripPlanRoute.module.css'

type Status = 'claiming' | 'success' | 'error'

// FanClaimRoute — /fan/:code 路由:粉絲專案連結的核發頁面。
//
// 背景(見使用者明確確認過的規格):粉絲專案連結是固定一組 code,寫死在
// 伺服器端環境變數 FAN_PLAN_CLAIM_CODE,形式是 /fan/<code> 這樣的前端
// 路由。使用者(必須已登入)造訪這個網址、code 吻合時,直接把自己的帳號
// 方案標記成 fan(不經過金流,一次性核發)。
//
// 訪客造訪:顯示登入提示(仿照 trip-plan/TripPlanRoute.tsx 的
// 「isGuest 時內嵌 LoginForm」模式)。這裡選擇「登入後自動繼續核發
// 流程」而非「要求使用者登入後重新整理這個網址」——這個元件本身在
// isGuest 變成 false 後會重新渲染進入下方的已登入分支,useEffect 的
// 依賴陣列含 isGuest,登入完成的那一刻就會自動觸發 claim 呼叫,不需要
// 使用者自己動手重新整理,體驗更順。
//
// 已登入造訪:自動呼叫 claimFanPlan(cfg, code),code 從網址參數取得。
// 成功顯示「已升級為粉絲專案」提示 + 連結導向訂閱方案頁面/`/app`;
// 失敗(code 錯誤)顯示清楚的錯誤訊息,不自動重試(避免使用者手上這個
// 連結本來就是錯的時候,一直無意義地重打同一支 API)。
export function FanClaimRoute() {
  const { code: rawCode } = useParams<{ code: string }>()
  const code = rawCode ?? ''
  const { cfg, theme, isGuest, onAuthed } = useAppState()
  const [status, setStatus] = useState<Status>('claiming')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isGuest) return
    if (!code) {
      setStatus('error')
      setError('這個連結缺少核發碼。')
      return
    }
    let cancelled = false
    setStatus('claiming')
    setError(null)
    api
      .claimFanPlan(cfg, code)
      .then(() => {
        if (!cancelled) setStatus('success')
      })
      .catch((err) => {
        if (!cancelled) {
          setStatus('error')
          setError(errMsg(err))
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, code, cfg.token])

  if (isGuest) {
    return (
      <div className={`${styles.root} app-theme-root`} data-theme={theme ?? undefined}>
        <LoginCard title="登入後領取粉絲專案版" subtitle="請先登入或註冊帳號,登入後會自動為你核發。">
          <LoginForm baseURL={cfg.baseURL} onAuthed={onAuthed} pill />
        </LoginCard>
      </div>
    )
  }

  return (
    <div className={`${styles.root} app-theme-root`} data-theme={theme ?? undefined}>
      <header className={styles.header}>
        <Link to="/app" className={styles.brand}>Tripace</Link>
        <span className={styles.title}>粉絲專案版</span>
      </header>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px 48px' }}>
        {status === 'claiming' && <p>核發中…</p>}
        {status === 'success' && (
          <>
            <p>已升級為粉絲專案版！</p>
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <Link to="/plan">
                <Button variant="primary">查看訂閱方案</Button>
              </Link>
              <Link to="/app">
                <Button variant="secondary">回到 App</Button>
              </Link>
            </div>
          </>
        )}
        {status === 'error' && <ErrorBanner msg={error} />}
      </div>
    </div>
  )
}
