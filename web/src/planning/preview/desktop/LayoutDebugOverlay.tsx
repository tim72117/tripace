import { useState } from 'react'
import { DebugFrame as Frame, rectOf, useMeasureOnLayoutChange } from '../../shared/debugOverlayParts'
import type { Rect } from '../../member/phone/layoutDebugGeometry'

// LayoutDebugOverlay(/ai-plan 桌面疊加版,planning/preview/desktop/)——開發
// 工具:標示 768–1023px 疊加面板(PlanOverlayPanel)各區塊的實際範圍,用
// ?debugSafeArea=1 開啟(見 layoutDebugFlag.ts)。與同目錄 phone/
// LayoutDebugOverlay、wide/WideLayoutDebugOverlay、登入後兩個同名元件
// 同一個開關、同一組繪製零件(planning/shared/debugOverlayParts)。同層
// 同功能同檔名、放不同目錄。
//
// 2026-10 新增(原本 /ai-plan 只有手機版疊圖是這次一併補上的,桌面疊加
// 版同樣完全沒有對應的版面骨架疊圖)。跟 phone/wide 版不同:這個寬度
// 沒有安全區節點(見 desktop/PlanOverlayLayout.tsx 開頭說明:
// 「safeAreaRef 收下但不渲染節點」),也沒有 overlay 包裹容器(panel/
// composerSlot 直接是 PlanLayout .container 的手足,不像手機版
// OverlayShell 有專屬 data-slot="overlay" 這層當原點),所以:
//   - 不畫安全區框(這個寬度本來就沒有這個概念)
//   - 座標系直接用 viewport(getBoundingClientRect 本身就是 viewport
//     座標),不做任何「相對 overlay 原點」的換算——沒有 overlay 這層
//     可以當原點,疊圖用 position: fixed 鋪滿整個 viewport,框線座標
//     直接套用量到的 rect,不需要 rel()。
//
// 標示的區塊:
//   - 紫色框:panel(側欄本體,固定寬度 absolute)
//   - 橙色框:composer 插槽(輸入列/推論態詢問頁的位置);尚未有內容時高度為 0
// pointer-events: none——純視覺標記,不攔截任何互動。

const COLORS = {
  panel: '#a855f7',
  composer: '#f97316',
}

type Boxes = {
  panel: Rect | null
  composer: Rect | null
}

const EMPTY: Boxes = { panel: null, composer: null }

export function LayoutDebugOverlay({
  panelEl,
  composerEl,
}: {
  panelEl: HTMLElement | null
  composerEl: HTMLElement | null
}) {
  const [boxes, setBoxes] = useState<Boxes>(EMPTY)

  // overlayEl 參數傳 panelEl 自己——這個版面沒有專屬的 overlay 容器,
  // useMeasureOnLayoutChange 只用它的存在與否判斷要不要啟動觀察器
  // (見該函式「if (!overlayEl) return」的既有邏輯),不依賴它的尺寸
  // 當原點,這裡仍然成立(panelEl 不存在時整個疊圖本來就不該量)。
  useMeasureOnLayoutChange(panelEl, [composerEl], () => {
    setBoxes({
      panel: rectOf(panelEl),
      composer: rectOf(composerEl),
    })
  })

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 50, overflow: 'visible' }}>
      {boxes.panel && <Frame box={boxes.panel} color={COLORS.panel} label="panel" />}
      {boxes.composer && <Frame box={boxes.composer} color={COLORS.composer} label="composer" />}
    </div>
  )
}
