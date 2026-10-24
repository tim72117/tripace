import { planStopMarkerContent, type PlanStopMarkerState } from '../../mapMarkers'
import { resolveExpandedThemeId, type HoverTransitPair, type MapMarkerPoint } from '../../marker/planStops'
import type { CircleDrawable, ContentContext, DrawGroup, Drawable, FeatureLayer, MarkerDrawable } from '../types'

// planStopLayer——行程站點圓點功能層(2026-10 從獨立的站點圖層 hook 遷移進統一繪製層 map/draw/;資料模型在 map/marker/planStops.ts)。
// 純函式:把站點資料與「選中、hover」狀態轉成要畫的東西,不碰 google.maps。
//
// 畫什麼:
//   - 每個站點一個圓點 marker。外觀三態(base、hover、selected),狀態寫進 contentKey 與疊放群組:
//     選中蓋過一般站點、hover 再蓋過選中(群組數值在 zOrder.ts)。
//   - 選中主題點(或它的子景點)時,另畫 200 公尺範圍圓圈,以及每個子景點一顆小圓點。
//
// 狀態規則(同舊圖層):選中優先於 hover;hoverId 與轉乘配對的兩端都算 hover;supportsHover 為
// false(手機沒有滑鼠 hover)時兩者都忽略,選中不受影響。
//
// 進場動畫:從 base 變成強調態才播,第一次建立、強調態之間互換、同狀態只換顏色都不播。功能層拿不到
// 「前一個狀態」,所以從宿主傳進來的 previousContentKey 解析(contentKey 以狀態開頭)。
//
// 點擊:先 onPointClick(id, 原本的點),再 onSelectedChange(id),同舊圖層。id 是站點原本的 id
// (宿主已幫忙去掉功能層前綴)。選取與 hover 完全由外部持有,這裡只回報意圖,不保存狀態。
const THEME_RADIUS_METERS = 200
const LAYER_ID = 'planStop'

function stateOf(
  id: string,
  { selectedId, hoverId, hoverTransitPair, supportsHover }: {
    selectedId: string | null
    hoverId: string | null
    hoverTransitPair: HoverTransitPair | null
    supportsHover: boolean
  },
): PlanStopMarkerState {
  if (id === selectedId) return 'selected'
  if (!supportsHover) return 'base'
  const viaPair = hoverTransitPair?.fromId === id || hoverTransitPair?.toId === id
  return id === hoverId || viaPair ? 'hover' : 'base'
}

const GROUP_BY_STATE: Record<PlanStopMarkerState, DrawGroup> = {
  base: 'planStop',
  selected: 'planStopSelected',
  hover: 'planStopHover',
}

function themeChildDot(color: string): HTMLElement {
  const dot = document.createElement('div')
  dot.style.width = '10px'
  dot.style.height = '10px'
  dot.style.borderRadius = '50%'
  dot.style.background = color
  dot.style.border = '2px solid #FDFCFA'
  dot.style.boxShadow = '0 1px 3px rgba(0,0,0,0.25)'
  return dot
}

export function planStopLayer({
  points,
  selectedId: selectedIdProp,
  hoverId: hoverIdProp,
  hoverTransitPair: hoverTransitPairProp,
  supportsHover = true,
  accentColor,
  onPointClick,
  onSelectedChange,
}: {
  points: MapMarkerPoint[]
  selectedId?: string | null
  hoverId?: string | null
  hoverTransitPair?: HoverTransitPair | null
  supportsHover?: boolean
  accentColor: string
  onPointClick?: (id: string, point: MapMarkerPoint) => void
  onSelectedChange?: (id: string | null) => void
}): FeatureLayer {
  const selectedId = selectedIdProp ?? null
  const hoverId = hoverIdProp ?? null
  const hoverTransitPair = hoverTransitPairProp ?? null
  const stops = points.filter((p) => p.kind !== 'themeChild')
  const drawables: Drawable[] = []

  for (const p of stops) {
    const state = stateOf(p.id, { selectedId, hoverId, hoverTransitPair, supportsHover })
    const marker: MarkerDrawable = {
      id: `stop:${p.id}`,
      group: GROUP_BY_STATE[state],
      kind: 'marker',
      position: { lat: p.lat, lng: p.lng },
      title: p.name,
      // 圓點的圓心就是座標(見 types.ts 的 anchor 說明;2026-10-24 修正連線端點與圓點對不齊)。
      anchor: 'center',
      contentKey: `${state}|${accentColor}|${p.glyph ?? ''}|${p.size ?? ''}`,
      createContent: (ctx?: ContentContext) => {
        const previousState = ctx?.previousContentKey?.split('|')[0]
        const entering = previousState === 'base' && state !== 'base'
        return planStopMarkerContent(state, accentColor, entering, p.glyph, p.size)
      },
      clickable: true,
      onClick: () => {
        onPointClick?.(p.id, p)
        onSelectedChange?.(p.id)
      },
    }
    drawables.push(marker)
  }

  const expandedId = resolveExpandedThemeId(selectedId, stops)
  const expanded = expandedId != null ? stops.find((p) => p.id === expandedId) : undefined
  if (expanded) {
    const circle: CircleDrawable = {
      id: 'theme-circle',
      group: 'planStopChild',
      kind: 'circle',
      center: { lat: expanded.lat, lng: expanded.lng },
      radiusMeters: THEME_RADIUS_METERS,
      options: {
        strokeColor: accentColor,
        strokeOpacity: 0.5,
        strokeWeight: 1.5,
        fillColor: accentColor,
        fillOpacity: 0.12,
      },
    }
    drawables.push(circle)
    for (const child of expanded.children ?? []) {
      drawables.push({
        id: `child:${child.id}`,
        group: 'planStopChild',
        kind: 'marker',
        position: { lat: child.lat, lng: child.lng },
        title: child.name,
        anchor: 'center',
        contentKey: `theme-child-dot|${accentColor}`,
        createContent: () => themeChildDot(accentColor),
      })
    }
  }

  return { id: LAYER_ID, drawables }
}
