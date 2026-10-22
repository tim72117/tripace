import { useState } from 'react'
import { OVERLAY_SLOT } from '../plan-core/overlayDom'
import { DebugDot as Dot, DebugFrame as Frame, rectOf, rel, useMeasureOnLayoutChange } from '../plan-core/debugOverlayParts'
import type { Rect } from '../phone/layoutDebugGeometry'

// PlanLayoutDebugOverlay(src/desktop/)——開發工具:標示登入後桌面版「規劃」疊加層各區塊的實際範圍,用
// ?debugSafeArea=1 開啟(見 layoutDebugFlag.ts),與手機版(src/phone/PlanLayoutDebugOverlay)、/ai-plan 的
// SafeAreaDebugOverlay / WideLayoutDebugOverlay 同一個開關、同一組繪製零件(plan-core/debugOverlayParts)。
// 同層同功能同檔名、放不同目錄。
//
// 跟手機版一樣畫「DOM 實際量到的範圍」(getBoundingClientRect + ResizeObserver),不抄幾何常數當預期值。
// 地圖安全區直接量 overlay 底下的 data-slot="safe-area" 節點——四個入口都用這個節點標示安全區。
//
// 標示的區塊:
//   - 藍色框:overlay(疊在 DesktopMain 上的透明座標系)
//   - 紫色框:panel(側欄,內容是 PlanPanelContent)
//   - 橙色框:composer 插槽(輸入列 portal 進來的位置);尚未有內容時高度為 0
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

export function PlanLayoutDebugOverlay({
  overlayEl,
  panelEl,
  composerEl,
}: {
  overlayEl: HTMLElement | null
  panelEl: HTMLElement | null
  composerEl: HTMLElement | null
}) {
  const [boxes, setBoxes] = useState<Boxes>(EMPTY)

  // 安全區節點:overlay 的直接子節點(四個入口都用這個節點標示安全區,見 plan-core/overlayDom.ts)。
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
