import { centerOfPoints } from '../geo-planning/mapCenter'
import type { SampleItinerary } from './types'

// initialCenterOf——行程詳情頁地圖的初始中心:取「第一天」有座標的站點,用共通算法(geo-planning/mapCenter.ts 的 centerOfPoints,
// 與登入後依旅程既有地點算中心同一個)算中心;第一天沒有任何座標時改用最早一天有座標的站點;完全沒有座標回 null,由 PlanMap
// 退回預設起點。
//
// 為什麼不是全部站點的平均:這頁以 zoom 15 建圖、沒有 fitBounds,多日、跨區域的行程(例如清邁:古城附近加上相距約 38km 的山區園區)
// 全部平均會落在沒有任何站點的地方,打開是一片空地。一天內的站點彼此距離不遠,取第一天的中心才框得住開頭幾站。
export function initialCenterOf(itinerary: SampleItinerary): { lat: number; lng: number } | null {
  for (const day of itinerary.timeline.days) {
    const located = day.nodes.filter((n) => n.type === 'stop' && n.lat != null && n.lng != null)
    if (located.length > 0) return centerOfPoints(located.map((n) => ({ lat: n.lat!, lng: n.lng! })))
  }
  return null
}
