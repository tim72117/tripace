import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAppState } from '../hooks/useAppState'
import { LoginForm, LoginCard } from '../home/LoginForm'
import { TripPlanPage } from './TripPlanPage'
import styles from './TripPlanRoute.module.css'

// TripPlanRoute — /trip-plan 獨立路由的頁面外殼。
//
// 原本 AI 規劃掛在 /app/plan-ai(共用 /app/:panelMode? 的面板系統,
// 依賴 DesktopLayout/DesktopMain 提供版面與捲動容器)。這裡改成完全
// 獨立的頁面:自己管深色模式 token(app-theme-root + data-theme)、
// 捲動容器,不依賴 /app 底下任何版面機制;架構仿照
// home/plan-ai-sim/AIPlanTimelinePage.tsx,但日夜模式沿用登入後 App
// 本身的偏好(useAppState 的 theme),不是展示頁那種純前端暫時切換。
//
// 登入模式仿照 home/CliAuthPage.tsx:訪客可到達這個網址,頁面內自己用
// useAppState() 取 cfg/isGuest/onAuthed,isGuest 時內嵌 LoginForm,登入後
// 才顯示 TripPlanPage 本體(不是未登入就擋下或導轉)。
//
// TripPlanPage 本身不動:它「不掛 app-theme-root」的假設(見該檔案
// return 前的說明)由這裡補上——手機版 bottom sheet 的呼叫端仍在 /app
// 底下、仍依賴原本的假設。
export function TripPlanRoute() {
  const { cfg, theme, isGuest, onAuthed } = useAppState()
  // 捲動權在這個撐滿視窗的外層容器(TripPlanPage 全頁模式 .page 是自然
  // 高度),ref 交給 TripPlanPage 的 scrollContainerRef,讓「回到最新」
  // 量測/監聽真正捲動的節點。
  const scrollRef = useRef<HTMLDivElement | null>(null)

  if (isGuest) {
    return (
      <div className={`${styles.root} app-theme-root`} data-theme={theme ?? undefined}>
        <LoginCard title="登入後使用 AI 規劃" subtitle="請先登入或註冊帳號。">
          <LoginForm baseURL={cfg.baseURL} onAuthed={onAuthed} pill />
        </LoginCard>
      </div>
    )
  }

  return (
    <div ref={scrollRef} className={`${styles.root} app-theme-root`} data-theme={theme ?? undefined}>
      <header className={styles.header}>
        <Link to="/app" className={styles.brand}>Tripace</Link>
        <span className={styles.title}>AI 規劃</span>
      </header>
      <TripPlanPage cfg={cfg} scrollContainerRef={scrollRef} />
    </div>
  )
}
