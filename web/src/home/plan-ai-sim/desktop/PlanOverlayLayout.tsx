import { OVERLAY_SLOT, slotAttr } from '../../../plan-core/overlayDom'
import type { AiPlanOverlayLayoutProps } from '../overlayLayoutProps'
import styles from '../PlanOverlayLayout.module.css'
import { PlanOverlayPanel } from './PlanOverlayPanel'

// PlanOverlayLayout(/ai-plan 桌面疊加版面,home/plan-ai-sim/desktop/)——768–1023px 的「地圖加疊加 UI」外殼。
// 三個實體的切法見 phone/PlanOverlayLayout.tsx。
//
// 這個寬度沒有安全區節點,也沒有手機版的 controls-slot 與 overlay 外殼,維持原本結構:
//   map-layer(mapBackground) + 疊加面板 PlanOverlayPanel(面板與輸入列插槽同層手足)
// safeAreaRef 收下但不渲染節點(useMapSafeArea 沒有目標元素時退回整張地圖),與 Content 傳同一組 props。
export function PlanOverlayLayout({ mapBackground, passThrough, composer, children }: AiPlanOverlayLayoutProps) {
  return (
    <>
      {mapBackground && (
        <div {...slotAttr(OVERLAY_SLOT.mapLayer)} className={styles.mapLayer}>
          {mapBackground}
        </div>
      )}
      <PlanOverlayPanel passThrough={passThrough} composer={composer}>
        {children}
      </PlanOverlayPanel>
    </>
  )
}
