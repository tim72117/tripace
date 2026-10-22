import type { PlanStopMarker } from '../../usePlanStopMarkers'
import type { FeatureLayer } from '../types'

// routeLineLayer——「整條路線」功能層(對應舊的 usePlanRouteLine)。
//
// 按 stops 陣列本身的順序連成一條 polyline,不重新排序:呼叫端傳入時已是時間軸順序。
// 關閉或不足兩個點連不成線時回空陣列,宿主會把已畫的線移除。
// 顏色由呼叫端用 useAccentColor 取得後傳入,功能層本身不讀地圖(也不碰 google.maps)。
// 疊放順序只用 group 'routeLine',數值集中在 zOrder.ts(舊 hook 的 996 只是相對值)。
// 樣式數值與舊 hook 一致:實線、不透明度 0.85、粗細 3。
export function routeLineLayer(input: {
  stops: Pick<PlanStopMarker, 'id' | 'lat' | 'lng'>[]
  enabled: boolean
  accentColor: string
}): FeatureLayer {
  const { stops, enabled, accentColor } = input
  if (!enabled || stops.length < 2) return { id: 'routeLine', drawables: [] }
  return {
    id: 'routeLine',
    drawables: [
      {
        id: 'line',
        group: 'routeLine',
        kind: 'polyline',
        path: stops.map((s) => ({ lat: s.lat, lng: s.lng })),
        options: { strokeColor: accentColor, strokeOpacity: 0.85, strokeWeight: 3 },
      },
    ],
  }
}
