import { lazy, Suspense, useState } from 'react'
import { OVERLAY_SLOT, slotAttr } from '../../shared/overlayDom'
import { isLayoutDebugEnabled } from '../../../layoutDebugFlag'
import type { AiPlanOverlayLayoutProps } from '../overlayLayoutProps'
import styles from '../PlanOverlayLayout.module.css'
import { PlanOverlayPanel } from './PlanOverlayPanel'

// 除錯疊圖(?debugSafeArea=1,見 layoutDebugFlag.ts)——2026-10 新增,見
// LayoutDebugOverlay.tsx 的完整說明。
const LayoutDebugOverlay = lazy(() =>
  import('./LayoutDebugOverlay').then((m) => ({ default: m.LayoutDebugOverlay })),
)

// PlanOverlayLayout(/ai-plan 桌面疊加版面,planning/preview/desktop/)——768–1023px 的「地圖加疊加 UI」外殼。
// 三個實體的切法見 planning/member/phone/PlanOverlayLayout.tsx。
//
// 這個寬度沒有安全區節點,也沒有手機版的 controls-slot 與 overlay 外殼,維持原本結構:
//   map-layer(mapBackground) + 疊加面板 PlanOverlayPanel(面板與輸入列插槽同層手足)
// safeAreaRef 收下但不渲染節點(useMapSafeArea 沒有目標元素時退回整張地圖),與 Content 傳同一組 props。
export function PlanOverlayLayout({ mapBackground, passThrough, composer, children }: AiPlanOverlayLayoutProps) {
  // panelEl/composerEl——只給除錯疊圖用(見 PlanOverlayPanel.tsx
  // onPanelElChange/onComposerElChange 的完整說明),不開 debug 時這兩個
  // state 設了也沒有任何讀取端,不影響既有行為。
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null)
  const [composerEl, setComposerEl] = useState<HTMLDivElement | null>(null)
  const debug = isLayoutDebugEnabled(window.location.search)
  return (
    <>
      {mapBackground && (
        <div {...slotAttr(OVERLAY_SLOT.mapLayer)} className={styles.mapLayer}>
          {mapBackground}
        </div>
      )}
      <PlanOverlayPanel
        passThrough={passThrough}
        composer={composer}
        onPanelElChange={debug ? setPanelEl : undefined}
        onComposerElChange={debug ? setComposerEl : undefined}
      >
        {children}
      </PlanOverlayPanel>
      {debug && (
        <Suspense fallback={null}>
          <LayoutDebugOverlay panelEl={panelEl} composerEl={composerEl} />
        </Suspense>
      )}
    </>
  )
}
