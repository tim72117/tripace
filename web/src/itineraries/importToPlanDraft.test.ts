// importTimelineToPlanDraft——把行程時間軸寫進登入後的規劃草稿:空草稿直接寫;已有內容要確認才取代;寫入失敗不丟例外。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { importTimelineToPlanDraft } from './importToPlanDraft'
import { createEmptyTimeline, insertAfter, toRenderList, type PlanTimeline } from '../plan-core/planTimeline'
import { clearTimeline, loadTimelineWithRev, saveTimeline } from '../plan-core/planTimelineStorage'

function timelineOf(names: string[]): PlanTimeline {
  let t = createEmptyTimeline()
  let prev: string | null = null
  names.forEach((name, i) => {
    const id = `n${i}`
    const r = insertAfter(t, prev, { type: 'stop', name, day: 1, time: `${9 + i}:00`.padStart(5, '0'), kind: '景點', duration: '1h', lat: 1 + i, lng: 2 } as never, id)
    if (!r.ok) throw new Error('setup')
    t = r.timeline
    prev = id
  })
  return t
}
const namesOf = (t: PlanTimeline) => toRenderList(t).filter((n) => n.type === 'stop').map((n) => n.name)

beforeEach(() => {
  clearTimeline()
})

describe('importTimelineToPlanDraft', () => {
  it('草稿是空的:直接寫入', () => {
    expect(importTimelineToPlanDraft(timelineOf(['A', 'B']))).toBe('saved')
    expect(namesOf(loadTimelineWithRev().timeline)).toEqual(['A', 'B'])
  })

  it('草稿已有內容、沒指定取代:不寫,回 needs_confirm,草稿原樣', () => {
    saveTimeline(timelineOf(['舊']), 0)
    expect(importTimelineToPlanDraft(timelineOf(['A']))).toBe('needs_confirm')
    expect(namesOf(loadTimelineWithRev().timeline)).toEqual(['舊'])
  })

  it('草稿已有內容、指定 replaceExisting:取代並讓版次往前推', () => {
    saveTimeline(timelineOf(['舊']), 0)
    const before = loadTimelineWithRev().rev
    expect(importTimelineToPlanDraft(timelineOf(['A']), { replaceExisting: true })).toBe('saved')
    const after = loadTimelineWithRev()
    expect(namesOf(after.timeline)).toEqual(['A'])
    expect(after.rev).toBe(before + 1)
  })

  it('寫入失敗(localStorage 不可用):回 failed,不丟例外', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(importTimelineToPlanDraft(timelineOf(['A']))).toBe('failed')
    spy.mockRestore()
  })
})
