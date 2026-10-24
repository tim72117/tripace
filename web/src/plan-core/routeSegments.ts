import type { PlanNode, PlanTimeline } from './planTimeline'

// routeSegments——地圖上「站點之間的連線」要畫哪幾段(2026-10-24,三個入口統一)。
//
// 原本行程詳情頁用 itineraries/routeSegments.ts 依交通膠囊切段、依天換色,規劃入口(/ai-plan、登入後)則把所有站
// 連成一整條、單一強調色。使用者定案統一成「只畫有交通膠囊的那一段、顏色一律用主題強調色」,切段規則收在這裡,
// 三個入口(TripPlanPage、/ai-plan 模擬態的 useSimulatedStopsView、行程詳情頁)都用這一個函式,
// 結果交給 routeLineLayer(geo-planning/mapDrawLayer/featureLayers/routeLineLayer.ts)畫。
//
// 一段 = 同一天裡前一個 stop 到這一個 stop 的連線(視覺雛形,不打 Routes API 算真實道路路徑)。要畫的條件:
//   - 這一站有交通膠囊(transitFromPrev 存在)。膠囊還在查詢中(loading)也畫:膠囊本身已經顯示在時間軸上
//     (轉圈的佔位),線跟著膠囊一起出現、一起消失最直覺;查詢結果回來時線的路徑不變,不會閃爍(繪製層依
//     路徑比對、原地更新);查詢失敗時膠囊與線一起消失。原本詳情頁不畫 loading 的段,那是因為靜態行程不會有 loading。
//   - 前一站與這一站都有座標(還沒查到座標的站畫不出來)。
// 不跨天:每天的第一站沒有「上一站」(與 prevStopOf 的語意一致,交通膠囊描述的就是同一天裡的這一對)。
// 旅館是獨立的 lodgings 清單、不是節點,天然不參與(不在行程動線上)。
//
// id 用 `${fromId}->${toId}`:兩端不變時 id 不變,繪製層原地更新、不重畫;中間插入一站時舊段消失、兩段新 id 出現。

export interface RouteSegment {
  id: string
  fromId: string
  toId: string
  from: { lat: number; lng: number }
  to: { lat: number; lng: number }
}

function coordOf(node: PlanNode): { lat: number; lng: number } | null {
  return node.lat != null && node.lng != null ? { lat: node.lat, lng: node.lng } : null
}

export function routeSegmentsFromTimeline(timeline: PlanTimeline): RouteSegment[] {
  const segments: RouteSegment[] = []
  for (const day of timeline.days) {
    // 每天各自從頭開始:第一站沒有上一站。
    let prev: PlanNode | null = null
    for (const node of day.nodes) {
      if (node.type !== 'stop') continue
      if (prev && node.transitFromPrev) {
        const from = coordOf(prev)
        const to = coordOf(node)
        if (from && to) segments.push({ id: `${prev.id}->${node.id}`, fromId: prev.id, toId: node.id, from, to })
      }
      prev = node
    }
  }
  return segments
}
