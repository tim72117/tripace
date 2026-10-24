import { OverlayShell, type OverlayClassNames } from '../planning/shared/OverlayShell'
import type { PlanOverlayLayoutContract } from '../planning/shared/layerContracts'
import styles from './PlanOverlayLayout.module.css'

// PlanOverlayLayout(src/itineraries/)——行程詳情頁(地圖版面)的「地圖加疊加 UI」外殼。
//
// 與 /ai-plan(planning/preview/)、登入後手機(planning/member/phone/)、登入後桌面(planning/member/desktop/)的 PlanOverlayLayout 同名同層級:
// 同層同功能用同檔名、放不同目錄,各入口一個實體,都是共用 planning/shared/OverlayShell 的薄包裝,長出同一套
// data-slot 骨架(見 planning/shared/overlayDom.ts):
//   map-layer → overlay(safe-area、panel(children、composer-slot))
// 地圖放 map-layer,行程標題與時間軸放 panel。
//
// 這頁特有的部分:
//   - 沒有控制項插槽(showControlsSlot=false)與輸入列(composer-slot 是空節點)。
//   - 樣式(PlanOverlayLayout.module.css):桌面 panel 貼右側 420px,safe-area 是它左邊;手機 panel 在下方、地圖在上方 45dvh。
//   - passThrough:疊加層不攔截指標事件(共同契約的參數),Content 傳 true,地圖在面板空白處仍可拖曳。
//   - safeAreaRef:接在 safe-area 節點上,給 useMapSafeArea 之類需要「沒被面板蓋住的地圖範圍」的消費端。
export interface PlanOverlayLayoutProps extends PlanOverlayLayoutContract {
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

export function PlanOverlayLayout({ mapBackground, safeAreaRef, passThrough, children }: PlanOverlayLayoutProps) {
  return (
    <OverlayShell
      classNames={passThrough ? PASS_THROUGH_CLASS_NAMES : CLASS_NAMES}
      mapBackground={mapBackground}
      showControlsSlot={false}
      safeAreaRef={safeAreaRef}
    >
      {children}
    </OverlayShell>
  )
}
