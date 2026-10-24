// routeSegments 測試:地圖連線的切段規則(三個入口共用)。
import { describe, it, expect } from 'vitest'
import { routeSegmentsFromTimeline } from './routeSegments'
import type { PlanNode, PlanTimeline } from './planTimeline'

function stop(id: string, over: Partial<PlanNode> = {}): PlanNode {
  return { id, type: 'stop', name: id, lat: 1, lng: 2, ...over } as PlanNode
}
const transit = { mode: '步行', minutes: 5 }
const tl = (...days: PlanNode[][]): PlanTimeline => ({ days: days.map((nodes, i) => ({ id: `d${i + 1}`, nodes })) })

describe('routeSegmentsFromTimeline', () => {
  it('有交通膠囊的那一段才畫:前一站到這一站,id 是 from->to,帶兩端 id 與座標', () => {
    const timeline = tl([stop('a', { lat: 1, lng: 1 }), stop('b', { lat: 2, lng: 2, transitFromPrev: transit }), stop('c', { lat: 3, lng: 3 })])
    expect(routeSegmentsFromTimeline(timeline)).toEqual([
      { id: 'a->b', fromId: 'a', toId: 'b', from: { lat: 1, lng: 1 }, to: { lat: 2, lng: 2 } },
    ])
  })

  it('沒有任何膠囊就沒有線;空時間軸沒有線', () => {
    expect(routeSegmentsFromTimeline(tl([stop('a'), stop('b')]))).toEqual([])
    expect(routeSegmentsFromTimeline({ days: [] })).toEqual([])
  })

  it('膠囊查詢中(loading)也畫:線跟著膠囊一起出現,查到結果後路徑不變', () => {
    const loading = tl([stop('a'), stop('b', { lat: 3, lng: 4, transitFromPrev: { loading: true } })])
    const done = tl([stop('a'), stop('b', { lat: 3, lng: 4, transitFromPrev: transit })])
    expect(routeSegmentsFromTimeline(loading)).toHaveLength(1)
    expect(routeSegmentsFromTimeline(loading)).toEqual(routeSegmentsFromTimeline(done))
  })

  it('前一站或這一站沒有座標不畫;前一站指同一天裡上一個 stop', () => {
    const timeline = tl([
      stop('a', { lat: undefined, lng: undefined }),
      stop('b', { transitFromPrev: transit }),
      stop('c', { lat: 5, lng: 6, transitFromPrev: transit }),
      stop('d', { lat: undefined, lng: undefined, transitFromPrev: transit }),
    ])
    expect(routeSegmentsFromTimeline(timeline).map((s) => s.id)).toEqual(['b->c'])
  })

  it('不跨天:每天的第一站就算帶膠囊也沒有上一站可連', () => {
    const timeline = tl(
      [stop('a'), stop('b', { lat: 3, lng: 3, transitFromPrev: transit })],
      [stop('c', { lat: 5, lng: 5, transitFromPrev: transit }), stop('d', { lat: 6, lng: 6, transitFromPrev: transit })],
    )
    expect(routeSegmentsFromTimeline(timeline).map((s) => s.id)).toEqual(['a->b', 'c->d'])
  })

  it('旅館是獨立清單,不參與連線', () => {
    const timeline: PlanTimeline = {
      ...tl([stop('a'), stop('b', { lat: 3, lng: 3, transitFromPrev: transit })]),
      lodgings: [{ id: 'h', placeId: 'p', dayIds: ['d1'] }],
    }
    expect(routeSegmentsFromTimeline(timeline).map((s) => s.id)).toEqual(['a->b'])
  })

  it('純函式:同樣輸入輸出相等(兩端不變時 id 不變,繪製層才能原地更新)', () => {
    const timeline = tl([stop('a'), stop('b', { lat: 3, lng: 3, transitFromPrev: transit })])
    expect(routeSegmentsFromTimeline(timeline)).toEqual(routeSegmentsFromTimeline(timeline))
  })
})
