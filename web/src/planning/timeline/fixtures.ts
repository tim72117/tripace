// fixtures.ts(planning/timeline)— 測試用:把「帶 day 欄位的扁平節點陣列」組成依天分組的 PlanTimeline。
//
// 兩個時間軸視圖與 useSimulatedStopsView 都直接吃 PlanTimeline,但多數測試案例原本是用一串節點加 day 欄位描述情境,
// 用這個 helper 轉成時間軸,不必在每個案例手寫 days 結構。day 省略視為第 1 天;天數不連續時中間補空的天(id 為 d{N})。
// 節點存進時間軸前會拿掉 day(天由所在位置決定,見 PlanNode 的說明)。
import { addDay, type PlanNode, type PlanTimeline } from './model'

export function timelineOf(nodes: PlanNode[], minDays = 0): PlanTimeline {
  const buckets: PlanNode[][] = []
  for (const n of nodes) {
    const dayIdx = Math.max(0, (n.day ?? 1) - 1)
    while (buckets.length <= dayIdx) buckets.push([])
    const { day: _day, ...rest } = n
    void _day
    buckets[dayIdx].push(rest)
  }
  while (buckets.length < minDays) buckets.push([])
  return { days: buckets.map((ns, i) => ({ id: `d${i + 1}`, nodes: ns })) }
}

// addedDay——測試用:呼叫 addDay 並直接取出新的時間軸(addDay 本身回傳結果物件,見 AddDayResult);失敗就丟錯讓測試明確失敗。
export function addedDay(timeline: PlanTimeline, atDay?: number, dayId?: string): PlanTimeline {
  const r = addDay(timeline, atDay, dayId)
  if (!r.ok) throw new Error(r.error.message)
  return r.timeline
}
