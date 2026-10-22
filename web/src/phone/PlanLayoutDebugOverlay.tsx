import { useState } from 'react'
import { solvePhoneLayoutDebug, type PhoneLayoutDebug, type Rect } from './layoutDebugGeometry'
import { panelContentRoot } from '../plan-core/overlayDom'
import { DebugDot as Dot, DebugFrame as Frame, DEBUG_LABEL_FONT as LABEL_FONT, rectOf, rel, useMeasureOnLayoutChange } from '../plan-core/debugOverlayParts'

// PlanLayoutDebugOverlay——開發工具:標示 /app 手機版「規劃」疊加面板
// (PlanOverlayLayout)各區塊的實際範圍,用 ?debugSafeArea=1 開啟
// (見 layoutDebugFlag.ts),與 /ai-plan 的 SafeAreaDebugOverlay /
// WideLayoutDebugOverlay 同一個開關。
//
// 跟那兩個不同:它們畫的是「依幾何常數算出來的預期範圍」,這個畫的是
// 「DOM 實際量到的範圍」(getBoundingClientRect + ResizeObserver)。/app
// 這邊的版面不靠寫死的常數(底部讓開 tab bar 的高度由 phone/Content 量出來寫進
// --tab-bar-height),抄一份常數當預期值反而會和真實版面漂移——直接量。
//
// 標示的區塊:
//   - 藍色框:overlay 整體(疊在滿版地圖上的容器)
//   - 紫色框:panel(TripPlanPage 的內容區)
//   - 紅色框:時間軸(面板內容子元素的聯集,計算見 layoutDebugGeometry.ts)
//   - 橙色框:composer 插槽(輸入列 portal 進來的位置);尚未有內容時高度為 0
//   - 黃色網底:overlay 底下讓開給 phone/Nav 的帶狀範圍
//   - 綠色框 + 綠點:安全區(沒被時間軸/composer 擋住的區域)與它的中心
//   - 藍點:地圖中心(地圖容器的中心點,即地圖「中心座標」落在螢幕的位置)
//   - 橘色箭頭:藍點指向綠點,就是 delta——要讓地圖上的目標點落在可視區
//     中心需要的位移。/app 目前沒有 panToWithinSafeArea,這個數字用來核對
//     「對齊 ai-plan」時兩邊的幾何一致。
// pointer-events: none——純視覺標記,不攔截任何互動。

const COLORS = {
  overlay: '#3b82f6',
  panel: '#a855f7',
  timeline: '#ef4444',
  composer: '#f97316',
  tabBar: '#eab308',
  safe: '#16a34a',
  map: '#2563eb',
}

type Boxes = {
  overlay: Rect | null
  panel: Rect | null
  composer: Rect | null
  tabBar: Rect | null
  geo: PhoneLayoutDebug | null
}

