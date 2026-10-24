// planOverlayGeometry.ts — PlanOverlayPanel wide 側欄版面的幾何常數單一
// 來源。2026-10(code review 發現:側欄幾何常數在三處手動複製——
// PlanOverlayPanelWide.module.css、planning/preview/Content.tsx 的安全區矩形
// 內聯樣式、WideLayoutDebugOverlay.tsx 的除錯疊圖——且這個重複在同一輪
// 改動裡已經造成兩次真實漂移 bug:SIDEBAR_TOP 曾經漏改一次,.panel 的
// bottom 也曾經跟 debug 框線不同步)。
//
// CSS Module 沒辦法直接 import TS 常數,所以這裡只統一 TS 這一側的兩個
// 消費者(planning/preview/Content.tsx 的安全區矩形、WideLayoutDebugOverlay.tsx
// 的除錯框線)——CSS 那一份(PlanOverlayPanelWide.module.css 的
// .panel/.composerSlot)仍然要手動保持數值一致,但現在只需要對照這一處
// 來源,不是三處互相對照。
//
// 這些數字本身的設計理由(為什麼是 72/560/20/66)記在各自原本定義處的
// 完整說明:
//   SIDEBAR_TOP——PlanOverlayPanelWide.module.css .panel top 的完整說明
//   SIDEBAR_WIDTH——PlanOverlayPanelWide.module.css .panel width 的完整說明
//   COMPOSER_BOTTOM/COMPOSER_HEIGHT——WideLayoutDebugOverlay.tsx 原本
//     COMPOSER_HEIGHT 的完整說明(66 是實機量測值,不是 CSS 寫死的理論值)

export const SIDEBAR_WIDTH = 560
export const SIDEBAR_TOP = 72
export const COMPOSER_BOTTOM = 20
export const COMPOSER_HEIGHT = 66
export const COMPOSER_SIDE_MARGIN = 24
export const COMPOSER_BAND_HEIGHT = COMPOSER_BOTTOM + COMPOSER_HEIGHT
