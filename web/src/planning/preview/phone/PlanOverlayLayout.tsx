import { lazy, Suspense } from 'react'
import { OverlayShell, type OverlayClassNames } from '../../shared/OverlayShell'
import { isLayoutDebugEnabled } from '../../../layoutDebugFlag'
import type { AiPlanOverlayLayoutProps } from '../overlayLayoutProps'
import styles from '../PlanOverlayLayout.module.css'
import panelStyles from '../PlanOverlayPanel.module.css'

// 除錯疊圖(?debugSafeArea=1,見 layoutDebugFlag.ts)——2026-10 新增,
// 跟登入後手機版(planning/member/phone/PlanOverlayLayout.tsx)同一套
// 做法、同檔名放不同目錄(見該檔案的完整說明)。先前 /ai-plan 只有
// SafeAreaDebugOverlay(地圖安全區,常數/投影計算)跟 WideLayoutDebugOverlay
// (wide 版面,用 planOverlayGeometry.ts 的寫死常數對照畫框線)兩個疊圖,
// 手機版跟桌面疊加版(768–1023px)完全沒有對應的版面骨架疊圖——這兩種
// 裝置的版面大多是 flex 動態撐出來的,沒有常數可以對照,只能跟登入後
// 一樣改用 getBoundingClientRect()+ResizeObserver 即時量測實際 DOM
// 範圍(見 LayoutDebugOverlay.tsx 的完整說明)。
const LayoutDebugOverlay = lazy(() =>
  import('./LayoutDebugOverlay').then((m) => ({ default: m.LayoutDebugOverlay })),
)

// PlanOverlayLayout(/ai-plan 手機版,planning/preview/phone/)——「地圖加疊加 UI」外殼。
//
// /ai-plan 的 PlanOverlayLayout 依螢幕分成三個實體,同名同介面(AiPlanOverlayLayoutProps),放在不同子目錄,
// 由 Content 依 isDesktop、isWide 擇一渲染:phone/(這裡)、desktop/(768–1023px 的疊加版面)、wide/(≥1024px 的側欄版面)。
// 登入後也是同一種切法(phone/、desktop/ 各一個入口)。
//
// 手機版交給共用的 OverlayShell(與登入後手機版同一份骨架,見 planning/shared/overlayDom.ts):
//   map-layer → controls-slot → overlay(導覽列佔位、safe-area、panel(children、composer-slot))
// 這一份特有的是 /ai-plan 的樣式,以及 passThrough(讓空白處的手勢穿透到地圖)。
// panel 一律掛 .fuse:推論態的詢問匡與下方輸入列無縫拼成一體(規則見 PlanOverlayPanel.module.css .fuse,
// 只認 AskShell 的 data-ask-part 與 Composer 的 data-composer-part 掛點,兩邊同時存在才生效;只在手機寬度、
// 支援 :has 的瀏覽器套用。沒有詢問頁、純文字對話氣泡、播放態時規則不命中,外觀不變)。
// onControlsSlotChange:控制項插槽元素(與登入後手機同名同語意);/ai-plan 目前沒有使用端。
export interface PlanOverlayLayoutProps extends AiPlanOverlayLayoutProps {
  onControlsSlotChange?: (el: HTMLDivElement | null) => void
}

const CLASS_NAMES = {
  mapLayer: styles.mapLayer,
  controlsSlot: styles.controlsSlot,
  overlay: panelStyles.overlay,
  panel: `${panelStyles.panel} ${panelStyles.fuse}`,
  safeArea: panelStyles.safeArea,
  composerSlot: panelStyles.composerSlotMobile,
} satisfies OverlayClassNames

const PASS_THROUGH_CLASS_NAMES = {
  ...CLASS_NAMES,
  panel: `${panelStyles.panel} ${panelStyles.fuse} ${panelStyles.passThrough}`,
} satisfies OverlayClassNames

export function PlanOverlayLayout({
  mapBackground,
  safeAreaRef,
  passThrough,
  composer,
  onControlsSlotChange,
  children,
}: PlanOverlayLayoutProps) {
  const classNames = passThrough ? PASS_THROUGH_CLASS_NAMES : CLASS_NAMES
  const debug = isLayoutDebugEnabled(window.location.search)
  return (
    <OverlayShell
      classNames={classNames}
      mapBackground={mapBackground}
      onControlsSlotChange={onControlsSlotChange}
      safeAreaRef={safeAreaRef}
      overlayStart={<div className={panelStyles.navSpacer} aria-hidden="true" />}
      composer={composer}
      overlayEnd={
        debug
          ? ({ overlayEl, panelEl, composerSlotEl }) => (
              <Suspense fallback={null}>
                <LayoutDebugOverlay overlayEl={overlayEl} panelEl={panelEl} composerEl={composerSlotEl} />
              </Suspense>
            )
          : undefined
      }
    >
      {children}
    </OverlayShell>
  )
}
