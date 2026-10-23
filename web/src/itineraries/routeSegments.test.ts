import { describe, it, expect } from 'vitest'
import { routeSegmentsFromSteps } from './routeSegments'
import type { PlanNode } from '../plan-core/planTimeline'

function stop(id: string, over: Partial<PlanNode> = {}): PlanNode {
  return { id, prevId: null, nextId: null, type: 'stop', name: id, day: 1, lat: 1, lng: 2, ...over } as PlanNode
}
const transit = { mode: '步行', minutes: 5 }

describe('routeSegmentsFromSteps', () => {
  it('有交通膠囊的那一段才畫線:前一站到這一站,id 以這一站為準', () => {
    const steps = [
      stop('a', { lat: 1, lng: 1 }),
      stop('b', { lat: 2, lng: 2, transitFromPrev: transit }),
      stop('c', { lat: 3, lng: 3 }),
    ]
    expect(routeSegmentsFromSteps(steps)).toEqual([
      { id: 'seg-b', dayIndex: 0, path: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }] },
    ])
  })
  it('沒有任何膠囊就沒有線;膠囊查詢中(loading)不畫', () => {
    expect(routeSegmentsFromSteps([stop('a'), stop('b')])).toEqual([])
    expect(routeSegmentsFromSteps([stop('a'), stop('b', { transitFromPrev: { loading: true } })])).toEqual([])
  })
  it('前一站或這一站沒有座標不畫;跨天分隔等非 stop 節點略過,前一站指上一個 stop', () => {
    const steps = [
      stop('a', { lat: undefined, lng: undefined }),
      stop('b', { transitFromPrev: transit }),
      { id: 'divider', prevId: null, nextId: null, type: 'section' } as PlanNode,
      stop('c', { day: 2, lat: 5, lng: 6, transitFromPrev: transit }),
    ]
    expect(routeSegmentsFromSteps(steps)).toEqual([
      { id: 'seg-c', dayIndex: 1, path: [{ lat: 1, lng: 2 }, { lat: 5, lng: 6 }] },
    ])
  })
  it('dayIndex 依排序後的天數順序,不是 day 數值', () => {
    const steps = [
      stop('a', { day: 3 }),
      stop('b', { day: 3, transitFromPrev: transit }),
      stop('c', { day: 7, transitFromPrev: transit }),
    ]
    expect(routeSegmentsFromSteps(steps).map((s) => s.dayIndex)).toEqual([0, 1])
  })
})
