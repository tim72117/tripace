import type { RoutePolylineSegment } from '../geo-planning/mapDrawLayer/featureLayers/routePolylineLayer'
import type { PlanNode } from '../plan-core/planTimeline'

// routeSegmentsFromSteps——行程詳情頁地圖上的路線線段:有交通膠囊(transitFromPrev)的那一段才畫。
//
// 一段 = 前一站到這一站的直線(視覺雛形,不打 Routes API 算真實道路路徑),顏色依這一站的天數
// (dayIndex 用「排序後出現順序」,因為 day 不一定從 1 連續遞增)。不畫的情況:
//   - 這一站沒有交通膠囊(跨天的第一站、兩站幾乎同一點、沒座標等,膠囊本身就不存在);
//   - 膠囊還在查詢中(loading,還沒有內容);
//   - 前一站或這一站沒有座標。
// 非 stop 節點(跨天分隔、訊息)略過;前一站指「清單裡上一個 stop 節點」。美食清單不在 steps 裡,不會被連線。
export function routeSegmentsFromSteps(steps: PlanNode[]): RoutePolylineSegment[] {
  const days = [...new Set(steps.filter((s) => s.type === 'stop').map((s) => s.day ?? 1))].sort((a, b) => a - b)
  const segments: RoutePolylineSegment[] = []
  let prev: { lat: number; lng: number } | null = null
  for (const s of steps) {
    if (s.type !== 'stop') continue
    const here = s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null
    if (prev && here && s.transitFromPrev && !s.transitFromPrev.loading) {
      segments.push({ id: `seg-${s.id}`, dayIndex: days.indexOf(s.day ?? 1), path: [prev, here] })
    }
    prev = here
  }
  return segments
}
