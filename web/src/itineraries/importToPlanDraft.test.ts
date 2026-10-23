// importTimelineToPlanDraft——把行程時間軸(PlanTimeline)寫進登入後規劃面板的草稿(planning/timeline/storage.ts 的固定 key):
// 空草稿直接寫(天結構與住宿原樣帶過去);已有內容要確認才取代;寫入失敗不丟例外。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { importTimelineToPlanDraft } from './importToPlanDraft'
import { listNodes, lodgingsOf, type PlanNode, type PlanTimeline } from '../planning/timeline/model'
import { timelineOf } from '../planning/timeline/fixtures'
import { clearTimeline, loadTimelineWithRev, saveTimeline } from '../planning/timeline/storage'
import { SAMPLE_ITINERARIES } from './registry'
import { toPlanTimeline } from './catalog'

const node = (id: string, name: string, day = 1): PlanNode =>
  ({ id, type: 'stop', name, day, time: '09:00', kind: '景點', duration: '1h', lat: 1, lng: 2 }) as PlanNode
const timelineOfNames = (names: string[]): PlanTimeline => timelineOf(names.map((n, i) => node(`n${i}`, n)))
const namesOf = (t: PlanTimeline) => listNodes(t).map((n) => n.name)

beforeEach(() => {
  clearTimeline()
})

describe('importTimelineToPlanDraft', () => {
  it('草稿是空的:直接寫入,天結構(天的 id、每天的站)與住宿原樣帶過去', () => {
    const t: PlanTimeline = {
      ...timelineOf([node('a', 'A', 1), node('b', 'B', 2), node('c', 'C', 2)]),
      lodgings: [{ id: 'h1', name: '旅館', placeId: 'pid_h', dayIds: ['d1', 'd2'] }],
    }
    expect(importTimelineToPlanDraft(t)).toBe('saved')
    const saved = loadTimelineWithRev().timeline
    expect(saved.days.map((d) => d.id)).toEqual(['d1', 'd2'])
    expect(saved.days.map((d) => d.nodes.map((n) => n.name))).toEqual([['A'], ['B', 'C']])
    expect(lodgingsOf(saved)).toEqual([{ id: 'h1', name: '旅館', placeId: 'pid_h', dayIds: ['d1', 'd2'] }])
  })

  it('真實行程(含住宿)寫入後讀回:天數、站點順序、住宿與原本一致(通過 storage 的形狀檢查,沒有被當成損毀丟掉)', () => {
    const it = SAMPLE_ITINERARIES.find((x) => (x.timeline.lodgings?.length ?? 0) > 0)
    expect(it).toBeTruthy()
    const t = toPlanTimeline(it!).timeline
    expect(importTimelineToPlanDraft(t)).toBe('saved')
    const saved = loadTimelineWithRev().timeline
    expect(saved.days.map((d) => d.id)).toEqual(t.days.map((d) => d.id))
    expect(namesOf(saved)).toEqual(namesOf(t))
    expect(lodgingsOf(saved)).toEqual(lodgingsOf(t))
  })

  it('草稿只有空的天:視為空,直接寫入', () => {
    saveTimeline({ days: [{ id: 'x1', nodes: [] }] }, 0)
    expect(importTimelineToPlanDraft(timelineOfNames(['A']))).toBe('saved')
    expect(namesOf(loadTimelineWithRev().timeline)).toEqual(['A'])
  })

  it('草稿已有站、沒指定取代:不寫,回 needs_confirm,草稿原樣', () => {
    saveTimeline(timelineOfNames(['舊']), 0)
    expect(importTimelineToPlanDraft(timelineOfNames(['A']))).toBe('needs_confirm')
    expect(namesOf(loadTimelineWithRev().timeline)).toEqual(['舊'])
  })

  it('草稿只有住宿(沒有站)也算有內容:要確認', () => {
    saveTimeline({ days: [{ id: 'd1', nodes: [] }], lodgings: [{ id: 'h', name: '舊旅館', dayIds: ['d1'] }] }, 0)
    expect(importTimelineToPlanDraft(timelineOfNames(['A']))).toBe('needs_confirm')
    expect(lodgingsOf(loadTimelineWithRev().timeline)).toHaveLength(1)
  })

  it('草稿已有內容、指定 replaceExisting:取代並讓版次往前推', () => {
    saveTimeline(timelineOfNames(['舊']), 0)
    const before = loadTimelineWithRev().rev
    expect(importTimelineToPlanDraft(timelineOfNames(['A']), { replaceExisting: true })).toBe('saved')
    const after = loadTimelineWithRev()
    expect(namesOf(after.timeline)).toEqual(['A'])
    expect(after.rev).toBe(before + 1)
  })

  it('寫入失敗(localStorage 不可用):回 failed,不丟例外', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(importTimelineToPlanDraft(timelineOfNames(['A']))).toBe('failed')
    spy.mockRestore()
  })
})
