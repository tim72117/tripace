import { OVERLAY_SLOT, slotAttr } from '../../../plan-core/overlayDom'
import type { AiPlanOverlayLayoutProps } from '../overlayLayoutProps'
import styles from '../PlanOverlayLayout.module.css'
import { COMPOSER_BAND_HEIGHT, SIDEBAR_TOP, SIDEBAR_WIDTH } from '../planOverlayGeometry'
import { PlanOverlayPanel } from './PlanOverlayPanel'

// PlanOverlayLayout(/ai-plan wide 側欄版面,home/plan-ai-sim/wide/)——≥1024px 的「地圖加疊加 UI」外殼。
// 三個實體的切法見 phone/PlanOverlayLayout.tsx。
//
// 地圖滿版;右側是側欄(PlanOverlayPanel,時間軸),下方是 composer 帶;沒有 controls-slot 與 overlay 外殼。
// 安全區:帶 data-slot="safe-area" 的看不見節點,safeAreaRef 接在它身上(useMapSafeArea 讀它算鏡頭中心)。範圍是
// 「沒被側欄與導覽列、composer 帶蓋住的地圖」:left 剩餘空間,top 讓出漂浮導覽列(SIDEBAR_TOP)、right 讓出側欄
// (SIDEBAR_WIDTH)、bottom 讓出 composer 帶(COMPOSER_BAND_HEIGHT),三個數字與 PlanOverlayPanelWide.module.css 的
// .panel 同一組,常數見 planOverlayGeometry.ts。passThrough 收下但不使用(側欄版面不支援)。
export function PlanOverlayLayout({ mapBackground, safeAreaRef, composer, children }: AiPlanOverlayLayoutProps) {
  return (
    <>
      {mapBackground && (
        <div {...slotAttr(OVERLAY_SLOT.mapLayer)} className={styles.mapLayer}>
          {mapBackground}
        </div>
      )}
      <div
        {...slotAttr(OVERLAY_SLOT.safeArea)}
        ref={safeAreaRef}
        style={{ position: 'absolute', top: SIDEBAR_TOP, left: 0, bottom: COMPOSER_BAND_HEIGHT, right: SIDEBAR_WIDTH, pointerEvents: 'none' }}
        aria-hidden="true"
      />
      <PlanOverlayPanel composer={composer}>{children}</PlanOverlayPanel>
    </>
  )
}
