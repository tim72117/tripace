import { useState, type ReactNode, type Ref } from 'react'
import { ComposerSlotContext, OVERLAY_SLOT, slotAttr } from './overlayDom'
// OverlayShell——手機版「地圖加疊加 UI」外殼的共用實作。/ai-plan(home/plan-ai-sim/phone/PlanOverlayLayout)
// 與登入後手機版(src/phone/PlanOverlayLayout)、登入後桌面版(src/desktop/PlanOverlayLayout)各寫一份幾乎相同的程式,現在相同的部分收在這裡:
//
//   map-layer          地圖層(mapBackground)
//   controls-slot      地圖控制項插槽
//   overlay            疊加層(可整個 hidden)
//     ├─ safe-area     看不見的「地圖主顯示區」(overlay 座標系裡的矩形,各入口用自己的 CSS 標出範圍)
//     └─ panel         規劃面板
//          ├─ (children)     時間軸等內容
//          └─ composer-slot  輸入列插槽
//
// 共用的內容:DOM 骨架(data-slot,見 overlayDom.ts)、輸入列插槽元素的狀態與 ComposerSlotContext
// (內容元件用 ComposerPortal 把輸入列傳送進 composer-slot)、控制項插槽與安全區的 ref 接法。
//
// 各邊特有的東西由呼叫端決定,不寫死在這裡:
//   - 樣式:classNames(位置、尺寸、z-index、事件穿透都在各自的 CSS Module)。
//   - overlayStart:overlay 裡面板之前的東西(/ai-plan 的導覽列佔位)。
//   - overlayEnd:overlay 裡面板之後的東西,是 render prop,會拿到 overlay、panel、composer-slot 三個
//     元素(登入後的除錯疊圖要量它們的範圍)。
//   - open:疊加層是否顯示(登入後手機用 hidden 保持掛載);沒傳就一律顯示。
//   - composer:composer-slot 的內容(/ai-plan 模擬層的假輸入框);真實層的輸入框走 ComposerSlotContext。
//   - showControlsSlot:要不要渲染控制項插槽。
export interface OverlayClassNames {
  mapLayer: string
  controlsSlot: string
  overlay: string
  panel: string
  safeArea: string
  composerSlot: string
}

export interface OverlayElements {
  overlayEl: HTMLDivElement | null
  panelEl: HTMLDivElement | null
  composerSlotEl: HTMLDivElement | null
}

export interface OverlayShellProps {
  classNames: OverlayClassNames
  // 地圖層內容;沒傳就不渲染 map-layer。
  mapBackground?: ReactNode
  showControlsSlot?: boolean
  onControlsSlotChange?: (el: HTMLDivElement | null) => void
  open?: boolean
  safeAreaRef?: Ref<HTMLDivElement>
  overlayStart?: ReactNode
  overlayEnd?: (els: OverlayElements) => ReactNode
  composer?: ReactNode
  children?: ReactNode
}

export function OverlayShell({
  classNames,
  mapBackground,
  showControlsSlot = true,
  onControlsSlotChange,
  open = true,
  safeAreaRef,
  overlayStart,
  overlayEnd,
  composer,
  children,
}: OverlayShellProps) {
  // 用 state 而不是 ref:掛載後才會觸發重新渲染,把元素交給 context 與 overlayEnd。
  const [composerSlotEl, setComposerSlotEl] = useState<HTMLDivElement | null>(null)
  const [overlayEl, setOverlayEl] = useState<HTMLDivElement | null>(null)
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null)

  return (
    <ComposerSlotContext.Provider value={composerSlotEl}>
      {mapBackground && (
        <div {...slotAttr(OVERLAY_SLOT.mapLayer)} className={classNames.mapLayer}>
          {mapBackground}
        </div>
      )}
      {showControlsSlot && (
        <div {...slotAttr(OVERLAY_SLOT.controlsSlot)} className={classNames.controlsSlot} ref={onControlsSlotChange} />
      )}
      <div {...slotAttr(OVERLAY_SLOT.overlay)} className={classNames.overlay} hidden={!open} ref={setOverlayEl}>
        {overlayStart}
        {/* safe-area 是 overlay 的直接子節點(不在 panel 裡):它標的是「沒被面板蓋住的地圖範圍」,用 overlay 的座標系
            (手機:面板上方;側欄版面:側欄左邊),不依賴面板自己的尺寸,四個入口才能用同一種方式標示。 */}
        <div {...slotAttr(OVERLAY_SLOT.safeArea)} className={classNames.safeArea} ref={safeAreaRef} aria-hidden="true" />
        <div {...slotAttr(OVERLAY_SLOT.panel)} className={classNames.panel} ref={setPanelEl}>
          {children}
          <div {...slotAttr(OVERLAY_SLOT.composerSlot)} className={classNames.composerSlot} ref={setComposerSlotEl}>
            {composer}
          </div>
        </div>
        {overlayEnd?.({ overlayEl, panelEl, composerSlotEl })}
      </div>
    </ComposerSlotContext.Provider>
  )
}
