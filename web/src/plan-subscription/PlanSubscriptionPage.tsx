import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../api'
import type { PlanMeResult } from '../api'
import { ErrorBanner, errMsg } from '../AppCommon'
import styles from './PlanSubscriptionPage.module.css'

// PlanSubscriptionPage:訂閱方案機制第一階段的「訂閱方案」頁面本體——
// 只列出方案定義(名稱、每月 AI 請求額度說明)與目前方案,刻意不做任何
// 升級/付款按鈕(粉絲專案版的核發走 /fan/<code> 這條獨立連結,不是這個
// 頁面上的按鈕,見 FanClaimRoute.tsx 的完整說明;付款金流完全不在這階段
// 範圍內)。
//
// 呼叫端(PlanSubscriptionRoute.tsx)負責「登入後才可見」這件事(訪客時
// 內嵌登入表單,仿照 trip-plan/TripPlanRoute.tsx 的既有模式),這個元件
// 本身假設呼叫時已經是登入狀態(cfg.token 非 null),直接打
// GET /internal/plan/me。
export function PlanSubscriptionPage({ cfg }: { cfg: api.ClientConfig }) {
  const [data, setData] = useState<PlanMeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .fetchMyPlan(cfg)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((err) => {
        if (!cancelled) setError(errMsg(err))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.token])

  if (error) {
    return (
      <div className={styles.root}>
        <ErrorBanner msg={error} />
      </div>
    )
  }

  if (!data) {
    return <div className={styles.root}>載入中…</div>
  }

  return (
    <div className={styles.root}>
      <p className={styles.intro}>
        以下是目前提供的方案。粉絲專案版透過專屬連結核發,不需要在這裡付款。
      </p>
      <div className={styles.planList}>
        {data.plans.map((plan) => {
          const isCurrent = plan.tier === data.currentTier
          return (
            <div
              key={plan.tier}
              className={isCurrent ? `${styles.planCard} ${styles.planCardCurrent}` : styles.planCard}
            >
              <div className={styles.planHeader}>
                <span className={styles.planName}>{plan.name}</span>
                {isCurrent && <span className={styles.currentBadge}>目前方案</span>}
              </div>
              <p className={styles.planQuota}>
                {plan.monthlyAIRequests > 0
                  ? `每月 ${plan.monthlyAIRequests} 次 AI 規劃對話`
                  : 'AI 規劃對話次數不限制'}
              </p>
            </div>
          )
        })}
      </div>
      <Link to="/app" className={styles.backLink}>返回 App</Link>
    </div>
  )
}
