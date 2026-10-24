import { haversineMeters } from '../geo-planning/geoDistance'
import type { TransitInfo } from '../plan-core/planTimeline'

// estimateTransit——行程詳情頁沒有人工填交通方式(SampleStop.transitFromPrev)的相鄰兩站,用直線距離粗估一段交通膠囊。
//
// 規則與速度對齊後端 server/internal/api/geo_plan_ai.go 的 estimateTransitMode / metersPerMinuteFor /
// formatTransitDistance(/ai-plan 的模擬估計同一份):<=1200m 步行、<=5km 公車、其餘開車;
// 步行 80m/分、公車 300m/分、開車 400m/分。這是直線距離的粗估,不是實際路線,也沒有班次或塞車。
// 兩站幾乎同一點(< MIN_METERS,例如連住同一間住宿、同一園區的連續活動)不畫膠囊。
const MIN_METERS = 100
const WALK_M_PER_MIN = 80
const TRANSIT_M_PER_MIN = 300
const DRIVE_M_PER_MIN = 400

type Point = { lat: number; lng: number }

export function estimateTransit(from: Point, to: Point): TransitInfo | undefined {
  const meters = haversineMeters(from, to)
  if (meters < MIN_METERS) return undefined
  const mode = meters <= 1200 ? '步行' : meters <= 5000 ? '公車' : '開車'
  const perMin = mode === '步行' ? WALK_M_PER_MIN : mode === '公車' ? TRANSIT_M_PER_MIN : DRIVE_M_PER_MIN
  return {
    mode,
    minutes: Math.max(1, Math.round(meters / perMin)),
    distance: meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`,
  }
}
