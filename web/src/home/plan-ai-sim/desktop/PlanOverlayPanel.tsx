import { useState, type ReactNode } from 'react'
import { ComposerSlotContext, OVERLAY_SLOT, slotAttr } from '../../../plan-core/overlayDom'
import styles from '../PlanOverlayPanel.module.css'

// PlanOverlayPanel(/ai-plan 桌面疊加版面,home/plan-ai-sim/desktop/)——疊在地圖上方的 UI 層外殼:只做版面配置。
//   - 定位:桌面右側欄 / 手機貼底的面板
//   - 事件穿透:手機版讓出空白處給地圖
//   - 地圖安全區:手機版
//   - 輸入框插槽(composer slot):貼底置中的位置,內容由各層放進來
//
// 為什麼獨立出來:交接前的模擬層(plan-ai-sim/Content 自己的時間軸)與
// 交接後的真實層(LivePlanLayer → TripPlanPage)原本各自處理這些事,
// 版面規則散在兩個檔案、兩套 CSS。交接後手機版因此出現輸入框貼在頂端、
// 整張地圖被透明容器蓋住拉不動。外殼不含任何資料或互動行為,只負責
// 「東西放哪裡」;放什麼由呼叫端決定。
//
// 輸入框兩種放法(同一個插槽):
//   1. composer prop——內容是呼叫端自己的 JSX(模擬層的假輸入框)。
//   2. ComposerSlotContext——內容元件自己 portal 進來(真實層的
//      TripPlanPage,它的輸入框綁著對話狀態,不適合拆出去傳 prop)。
// 桌面版(>=768px)的疊加面板:固定寬度、貼齊 .container 右緣、上下撐滿的側欄,地圖左側完全露出。
// 手機版的疊加外殼(overlay > panel > safe-area、composer-slot)已移到共用的
// plan-core/OverlayShell.tsx(/ai-plan 與登入後手機版共用同一份),由 PlanOverlayLayout 渲染;
// 這個元件不再處理手機版,也就沒有 isDesktop 與 safeAreaRef。
//
// 桌面版的輸入框插槽是面板的手足(不是子孫):桌面 .panel 是固定寬度的 absolute 側欄,插槽放進
// 面板內部會被側欄寬度侷限。
//
// 寬螢幕(>=1024px)的側欄版面是 wide/PlanOverlayPanel.tsx(同名不同目錄,結構相同、換一份樣式)。
interface PlanOverlayPanelProps {
  // passThrough——面板本身不接收指標事件(只在手機斷點有效,桌面 CSS 不覆蓋地圖)。
  passThrough?: boolean
  composer?: ReactNode
  children: ReactNode
}

export function PlanOverlayPanel({ passThrough = false, composer, children }: PlanOverlayPanelProps) {
  const [composerSlot, setComposerSlot] = useState<HTMLDivElement | null>(null)

  return (
    <ComposerSlotContext.Provider value={composerSlot}>
      <div
        {...slotAttr(OVERLAY_SLOT.panel)}
        className={passThrough ? `${styles.panel} ${styles.passThrough}` : styles.panel}
      >
        {children}
      </div>
      <div {...slotAttr(OVERLAY_SLOT.composerSlot)} className={styles.composerSlot} ref={setComposerSlot}>
        {composer}
      </div>
    </ComposerSlotContext.Provider>
  )
}
