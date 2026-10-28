import { useState } from 'react'
import { OVERLAY_SLOT } from '../../shared/overlayDom'
import { DebugDot as Dot, DebugFrame as Frame, rectOf, rel, useMeasureOnLayoutChange } from '../../shared/debugOverlayParts'
import type { Rect } from '../../member/phone/layoutDebugGeometry'

// LayoutDebugOverlay(/ai-plan 手機版,planning/preview/phone/)——開發工具:
// 標示手機版「地圖加疊加 UI」外殼(PlanOverlayLayout,靠共用的 OverlayShell
// 組出骨架)各區塊的實際範圍,用 ?debugSafeArea=1 開啟(見 layoutDebugFlag.ts)。
//
// 與登入後手機版(planning/member/phone/PlanLayoutDebugOverlay)、desktop
// 版(planning/member/desktop/PlanLayoutDebugOverlay)、同目錄 wide 版
// (planning/preview/wide/WideLayoutDebugOverlay)同一個開關、同一組繪製零件
// (planning/shared/debugOverlayParts)。同層同功能同檔名、放不同目錄。
//
// 2026-10 新增(原本 /ai-plan 只有 SafeAreaDebugOverlay、WideLayoutDebugOverlay
// 兩個疊圖,手機版跟桌面疊加版完全沒有對應的版面骨架疊圖):這個頁面的
// 手機版版面(PlanOverlayPanel.module.css .panel/.composerSlotMobile)大多
// 是 flex 動態值,沒有像 wide 版 planOverlayGeometry.ts 那樣的常數可以對照
// 畫出預期範圍,改用跟登入後完全同款的做法——getBoundingClientRect +
// ResizeObserver 量 DOM 實際範圍,不抄幾何常數當預期值。
//
// 跟 wide 版(登入後桌面版同款)不同的是:這裡的安全區節點是
// data-slot="safe-area",直接量它的實際範圍即可(與桌面版 PlanOverlayLayout.tsx
// 的做法一致),不需要像 /app 手機版那樣用時間軸卡片聯集推算——/ai-plan
// 手機版的 safe-area 本來就有固定節點(OverlayShell 渲染出來,見
// planning/shared/OverlayShell.tsx 的完整說明)。
//
// 標示的區塊:
//   - 藍色框:overlay(疊在地圖上的透明座標系)
//   - 紫色框:panel(卡片列,內容是 HorizontalPlanTimeline)
//   - 橙色框:composer 插槽(輸入列/推論態詢問頁的位置);尚未有內容時高度為 0
//   - 綠色框 + 綠點:安全區(safe-area 節點的範圍)與它的中心
//   - 藍點:地圖中心
// pointer-events: none——純視覺標記,不攔截任何互動。

const COLORS = {
  overlay: '#3b82f6',
  panel: '#a855f7',
  composer: '#f97316',
  safe: '#16a34a',
  map: '#2563eb',
}

type Boxes = {
  overlay: Rect | null
  panel: Rect | null
  composer: Rect | null
  safe: Rect | null
  mapCenter: { x: number; y: number } | null
}

const EMPTY: Boxes = { overlay: null, panel: null, composer: null, safe: null, mapCenter: null }

export function LayoutDebugOverlay({
  overlayEl,
  panelEl,
  composerEl,
}: {
  overlayEl: HTMLElement | null
  panelEl: HTMLElement | null
  composerEl: HTMLElement | null
}) {
  const [boxes, setBoxes] = useState<Boxes>(EMPTY)

  // 安全區節點:overlay 的直接子節點(四個入口都用這個節點標示安全區,見 planning/shared/overlayDom.ts)。
  const safeEl = overlayEl?.querySelector(`:scope > [data-slot="${OVERLAY_SLOT.safeArea}"]`) ?? null
  useMeasureOnLayoutChange(overlayEl, [panelEl, composerEl, safeEl], () => {
    if (!overlayEl) return
    const origin = rectOf(overlayEl)
    // overlay 隱藏(display: none)時量到全 0,不畫。
    if (!origin || (origin.width === 0 && origin.height === 0)) {
      setBoxes(EMPTY)
      return
    }
    // 地圖中心:Google Maps 在地圖 div 內建 .gm-style,與地圖 div 同範圍。
    const mapRect = rectOf(overlayEl.parentElement?.querySelector('.gm-style'))
    const mapRel = mapRect ? rel(mapRect, origin) : null
    setBoxes({
      overlay: { top: 0, left: 0, width: origin.width, height: origin.height },
      panel: rel(rectOf(panelEl), origin),
      composer: rel(rectOf(composerEl), origin),
      safe: rel(rectOf(safeEl), origin),
      mapCenter: mapRel ? { x: mapRel.left + mapRel.width / 2, y: mapRel.top + mapRel.height / 2 } : null,
    })
  })

  const safe = boxes.safe
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 50, overflow: 'visible' }}>
      {boxes.overlay && <Frame box={boxes.overlay} color={COLORS.overlay} label="overlay" />}
      {boxes.panel && <Frame box={boxes.panel} color={COLORS.panel} label="panel" />}
      {boxes.composer && <Frame box={boxes.composer} color={COLORS.composer} label="composer" />}
      {safe && (
        <>
          <div
            style={{
              position: 'absolute',
              top: safe.top,
              left: safe.left,
              width: safe.width,
              height: safe.height,
              border: `2px dashed ${COLORS.safe}`,
              background: 'rgba(34,197,94,.07)',
              boxSizing: 'border-box',
            }}
          />
          <Dot p={{ x: safe.left + safe.width / 2, y: safe.top + safe.height / 2 }} color={COLORS.safe} label="safeCenter" />
        </>
      )}
      {boxes.mapCenter && <Dot p={boxes.mapCenter} color={COLORS.map} label="mapCenter" />}
    </div>
  )
}
