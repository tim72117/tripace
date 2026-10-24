// 行程相關測試共用的建構輔助:行程資料本身就是 PlanTimeline(見 types.ts),測試裡用「帶 day 的扁平站點」比較好寫,
// 這裡負責依 day 分組成 days 並補上 id/type。只給測試用,不在正式程式碼引用。
import type { PlanNode, PlanNodeData } from '../planning/timeline/model'
import { timelineOf as planTimelineOf } from '../planning/timeline/fixtures'
import type { SampleItinerary } from './types'

let seq = 0

// stop——測試用的站:kind/duration/time 是必填欄位,給預設值,只在需要時覆寫;day 是「放進第幾天」的輸入(組成時間軸時拿掉)。
export function stop(over: Partial<PlanNodeData> & { name: string }): PlanNode & { day?: number } {
  seq += 1
  return { id: `t${seq}`, type: 'stop', time: '09:00', kind: '景點', duration: '1h', ...over }
}

// timelineOf——依 day 分組成 PlanTimeline 的實作只有 planning/timeline/fixtures 那一份;這裡只保留行程資料測試的預設:
// 沒填 totalDays 時至少有 1 天(空站點也有第 1 天,行程資料不會是 0 天)。
export function timelineOf(stops: Array<PlanNode & { day?: number }>, totalDays = 1) {
  return planTimelineOf(stops, totalDays)
}

export function makeItinerary(stops: Array<PlanNode & { day?: number }>, over: Partial<SampleItinerary> = {}, totalDays = 1): SampleItinerary {
  return { id: 'x', title: 'x', region: 'r', categories: [], summary: 's', addedAt: '2026-10-01', timeline: timelineOf(stops, totalDays), ...over }
}