const EMPTY: Boxes = { overlay: null, panel: null, composer: null, tabBar: null, geo: null }

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

  useMeasureOnLayoutChange(overlayEl, [panelEl, composerEl], () => {
    if (!overlayEl) return
    const origin = rectOf(overlayEl)
    // overlay 隱藏(display: none)時量到全 0,不畫。
    if (!origin || (origin.width === 0 && origin.height === 0)) {
      setBoxes(EMPTY)
      return
    }
    // tab bar 讓開的帶狀範圍 = overlay 父層(.container)底緣減 overlay 底緣。
    const parent = rectOf(overlayEl.parentElement)
    const gap = parent ? Math.max(0, parent.top + parent.height - (origin.top + origin.height)) : 0
    // 地圖容器:Google Maps 在地圖 div 內建 .gm-style,與地圖 div 同範圍。
    const mapRect = rectOf(overlayEl.parentElement?.querySelector('.gm-style'))
    // 時間軸 = TripPlanPage 根元素(panel 裡第一個非骨架節點,見 panelContentRoot:略過 safe-area 洞)
    // 底下的內容子元素。composer 是 portal 進 composerSlot 的,不在這個根元素裡。
    const timelineChildRects = Array.from(panelContentRoot(panelEl)?.children ?? [])
      .map((c) => rectOf(c))
      .filter((r): r is Rect => r !== null)
    const geo = solvePhoneLayoutDebug({ origin, mapRect, timelineChildRects, composerRect: rectOf(composerEl) })
    setBoxes({
      overlay: { top: 0, left: 0, width: origin.width, height: origin.height },
      panel: rel(rectOf(panelEl), origin),
      composer: rel(rectOf(composerEl), origin),
      tabBar: gap > 0 ? { top: origin.height, left: 0, width: origin.width, height: gap } : null,
      geo,
    })
  })

  const geo = boxes.geo
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 50, overflow: 'visible' }}>
      {boxes.overlay && <Frame box={boxes.overlay} color={COLORS.overlay} label="overlay" />}
      {boxes.panel && <Frame box={boxes.panel} color={COLORS.panel} label="panel" />}
      {boxes.composer && <Frame box={boxes.composer} color={COLORS.composer} label="composer" />}
      {geo?.timeline && <Frame box={geo.timeline} color={COLORS.timeline} label="timeline" />}
      {boxes.tabBar && (
        <div
          style={{
            position: 'absolute',
            top: boxes.tabBar.top,
            left: 0,
            width: boxes.tabBar.width,
            height: boxes.tabBar.height,
            background:
              'repeating-linear-gradient(45deg, rgba(234, 179, 8, 0.25), rgba(234, 179, 8, 0.25) 6px, rgba(234, 179, 8, 0.08) 6px, rgba(234, 179, 8, 0.08) 12px)',
            border: `2px dashed ${COLORS.tabBar}`,
            boxSizing: 'border-box',
            color: '#1c1815',
            font: LABEL_FONT,
            padding: '2px 6px',
          }}
        >
          tab bar 讓開 {Math.round(boxes.tabBar.height)}px
        </div>
      )}
      {geo && (
        <>
          <div
            style={{
              position: 'absolute',
              top: geo.safeRect.top,
              left: geo.safeRect.left,
              width: geo.safeRect.width,
              height: geo.safeRect.height,
              border: `2px dashed ${COLORS.safe}`,
              background: 'rgba(34,197,94,.07)',
              boxSizing: 'border-box',
            }}
          />
          {geo.mapCenter && (
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
              <defs>
                <marker id="phoneDbgArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M0,0 L10,5 L0,10 z" fill="#f97316" />
                </marker>
              </defs>
              <line
                x1={geo.mapCenter.x}
                y1={geo.mapCenter.y}
                x2={geo.safeCenter.x}
                y2={geo.safeCenter.y}
                stroke="#f97316"
                strokeWidth="2"
                strokeDasharray="5 4"
                markerEnd="url(#phoneDbgArrow)"
              />
            </svg>
          )}
          <Dot p={geo.safeCenter} color={COLORS.safe} label="safeCenter" />
          {geo.mapCenter && <Dot p={geo.mapCenter} color={COLORS.map} label="mapCenter" />}
          <div
            style={{
              position: 'absolute',
              right: 8,
              top: 8,
              padding: '8px 10px',
              borderRadius: 8,
              background: 'rgba(17,24,39,.88)',
              color: '#f9fafb',
              font: '500 11px/1.7 ui-monospace, monospace',
              whiteSpace: 'pre',
            }}
          >
            {[
              `safeRect   ${geo.safeRect.width.toFixed(0)}×${geo.safeRect.height.toFixed(0)}`,
              `timeline   ${geo.timeline ? `${geo.timeline.width.toFixed(0)}×${geo.timeline.height.toFixed(0)} @ y${geo.timeline.top.toFixed(0)}` : '無'}`,
              `delta      ${geo.delta ? `${geo.delta.x.toFixed(1)}, ${geo.delta.y.toFixed(1)} px` : '找不到地圖'}`,
            ].join('\n')}
          </div>
        </>
      )}
    </div>
  )
}
