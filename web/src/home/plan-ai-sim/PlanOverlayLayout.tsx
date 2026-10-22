import type { ReactNode, Ref } from 'react'
import { OverlayShell, type OverlayClassNames } from '../../plan-core/OverlayShell'
import { PlanOverlayPanel } from './PlanOverlayPanel'
import type { PlanOverlayLayoutContract } from '../../plan-core/layerContracts'
import { OVERLAY_SLOT, slotAttr } from '../../plan-core/overlayDom'
import styles from './PlanOverlayLayout.module.css'
import { COMPOSER_BAND_HEIGHT, SIDEBAR_TOP, SIDEBAR_WIDTH } from './planOverlayGeometry'
import panelStyles from './PlanOverlayPanel.module.css'

// PlanOverlayLayout——/ai-plan 的「地圖加疊加 UI」外殼元件,對應登入後手機版的 PlanOverlayLayout
// (同一個層級、同一套 data-slot 骨架,見 plan-core/overlayDom.ts):
//
//   容器(PlanLayout 渲染)
//   ├─ nav                      漂浮導覽列,不屬於這個外殼
//   └─ PlanOverlayLayout(本元件,三塊都由它渲染)
//        ├─ map-layer           地圖層(mapBackground)
//        ├─ controls-slot       地圖控制項插槽(手機版才有;目前是空的)
//        └─ overlay > panel     疊加面板(手機版交給共用的 OverlayShell;桌面、wide 交給 PlanOverlayPanel 的側欄版面)
//
// 為什麼獨立出來:原本 map-layer 與 controls-slot 直接寫在 PlanLayout 裡,疊加面板在
// PlanOverlayPanel,同一套骨架散在兩個元件,和登入後「一個外殼元件包地圖層、控制項插槽、疊加層」
// 的切分不一致。這個元件把三塊收在同一個層級,PlanLayout 只剩容器、nav 與除錯疊圖。
//
// 桌面(isDesktop、非 wide)與 wide 是側欄版面,沒有手機版的 controls-slot 與 overlay 外殼,
// 維持原本結構(面板與輸入列插槽同層)。
export interface PlanOverlayLayoutProps extends PlanOverlayLayoutContract {
  // mapBackground(契約 PlanOverlayLayoutContract 定義):地圖層內容(NativeMapBase 等,PlanMap 就放這裡)。
  wide?: boolean
  isDesktop: boolean
  safeAreaRef: Ref<HTMLDivElement>
  passThrough?: boolean
  composer?: ReactNode
  // 控制項插槽元素(手機版):與登入後的 PlanOverlayLayout 同名同語意。/ai-plan 目前沒有使用端。
  onControlsSlotChange?: (el: HTMLDivElement | null) => void
}

export function PlanOverlayLayout({
  mapBackground,
  wide = false,
  isDesktop,
  safeAreaRef,
  passThrough,
  composer,
  onControlsSlotChange,
  children,
}: PlanOverlayLayoutProps) {
  // 手機版:骨架與插槽邏輯在共用的 OverlayShell(與登入後手機版同一份),這裡只提供 /ai-plan 的
  // 樣式與特有項目——導覽列佔位(overlayStart)與 passThrough(讓空白處的手勢穿透到地圖)。
  if (!isDesktop && !wide) {
    return (
      <OverlayShell
        classNames={{
          mapLayer: styles.mapLayer,
          controlsSlot: styles.controlsSlot,
          overlay: panelStyles.overlay,
          panel: passThrough ? `${panelStyles.panel} ${panelStyles.passThrough}` : panelStyles.panel,
          safeArea: panelStyles.safeArea,
          composerSlot: panelStyles.composerSlotMobile,
        } satisfies OverlayClassNames}
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

  // 桌面(側欄)與 wide:沒有 controls-slot 與 overlay 外殼,維持原結構。
  return (
    <>
      {mapBackground && (
        <div {...slotAttr(OVERLAY_SLOT.mapLayer)} className={styles.mapLayer}>
          {mapBackground}
        </div>
      )}
      {/* wide 的安全區:與其他入口同一種標示——帶 data-slot="safe-area" 的看不見節點,safeAreaRef 接在它身上
          (useMapSafeArea 讀它算鏡頭中心)。範圍是「沒被側欄與導覽列、composer 帶蓋住的地圖」:左側剩餘空間
          (使用者明確指出「安全區是左側剩餘空間」),top 讓出漂浮導覽列(SIDEBAR_TOP)、right 讓出側欄
          (SIDEBAR_WIDTH)、bottom 讓出 composer 帶(COMPOSER_BAND_HEIGHT),三個數字與 PlanOverlayPanelWide.module.css
          的 .panel 同一組,常數見 planOverlayGeometry.ts(原本是 plan-ai-sim/Content 裡的一個 inline div,2026-10 收進外殼)。
          非 wide 桌面沒有這個節點(useMapSafeArea 沒有目標元素時退回整張地圖),與手機版互斥,不會有兩個元素搶同一個 ref。 */}
      {wide && (
        <div
          {...slotAttr(OVERLAY_SLOT.safeArea)}
          ref={safeAreaRef}
          style={{ position: 'absolute', top: SIDEBAR_TOP, left: 0, bottom: COMPOSER_BAND_HEIGHT, right: SIDEBAR_WIDTH, pointerEvents: 'none' }}
          aria-hidden="true"
        />
      )}
      <PlanOverlayPanel wide={wide} passThrough={passThrough} composer={composer}>
        {children}
      </PlanOverlayPanel>
    </>
  )
}
