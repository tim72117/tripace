import type { FeatureLayer } from '../types'

// RoutePolylineSegment——一條路徑線段:依「天」分段(day 1 一條、day 2 一條...),
// 不是整趟行程一條單一路徑。
export interface RoutePolylineSegment {
  dayIndex: number
  path: { lat: number; lng: number }[]
}

// routePolylineLayer——itineraries 頁的手繪路線功能層,取代 usePlanRoutePolyline(2026-10)。
// 依「天」分段,每天一條線;只描述要畫什麼,實際建立/更新/清理由 useMapDrawLayer 統一處理。

// 與舊 hook 的 ROUTE_COLORS 相同(舊檔未匯出,這裡複製一份;舊 hook 刪除後以這份為準)。
// 兩色循環:不同天用不同顏色區分,第三天回頭用第一色。
const ROUTE_COLORS = ['#d88f45', '#4a7fb5']

// google.maps.SymbolPath.FORWARD_CLOSED_ARROW 在 @types/google.maps 中是固定的列舉值 1
// (enum SymbolPath { CIRCLE = 0, FORWARD_CLOSED_ARROW = 1, ... })。功能層不能碰 google.maps,
// 所以用字面值;Google 的列舉值屬公開 API,不會變動。
const FORWARD_CLOSED_ARROW = 1

export function routePolylineLayer({ segments }: { segments: RoutePolylineSegment[] }): FeatureLayer {
  return {
    id: 'routePolyline',
    drawables: segments
      // 不足兩點畫不出線,舊 hook 也是直接略過;不產生 drawable,宿主會自動移除舊的那條。
      .filter((seg) => seg.path.length >= 2)
      .map((seg) => ({
        // 用 dayIndex 當 id:同一天資料變動時原地更新,不會整批重畫。
        id: `day-${seg.dayIndex}`,
        group: 'routePolyline' as const,
        kind: 'polyline' as const,
        path: seg.path,
        options: {
          strokeColor: ROUTE_COLORS[seg.dayIndex % ROUTE_COLORS.length],
          strokeOpacity: 0.85,
          strokeWeight: 4,
          // 沿路徑疊方向箭頭,repeat 固定間距重複,不需要精確定位。
          icons: [
            {
              icon: { path: FORWARD_CLOSED_ARROW, scale: 2.6, strokeColor: '#fff', strokeWeight: 1.2 },
              offset: '50%',
              repeat: '120px',
            },
          ],
        },
      })),
  }
}
