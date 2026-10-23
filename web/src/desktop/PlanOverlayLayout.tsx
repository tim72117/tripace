import { lazy, Suspense, type ReactNode } from 'react'
import { OverlayShell, type OverlayClassNames } from '../plan-core/OverlayShell'
import { isLayoutDebugEnabled } from '../layoutDebugFlag'
import type { PlanOverlayLayoutContract } from '../plan-core/layerContracts'
import styles from './PlanOverlayLayout.module.css'

// 除錯疊圖(?debugSafeArea=1,見 layoutDebugFlag.ts)——lazy 載入,沒開開關時不會被下載。與手機版
// (src/phone/PlanOverlayLayout)同一個接法:經 OverlayShell 的 overlayEnd 掛進 overlay。
const PlanLayoutDebugOverlay = lazy(() =>
  import('./PlanLayoutDebugOverlay').then((m) => ({ default: m.PlanLayoutDebugOverlay })),
)

// PlanOverlayLayout(src/desktop/)——登入後桌面版的規劃疊加層外殼。
//
// 與 /ai-plan(home/plan-ai-sim/{phone,desktop,wide}/PlanOverlayLayout.tsx)、登入後手機版(src/phone/PlanOverlayLayout.tsx)同名同層級:
// 同層同功能的元件用同檔名、放不同目錄,各入口一個實體,三份都是共用 plan-core/OverlayShell 的薄包裝,
// 長出同一套 data-slot 骨架(見 plan-core/overlayDom.ts):
//   map-layer → overlay(panel(safe-area、children、composer-slot))
// 地圖當 mapBackground 放進 map-layer,規劃面板內容放 panel,輸入列經 ComposerSlotContext 傳送進 composer-slot。
//
// 桌面版特有的部分(其餘都在共用外殼):
//   - 樣式(PlanOverlayLayout.module.css):overlay 是滿版透明座標系(position: absolute、pointer-events: none),panel 是固定寬度、
//     貼齊右緣、上下撐滿的透明側欄,地圖維持滿版;composer-slot 排在 panel 文件流最後。
//   - 沒有控制項插槽(controls-slot):桌面版的搜尋框、類別標籤原地渲染在 PlanMap 上,不經 portal。
//   - open:用 hidden 隱藏而非卸載——children 要保持掛載,避免每次開關都重連 WebSocket、丟掉對話狀態。
//     map-layer 不受影響。
//   - shifted:搜尋結果側欄(寬 340、right 12)同時顯示時,panel 往左推讓開。
//   - actions:側欄頂端的小按鈕列(路徑開關、關閉)。/ai-plan 桌面沒有標題列、面板透明,按鈕自己帶底色。
// PlanOverlayLayoutProps——滿足共同契約 PlanOverlayLayoutContract(plan-core/layerContracts.ts),加桌面特有的
// open(hidden 保持掛載)、shifted(讓開搜尋結果側欄)、actions(側欄頂端按鈕列)。
export interface PlanOverlayLayoutProps extends PlanOverlayLayoutContract {
  open: boolean
  shifted: boolean
  actions?: ReactNode
}

export function PlanOverlayLayout({
  open,
  shifted,
  passThrough,
  mapBackground,
  safeAreaRef,
  actions,
  children,
}: PlanOverlayLayoutProps) {
  const debug = isLayoutDebugEnabled(window.location.search)
  return (
    <OverlayShell
      classNames={classNamesFor(shifted, passThrough)}
      mapBackground={mapBackground}
      showControlsSlot={false}
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
      <div className={styles.actions}>{actions}</div>
      {children}
    </OverlayShell>
  )
}

export const planOverlayActionClass = styles.actionBtn

const CLASS_NAMES: OverlayClassNames = {
  mapLayer: styles.mapLayer,
  controlsSlot: styles.controlsSlot,
  overlay: styles.overlay,
  panel: styles.panel,
  safeArea: styles.safeArea,
  composerSlot: styles.composerSlot,
}

const SHIFTED_CLASS_NAMES: OverlayClassNames = {
  ...CLASS_NAMES,
  panel: `${styles.panel} ${styles.shifted}`,
  safeArea: `${styles.safeArea} ${styles.safeAreaShifted}`,
}

// classNamesFor——shifted(搜尋結果側欄同時顯示,panel 左移)與 passThrough(overlay 不接收指標事件,panel 繼承)兩個維度各自獨立。
function classNamesFor(shifted: boolean, passThrough: boolean | undefined): OverlayClassNames {
  const base = shifted ? SHIFTED_CLASS_NAMES : CLASS_NAMES
  return passThrough ? { ...base, overlay: `${styles.overlay} ${styles.passThrough}` } : base
}
