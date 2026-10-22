import type { PlanStopMarker } from '../../usePlanStopMarkers'
import type { FeatureLayer } from '../types'

// transitHoverLineLayer——滑鼠懸停在時間軸「交通膠囊」時,連接這段交通兩端站點的虛線。
// 取代 usePlanTransitHoverLine(純資料版本:不碰 google.maps,實例重用、重掛、清理都交給宿主)。
//
// 虛線用 strokeOpacity: 0 搭配 icons 沿路徑重複鋪一小段實線 symbol:Polyline 沒有原生 dashed
// 線型,這是官方文件記載的標準做法。樣式數值與舊 hook 逐項一致。
// 強調色由呼叫端傳入(useAccentColor),所以主題切換時 icons 顏色會變,宿主以 setOptions 原地更新。
//
// 站點只用到 id/lat/lng,型別借用 PlanStopMarker(與 usePlanStopMarkers 同一份資料)。
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
    path: [
      { lat: from.lat, lng: from.lng },
      { lat: to.lat, lng: to.lng },
    ],
    options: {
      strokeOpacity: 0,
      icons: [
        {
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: accentColor, scale: 3 },
          offset: '0',
          repeat: '12px',
        },
      ],
    },
  })
  return layer
}
