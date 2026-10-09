import { Link } from 'react-router-dom'
import { useAppState } from '../hooks/useAppState'
import { LoginForm, LoginCard } from '../home/LoginForm'
import { PlanSubscriptionPage } from './PlanSubscriptionPage'
import styles from '../trip-plan/TripPlanRoute.module.css'

// PlanSubscriptionRoute — /plan 獨立路由的頁面外殼,架構完全比照
// trip-plan/TripPlanRoute.tsx(共用同一份 CSS module,視覺語言保持一致,
// 不另外刻一份幾乎相同的樣式)。
//
// 訂閱方案頁面只在登入後可見——這是使用者明確確認過的規格(首頁等公開
// 行銷頁不該出現任何訂閱 CTA,登入後才看得到方案資訊)。訪客造訪這個
// 網址時,內嵌登入表單(LoginForm/LoginCard),不是直接導向 /app 或
// 顯示錯誤——理由同 TripPlanRoute 的既有說明:讓使用者可以直接在這個
// 網址完成登入,登入後立刻看到這個頁面本體,不需要先跳別處登入再回來。
export function PlanSubscriptionRoute() {
  const { cfg, theme, isGuest, onAuthed } = useAppState()

  if (isGuest) {
    return (
      <div className={`${styles.root} app-theme-root`} data-theme={theme ?? undefined}>
        <LoginCard title="登入後查看訂閱方案" subtitle="請先登入或註冊帳號。">
          <LoginForm baseURL={cfg.baseURL} onAuthed={onAuthed} pill />
        </LoginCard>
      </div>
    )
  }

  return (
    <div className={`${styles.root} app-theme-root`} data-theme={theme ?? undefined}>
      <header className={styles.header}>
        <Link to="/app" className={styles.brand}>Tripace</Link>
        <span className={styles.title}>訂閱方案</span>
      </header>
      <PlanSubscriptionPage cfg={cfg} />
    </div>
  )
}
