// controlsPlacement——PlanMap 內建控制項(類別標籤、城市搜尋框、搜尋錯誤訊息、
// 「搜尋這個區域」鈕)要渲染在哪裡的判斷。
//
// 2026-10(使用者明確要求手機版「把搜尋框、頭像、候選籃等都放進 UI 層」):
// 這些控制項原本寫死在 PlanMap 的 .wrap 裡,跟地圖同一個容器。手機版改成
// 用 portal 把 DOM 傳送到自己的 UI 層(PlanOverlayLayout 挖出的控制項插槽,跟規劃疊加
// 面板同一種疊加層做法:滿版、pointer-events: none、子元素設回 auto),狀態與
// 邏輯仍留在 PlanMap——模式同 planning/shared/overlayDom.ts 的 ComposerPortal。
//
// 三態用 controlsPortalTarget 的值表達,不另開 boolean:
//   - undefined:沒指定,原地渲染(桌面版與其他既有呼叫端,行為完全不變)
//   - null:指定要用 UI 層,但容器 ref 還沒掛載(React 第一次渲染時 state 為 null)。
//     這時不渲染,否則控制項會先出現在地圖內、掛載後才跳到 UI 層。
//   - HTMLElement:傳送到該容器
export type ControlsPlacement = 'inline' | 'hidden' | 'portal'

export function resolveControlsPlacement(target: HTMLElement | null | undefined): ControlsPlacement {
  if (target === undefined) return 'inline'
  if (target === null) return 'hidden'
  return 'portal'
}
