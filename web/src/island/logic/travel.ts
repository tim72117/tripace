// travel.ts——旅人沿步道走的進度(純函式):時間 → 弧長。
//
// 每一站有一個到站時間(layout.stops[].time)與在步道上的弧長位置。時間在相鄰兩站之間線性前進;
// 第一站之前停在起點(等待)、最後一站之後停在終點。站與站之間的移動速度因此取決於時間差與距離,
// 這是原型的簡化(真實行程的停留時間與交通方式不在這裡建模)。
export type StopStamp = { minutes: number; arc: number }

export function travelerArc(stops: ReadonlyArray<StopStamp>, minutes: number): number {
  if (stops.length === 0) return 0
  if (minutes <= stops[0].minutes) return stops[0].arc
  const last = stops[stops.length - 1]
  if (minutes >= last.minutes) return last.arc
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    if (minutes >= a.minutes && minutes <= b.minutes) {
      const span = b.minutes - a.minutes
      const f = span === 0 ? 1 : (minutes - a.minutes) / span
      return a.arc + (b.arc - a.arc) * f
    }
  }
  return last.arc
}

// activeStopIndex——此刻「最近到過」的站(還沒到第一站回 -1)。資訊卡/標籤高亮用。
export function activeStopIndex(stops: ReadonlyArray<StopStamp>, minutes: number): number {
  let idx = -1
  for (let i = 0; i < stops.length; i++) if (minutes >= stops[i].minutes) idx = i
  return idx
}
