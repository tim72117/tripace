import type { PlanStopMarker } from '../../marker/planStops'
import type { FeatureLayer } from '../types'
import { arcPath } from './routeArc'
import { dottedLineOptions } from './routeStyle'

// transitHoverLineLayer——滑鼠懸停在時間軸「交通膠囊」時,連接這段交通兩端站點的虛線。
// 取代 usePlanTransitHoverLine(純資料版本:不碰 google.maps,實例重用、重掛、清理都交給宿主)。
//
// 2026-10 連線樣式柔化:路徑改成與整條路線同一組參數的弧線(routeArc.ts),所以虛線會準確疊在整條路線
// 對應的那一段上;線型從短橫線改成圓點(routeStyle.ts 的 dottedLineOptions),與圓頭線帽同一語言。
// 強調色由呼叫端傳入(useAccentColor),所以主題切換時 icons 顏色會變,宿主以 setOptions 原地更新。
//
// 站點只用到 id/lat/lng,型別借用 PlanStopMarker(與站點圓點同一份資料)。
export function transitHoverLineLayer(input: {
  stops: Pick<PlanStopMarker, 'id' | 'lat' | 'lng'>[]
  hoverTransitPair: { fromId: string; toId: string } | null
  accentColor: string
}): FeatureLayer {
  const { stops, hoverTransitPair, accentColor } = input
  const layer: FeatureLayer = { id: 'transitHoverLine', drawables: [] }
  if (!hoverTransitPair) return layer

  const from = stops.find((s) => s.id === hoverTransitPair.fromId)
  const to = stops.find((s) => s.id === hoverTransitPair.toId)
  // 找不到任一端就不畫,避免畫出接到 (0,0) 的錯誤線段(同舊 hook 的防禦)。
  if (!from || !to) return layer

  layer.drawables.push({
    id: 'line',
    group: 'transitHoverLine',
    kind: 'polyline',
    path: arcPath({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }),
    options: dottedLineOptions(accentColor),
  })
  return layer
}
