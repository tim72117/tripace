import { currentLocationMarkerContent } from '../../mapMarkers'
import type { FeatureLayer } from '../types'

// currentLocationLayer:目前位置藍點功能層(取代 useCurrentLocationMarker)。
//
// 純函式,只回報「要畫什麼」:有座標就一顆不可點的藍點,沒座標就空陣列。
// 疊放順序由 group 'currentLocation' 決定(數值在 zOrder.ts,對照舊 hook 的 zIndex 1,
// 背景資訊不該蓋過使用者主動查詢或選中的東西)。
export function currentLocationLayer(input: { position: { lat: number; lng: number } | null }): FeatureLayer {
  const { position } = input
  if (!position) return { id: 'currentLocation', drawables: [] }
  return {
    id: 'currentLocation',
    drawables: [
      {
        kind: 'marker',
        id: 'me',
        group: 'currentLocation',
        // 只取 lat/lng,避免呼叫端傳入帶有多餘欄位的物件影響比對。
        position: { lat: position.lat, lng: position.lng },
        title: '目前位置',
        // 內容與座標無關,contentKey 固定:座標改變時只移動位置,不重做 DOM。
        contentKey: 'current-location-dot',
        createContent: currentLocationMarkerContent,
        clickable: false,
      },
    ],
  }
}
