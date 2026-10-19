import type { ReactNode } from 'react'
import styles from './PhoneDemoLayout.module.css'

// PhoneDemoLayout——AiPlanPhoneDemoScreen.tsx(首頁/功能介紹頁的手機
// 展示框內容)專用的輕量版面外殼。2026-10 新增(使用者明確要求「小展示
// 用自己獨立的UI layout」,並確認「不是要共用佈局」「這個佈局輕量化,
// 只有佈局本身邏輯,內部元件都是挖洞組合進去的」):原本 statusBar/
// 地圖背景/時間軸容器/composer 站位這四塊排版區塊直接混在
// AiPlanPhoneDemoScreen.tsx 的 JSX 裡,這裡抽成獨立元件,只管「容器
// 放哪裡、多大」,不含任何資料或互動邏輯——對齊
// plan-ai-sim/PlanDemoLayout.tsx(播放態 /ai-plan 完整展示頁用的對應
// 元件,同一輪重構先完成的那份)的同一種「挖洞組合」設計哲學,但這是
// 給這個手機展示框自己專用的獨立版本,刻意不跟 PlanDemoLayout/
// PlanOverlayPanel 共用或繼承——三者服務的容器尺寸、定位方式完全不同
// (PlanDemoLayout 是整頁 100dvh 展示頁,這裡是寫死 390×844 尺寸的手機
// 螢幕內容,見 AiPlanPhoneDemoScreen.tsx 檔頭「方案 B」的完整說明),
// 勉強共用只會讓各自的特例判斷互相牽扯。
//
// 五個具名插槽,呼叫端清楚知道什麼內容該放哪個洞,不用猜測單一
// children 裡的排列順序:
//   - statusBar:貼齊畫面頂端、避開動態島空間的裝飾列(時間/訊號圖示)。
//   - mapBackground:鋪滿整個容器的背景層(地圖圖片/遮罩),z-index 最低。
//   - caption:疊在地圖主顯示區上方的標題文字區塊(見下方完整說明)。
//   - timeline:疊在背景之上的主要內容(時間軸卡片列)。
//   - composer:貼齊畫面底部的站位,目前放的是「試試看」視覺引導
//     (見 AiPlanPhoneDemoScreen.tsx 該區塊的完整說明:不是真的
//     <button>,點擊事件冒泡到外層 Link),對齊 PlanOverlayPanel 的
//     composer slot 概念,但這裡純粹是容器站位,不含真正的輸入互動。
//
// caption——2026-10 新增(使用者明確要求「最小版面,上方的字放進手機
// 裡面的上方看看」,並確認「文字是放在地圖的主顯示區」):原本首頁
// ScrollPlanDemo.tsx 外部獨立的標題區塊(主標題+描述文字)移進手機
// 畫面內部,疊在地圖背景之上、statusBar 之下。選填——只有首頁傳入,
// /product 功能介紹頁的小展示(FeatureShowcase.tsx)維持原狀不傳,見
// 呼叫端 AiPlanPhoneDemoScreen.tsx 的完整說明。
interface PhoneDemoLayoutProps {
  statusBar?: ReactNode
  mapBackground?: ReactNode
  caption?: ReactNode
  timeline?: ReactNode
  composer?: ReactNode
}

export function PhoneDemoLayout({ statusBar, mapBackground, caption, timeline, composer }: PhoneDemoLayoutProps) {
  return (
    <div className={`${styles.screen} app-theme-root`}>
      {mapBackground && <div className={styles.mapBackgroundSlot}>{mapBackground}</div>}
      {statusBar && <div className={styles.statusBarSlot}>{statusBar}</div>}
      {caption && <div className={styles.captionSlot}>{caption}</div>}
      {timeline && <div className={styles.timelineSlot}>{timeline}</div>}
      {composer && <div className={styles.composerSlot}>{composer}</div>}
    </div>
  )
}
