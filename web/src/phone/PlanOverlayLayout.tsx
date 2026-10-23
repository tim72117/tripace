import { lazy, Suspense } from 'react'
import { OverlayShell, type OverlayClassNames } from '../plan-core/OverlayShell'
import { isLayoutDebugEnabled } from '../layoutDebugFlag'
import type { PlanOverlayLayoutContract } from '../plan-core/layerContracts'
import styles from './PlanOverlayLayout.module.css'

// 除錯疊圖(?debugSafeArea=1,見 layoutDebugFlag.ts)——lazy 載入,沒開
// 開關時不會被下載。與 /ai-plan 的 SafeAreaDebugOverlay 同一個開關。
const PlanLayoutDebugOverlay = lazy(() =>
  import('./PlanLayoutDebugOverlay').then((m) => ({ default: m.PlanLayoutDebugOverlay })),
)

// 這個元件只剩「登入後手機版自己的樣式與特有項目」;和 /ai-plan 相同的骨架與插槽邏輯(map-layer、
// controls-slot、overlay > panel > safe-area、composer-slot,以及輸入列插槽的 ComposerSlotContext)
// 都在共用的 plan-core/OverlayShell.tsx,兩邊的同名元件 PlanOverlayLayout 都是它的薄包裝。
//
// 登入後特有的部分:
//   - 樣式(PlanOverlayLayout.module.css):overlay 是 absolute 滿版、底部讓開 phone/Nav
//     (--tab-bar-height)、pointer-events: none、z-index 2;controls-slot z-index 3,蓋過規劃面板,
//     低於地點清單抽屜等 sheet(5 以上);map-layer 刻意不設 z-index、不是 stacking context
//     (裡面的資訊卡 sheet 要能蓋過疊加層與 TabBar)。
//   - open:是否顯示。用 hidden(display: none)而非不渲染——children 要保持掛載,避免每次關閉都
//     重連 WebSocket、丟掉對話狀態。controls-slot 與 map-layer 不受 hidden 影響:規劃面板關閉時
//     搜尋框仍然要看得到。
//   - 除錯疊圖(?debugSafeArea=1)。
//   - 地圖控制項插槽:搜尋框、類別標籤、「搜尋這個區域」鈕由 PlanMap portal 進來——呼叫端經
//     onControlsSlotChange 拿到元素(phone/Content 存成 state 轉給 PlanPhoneView 的
//     controlsPortalTarget)。
//   - safe-area 洞:範圍是沒被搜尋框與底部規劃面板蓋住的地圖(樣式見 PlanOverlayLayout.module.css .safeArea),
//     呼叫端經 safeAreaRef 取得,交給 PlanPhoneView → PlanMap 的 panTarget 平移(首站、搜尋)落在這個範圍中心。
// PlanOverlayLayoutProps——滿足共同契約 PlanOverlayLayoutContract(plan-core/layerContracts.ts),加手機特有的
// open(hidden 保持掛載)、控制項插槽回報(安全區 ref 在共同契約)。
export interface PlanOverlayLayoutProps extends PlanOverlayLayoutContract {
  open: boolean
  onControlsSlotChange?: (el: HTMLDivElement | null) => void
}

export function PlanOverlayLayout({
  open,
  passThrough,
  mapBackground,
  onControlsSlotChange,
  safeAreaRef,
  children,
}: PlanOverlayLayoutProps) {
  const debug = isLayoutDebugEnabled(window.location.search)
  return (
    <OverlayShell
      classNames={passThrough ? PASS_THROUGH_CLASS_NAMES : CLASS_NAMES}
      mapBackground={mapBackground}
      onControlsSlotChange={onControlsSlotChange}
      open={open}
      safeAreaRef={safeAreaRef}
      overlayEnd={
        debug
          ? ({ overlayEl, panelEl, composerSlotEl }) => (
              <Suspense fallback={null}>
                <PlanLayoutDebugOverlay overlayEl={overlayEl} panelEl={panelEl} composerEl={composerSlotEl} />
              </Suspense>
            )
          : undefined
      }
    >
      {children}
    </OverlayShell>
  )
}

const CLASS_NAMES: OverlayClassNames = {
  mapLayer: styles.mapLayer,
  controlsSlot: styles.controlsSlot,
  overlay: styles.overlay,
  panel: styles.panel,
  safeArea: styles.safeArea,
  composerSlot: styles.composerSlot,
}

const PASS_THROUGH_CLASS_NAMES: OverlayClassNames = { ...CLASS_NAMES, overlay: `${styles.overlay} ${styles.passThrough}` }
