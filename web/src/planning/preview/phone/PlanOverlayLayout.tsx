import { OverlayShell, type OverlayClassNames } from '../../shared/OverlayShell'
import type { AiPlanOverlayLayoutProps } from '../overlayLayoutProps'
import styles from '../PlanOverlayLayout.module.css'
import panelStyles from '../PlanOverlayPanel.module.css'

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
  return (
    <OverlayShell
      classNames={classNames}
      mapBackground={mapBackground}
      onControlsSlotChange={onControlsSlotChange}
      safeAreaRef={safeAreaRef}
      overlayStart={<div className={panelStyles.navSpacer} aria-hidden="true" />}
      composer={composer}
    >
      {children}
    </OverlayShell>
  )
}
