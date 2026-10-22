import type { ReactNode } from 'react'
import styles from './PhoneDemoLayout.module.css'

// PhoneDemoLayout——AiPlanPhoneDemoScreen.tsx(首頁/功能介紹頁的手機
// 展示框內容)專用的輕量版面外殼。2026-10 新增(使用者明確要求「小展示
// 用自己獨立的UI layout」,並確認「不是要共用佈局」「這個佈局輕量化,
// 只有佈局本身邏輯,內部元件都是挖洞組合進去的」):原本 statusBar/
// 地圖背景/時間軸容器/composer 站位這四塊排版區塊直接混在
// AiPlanPhoneDemoScreen.tsx 的 JSX 裡,這裡抽成獨立元件,只管「容器
// 放哪裡、多大」,不含任何資料或互動邏輯——對齊
// plan-ai-sim/PlanLayout.tsx(播放態 /ai-plan 完整展示頁用的對應
// 元件,同一輪重構先完成的那份)的同一種「挖洞組合」設計哲學,但這是
// 給這個手機展示框自己專用的獨立版本,刻意不跟 PlanLayout/
// PlanOverlayPanel 共用或繼承——三者服務的容器尺寸、定位方式完全不同
// (PlanLayout 是整頁 100dvh 展示頁,這裡是寫死 390×844 尺寸的手機
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
//
// stacked——2026-10(第九輪,使用者明確回報「文字區要給固定容器大小,
// 不要被時間軸往上推覆蓋了」,並確認要「改成真正 flex 文件流」):
// 預設 false,維持上述疊圖模式(captionSlot/timelineSlot 各自獨立
// position: absolute,沒有真正的空間互斥保證,時間軸卡片內容變多/
// 變高時理論上可能物理蓋到 captionSlot 的固定區域)。true 時改用
// flex column 文件流排列(見 .module.css 的 .screenStacked/
// .captionSlotStacked/.timelineSlotStacked 完整說明):caption 區塊
// 有自己的最小高度跟實體背景、timeline 區塊分配剩餘空間,兩者是
// 真正的文件流鄰居,高度由瀏覽器版面引擎保證不重疊,不是兩層各自
// 宣告地盤的絕對定位。
//
// 只有 ScrollPlanDemo.tsx 在 frameless 模式(手機斷點,見該檔案
// PHONE_FRAMELESS_BREAKPOINT 的完整說明)下傳 true——桌面版(有邊框、
// 390×844 固定畫布)與 /product 功能介紹卡維持原本疊圖模式,不受
// 影響,理由同 frameless/stacked 兩個維度本來就是同一輪決定但各自
// 獨立的 prop:frameless 決定「有沒有手機外框造型」,stacked 決定
// 「內容版面是疊圖還是文件流排列」,目前兩者永遠一起開關,但故意
// 設計成兩個獨立 prop 而非合併成一個,保留未來兩者分開組合的彈性
// (例如日後某個情境想要「有外框+文件流版面」)。
interface PhoneDemoLayoutProps {
  statusBar?: ReactNode
  mapBackground?: ReactNode
  caption?: ReactNode
  timeline?: ReactNode
  composer?: ReactNode
  stacked?: boolean
}

export function PhoneDemoLayout({ statusBar, mapBackground, caption, timeline, composer, stacked = false }: PhoneDemoLayoutProps) {
  const screenClass = stacked ? `${styles.screen} ${styles.screenStacked} app-theme-root` : `${styles.screen} app-theme-root`
  // captionClass/timelineClass——2026-10(第十輪,Opus 第二意見確認的
  // 根因修正):stacked 模式改用完全獨立的 .captionStacked/
  // .timelineStacked,不再疊加疊圖模式的 .captionSlot/.timelineSlot。
  // 疊加寫法曾經造成一個隱性 bug——.timelineSlot 的
  // padding-bottom: calc(--composer-slot-height + 16px)(=88px,見該
  // class 的完整說明:是給疊圖模式底部 composer 站位留的空間)被
  // stacked 模式繼承,但 stacked 模式(目前的呼叫端)根本沒有渲染
  // composer,這段 padding 變成一段沒人要的死空白,讓時間軸卡片列看
  // 起來沒有真正貼齊容器底部。改成兩個模式各自獨立的 class,不會再
  // 有「改一個模式的樣式卻不小心連帶影響到另一個模式」這種繼承風險。
  const captionClass = stacked ? styles.captionStacked : styles.captionSlot
  const timelineClass = stacked ? styles.timelineStacked : styles.timelineSlot
  return (
    <div className={screenClass}>
      {mapBackground && <div className={styles.mapBackgroundSlot}>{mapBackground}</div>}
      {statusBar && <div className={styles.statusBarSlot}>{statusBar}</div>}
      {caption && <div className={captionClass}>{caption}</div>}
      {timeline && <div className={timelineClass}>{timeline}</div>}
      {composer && <div className={styles.composerSlot}>{composer}</div>}
    </div>
  )
}
