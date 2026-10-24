// 住宿(PlanTimeline.lodgings)領域函式測試:結構是「N 筆旅館、每筆記錄停留的天 id」,
// 重點在天的增刪移動後旅館不會對錯天,以及 dayIds 驗證。
import { describe, it, expect } from 'vitest'
import {
  addLodging,
  formatDayNumbers,
  insertAfter,
  lodgingSpanLabel,
  lodgingStartsOnDay,
  lodgingsOf,
  lodgingsOnDay,
  lodgingsStartingOnDay,
  moveDay,
  removeDay,
  removeLodging,
  removeNode,
  setLodgingByDays,
  setLodgingDays,
  upsertLodging,
  updateLodging,
  type PlanTimeline,
} from './planTimeline'
import { addedDay } from './planTimelineTestUtils'

const days = (n: number): PlanTimeline => ({ days: Array.from({ length: n }, (_, i) => ({ id: `d${i + 1}`, nodes: [] })) })

function must(r: ReturnType<typeof addLodging>): PlanTimeline {
  if (!r.ok) throw new Error(r.error.message)
  return r.timeline
}

describe('lodgingsOf', () => {
  it('沒有 lodgings 欄位回傳空陣列,且是同一個參照', () => {
    expect(lodgingsOf(days(2))).toEqual([])
    expect(lodgingsOf(days(2))).toBe(lodgingsOf(days(3)))
  })
})

describe('addLodging / updateLodging / removeLodging', () => {
  it('新增:帶 id 與 dayIds,不動 days', () => {
    const t = must(addLodging(days(3), { placeId: 'p1', name: '旅館', dayIds: ['d1', 'd2'] }, 'l1'))
    expect(lodgingsOf(t)).toEqual([{ id: 'l1', placeId: 'p1', name: '旅館', dayIds: ['d1', 'd2'] }])
    expect(t.days).toHaveLength(3)
  })

  it('沒給 id 會產生唯一 id', () => {
    let t = must(addLodging(days(2), { dayIds: ['d1'] }))
    t = must(addLodging(t, { dayIds: ['d2'] }))
    const [a, b] = lodgingsOf(t)
    expect(a.id).not.toBe(b.id)
  })

  it('dayIds 不存在於 days:回傳 day_not_found 並列出目前天數', () => {
    const r = addLodging(days(2), { dayIds: ['d1', 'zzz'] })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('day_not_found')
      expect(r.error.message).toContain('zzz')
      expect(r.error.message).toContain('2 天')
    }
  })

  it('dayIds 為空:回傳 empty_days', () => {
    const r = addLodging(days(2), { dayIds: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('empty_days')
  })

  it('重複的 dayIds 去重', () => {
    const t = must(addLodging(days(2), { dayIds: ['d1', 'd1', 'd2'] }, 'l1'))
    expect(lodgingsOf(t)[0].dayIds).toEqual(['d1', 'd2'])
  })

  it('updateLodging 改名稱/placeId/note,不改 id 與 dayIds', () => {
    let t = must(addLodging(days(2), { name: '舊', dayIds: ['d1'] }, 'l1'))
    t = must(updateLodging(t, 'l1', { name: '新', placeId: 'p9', note: { text: '早餐含' } }))
    expect(lodgingsOf(t)[0]).toEqual({ id: 'l1', name: '新', placeId: 'p9', dayIds: ['d1'], note: { text: '早餐含' } })
    t = must(updateLodging(t, 'l1', { name: undefined }))
    expect(lodgingsOf(t)[0].name).toBeUndefined()
  })

  it('updateLodging / removeLodging 找不到回傳 lodging_not_found', () => {
    const t = days(1)
    const u = updateLodging(t, 'nope', { name: 'x' })
    const r = removeLodging(t, 'nope')
    expect(u.ok === false && u.error.code).toBe('lodging_not_found')
    expect(r.ok === false && r.error.code).toBe('lodging_not_found')
  })

  it('removeLodging 移除該筆', () => {
    let t = must(addLodging(days(2), { dayIds: ['d1'] }, 'l1'))
    t = must(addLodging(t, { dayIds: ['d2'] }, 'l2'))
    t = must(removeLodging(t, 'l1'))
    expect(lodgingsOf(t).map((l) => l.id)).toEqual(['l2'])
  })
})

describe('setLodgingDays', () => {
  it('整組換掉停留的天,可以不連續', () => {
    let t = must(addLodging(days(5), { dayIds: ['d1'] }, 'l1'))
    t = must(setLodgingDays(t, 'l1', ['d2', 'd5']))
    expect(lodgingsOf(t)[0].dayIds).toEqual(['d2', 'd5'])
  })

  it('天不存在、空陣列、旅館不存在都回傳明確錯誤,時間軸不變', () => {
    const t = must(addLodging(days(2), { dayIds: ['d1'] }, 'l1'))
    const a = setLodgingDays(t, 'l1', ['d9'])
    const b = setLodgingDays(t, 'l1', [])
    const c = setLodgingDays(t, 'nope', ['d1'])
    expect(a.ok === false && a.error.code).toBe('day_not_found')
    expect(b.ok === false && b.error.code).toBe('empty_days')
    expect(c.ok === false && c.error.code).toBe('lodging_not_found')
    expect(lodgingsOf(t)[0].dayIds).toEqual(['d1'])
  })
})

describe('lodgingsOnDay / lodgingStartsOnDay / lodgingsStartingOnDay', () => {
  it('一天可以有多筆旅館(換旅館那天);只有第一個停留日算入住日', () => {
    let t = must(addLodging(days(4), { name: 'A', dayIds: ['d1', 'd2'] }, 'a'))
    t = must(addLodging(t, { name: 'B', dayIds: ['d2', 'd3', 'd4'] }, 'b'))
    expect(lodgingsOnDay(t, 'd2').map((l) => l.id)).toEqual(['a', 'b'])
    expect(lodgingsOnDay(t, 'd4').map((l) => l.id)).toEqual(['b'])
    const [a, b] = lodgingsOf(t)
    expect(lodgingStartsOnDay(t, a, 'd1')).toBe(true)
    expect(lodgingStartsOnDay(t, a, 'd2')).toBe(false)
    expect(lodgingStartsOnDay(t, b, 'd2')).toBe(true)
    expect(lodgingStartsOnDay(t, b, 'd3')).toBe(false)
    expect(lodgingsStartingOnDay(t, 'd2').map((l) => l.id)).toEqual(['b'])
  })

  it('第一個停留日依天的位置算,不是 dayIds 的陣列順序', () => {
    const t = must(addLodging(days(3), { dayIds: ['d3', 'd2'] }, 'l1'))
    const l = lodgingsOf(t)[0]
    expect(lodgingStartsOnDay(t, l, 'd2')).toBe(true)
    expect(lodgingStartsOnDay(t, l, 'd3')).toBe(false)
  })
})

describe('formatDayNumbers / lodgingSpanLabel', () => {
  it('連續區間合併、不連續用逗號', () => {
    expect(formatDayNumbers([3])).toBe('Day 3')
    expect(formatDayNumbers([2, 3, 4])).toBe('Day 2–4')
    expect(formatDayNumbers([2, 5])).toBe('Day 2, 5')
    expect(formatDayNumbers([5, 2, 3])).toBe('Day 2–3, 5')
    expect(formatDayNumbers([1, 2, 4, 5, 6, 8])).toBe('Day 1–2, 4–6, 8')
    expect(formatDayNumbers([])).toBe('')
  })

  it('由天的位置推算:moveDay/addDay 後標籤跟著變', () => {
    let t = must(addLodging(days(4), { dayIds: ['d2', 'd3', 'd4'] }, 'l1'))
    expect(lodgingSpanLabel(t, lodgingsOf(t)[0])).toBe('Day 2–4')
    t = addedDay(t, 1, 'new')
    expect(lodgingSpanLabel(t, lodgingsOf(t)[0])).toBe('Day 3–5')
    const moved = moveDay(t, 5, 1)
    if (!moved.ok) throw new Error('moveDay failed')
    // d4 搬到最前面:停留的天變成不連續的 Day 1 與 Day 4–5
    expect(lodgingSpanLabel(moved.timeline, lodgingsOf(moved.timeline)[0])).toBe('Day 1, 4–5')
  })
})

describe('與天、站點操作的互動', () => {
  it('removeDay 把該天 id 從旅館移除,dayIds 變空的旅館自動移除', () => {
    let t = must(addLodging(days(4), { dayIds: ['d1', 'd2'] }, 'a'))
    t = must(addLodging(t, { dayIds: ['d2'] }, 'b'))
    t = removeDay(t, 2)
    expect(lodgingsOf(t).map((l) => ({ id: l.id, dayIds: l.dayIds }))).toEqual([{ id: 'a', dayIds: ['d1'] }])
    expect(t.days.map((d) => d.id)).toEqual(['d1', 'd3', 'd4'])
  })

  it('removeDay 找不到那天原樣回傳', () => {
    const t = must(addLodging(days(2), { dayIds: ['d1'] }, 'a'))
    expect(removeDay(t, 9)).toBe(t)
  })

  it('站點操作(insertAfter/removeNode)不影響旅館,也不丟掉 lodgings', () => {
    let t = must(addLodging(days(2), { dayIds: ['d1', 'd2'] }, 'a'))
    const ins = insertAfter(t, null, { type: 'stop', name: 'X', time: '09:00', day: 1 }, 'n1')
    if (!ins.ok) throw new Error('insert failed')
    expect(lodgingsOf(ins.timeline)).toEqual(lodgingsOf(t))
    const rm = removeNode(ins.timeline, 'n1')
    if (!rm.ok) throw new Error('remove failed')
    expect(lodgingsOf(rm.timeline)).toEqual(lodgingsOf(t))
    t = rm.timeline
    expect(t.days).toHaveLength(2)
  })

  it('removeNode 不會把還有旅館停留的最後一個空天裁掉', () => {
    let t = must(addLodging(days(2), { dayIds: ['d2'] }, 'a'))
    const ins = insertAfter(t, null, { type: 'stop', name: 'X', day: 2 }, 'n1')
    if (!ins.ok) throw new Error('insert failed')
    t = ins.timeline
    const rm = removeNode(t, 'n1')
    if (!rm.ok) throw new Error('remove failed')
    expect(rm.timeline.days).toHaveLength(2)
  })
})

describe('upsertLodging', () => {
  it('沒有同 placeId 的旅館就新增', () => {
    const r = upsertLodging(days(3), { placeId: 'p1', name: '甲', dayIds: ['d1', 'd2'] }, 'l1')
    expect(r.ok && r.created).toBe(true)
    if (r.ok) expect(lodgingsOf(r.timeline)).toEqual([{ id: 'l1', placeId: 'p1', name: '甲', dayIds: ['d1', 'd2'] }])
  })

  it('同 placeId 已有旅館:視為更新停留的天,不長出第二筆', () => {
    const first = upsertLodging(days(4), { placeId: 'p1', dayIds: ['d1'] }, 'l1')
    if (!first.ok) throw new Error('setup')
    const r = upsertLodging(first.timeline, { placeId: 'p1', name: '改名', dayIds: ['d2', 'd3'] })
    expect(r.ok && r.created).toBe(false)
    if (r.ok) expect(lodgingsOf(r.timeline)).toEqual([{ id: 'l1', placeId: 'p1', name: '改名', dayIds: ['d2', 'd3'] }])
  })

  it('給 lodgingId:依 id 更新(可同時換 placeId);id 不存在不會偷偷新增', () => {
    const first = upsertLodging(days(2), { placeId: 'p1', dayIds: ['d1'] }, 'l1')
    if (!first.ok) throw new Error('setup')
    const r = upsertLodging(first.timeline, { lodgingId: 'l1', placeId: 'p2', dayIds: ['d2'] })
    if (r.ok) expect(lodgingsOf(r.timeline)[0]).toMatchObject({ id: 'l1', placeId: 'p2', dayIds: ['d2'] })
    const bad = upsertLodging(first.timeline, { lodgingId: 'nope', placeId: 'p1', dayIds: ['d1'] })
    expect(bad.ok === false && bad.error.code).toBe('lodging_not_found')
    expect(lodgingsOf(first.timeline)).toHaveLength(1)
  })

  it('天不存在:回傳 day_not_found,原時間軸不變', () => {
    const first = upsertLodging(days(2), { placeId: 'p1', dayIds: ['d1'] }, 'l1')
    if (!first.ok) throw new Error('setup')
    const bad = upsertLodging(first.timeline, { placeId: 'p1', dayIds: ['d9'] })
    expect(bad.ok === false && bad.error.code).toBe('day_not_found')
  })
})

describe('setLodgingByDays(AI 的第幾天 → 天 id)', () => {
  it('第幾天轉成天 id(去重、依天排序),新增後可用 lodgingSpanLabel 讀回', () => {
    const r = setLodgingByDays(days(5), { placeId: 'p1', days: [4, 2, 3, 3], name: '甲' }, 'l1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.created).toBe(true)
    expect(r.days).toEqual([2, 3, 4])
    expect(lodgingsOf(r.timeline)[0].dayIds).toEqual(['d2', 'd3', 'd4'])
  })

  it('同 placeId 再呼叫是更新(不長第二筆),天順序改變後 id 仍指對天', () => {
    const first = setLodgingByDays(days(3), { placeId: 'p1', days: [1] }, 'l1')
    if (!first.ok) throw new Error('setup')
    const second = setLodgingByDays(first.timeline, { placeId: 'p1', days: [2, 3] })
    expect(second.ok && second.created).toBe(false)
    if (!second.ok) return
    expect(lodgingsOf(second.timeline)).toHaveLength(1)
    expect(lodgingsOf(second.timeline)[0].dayIds).toEqual(['d2', 'd3'])
  })

  it('天數超出範圍:錯誤訊息說明目前有幾天;沒有任何天時提示先建立天', () => {
    const r = setLodgingByDays(days(2), { placeId: 'p1', days: [1, 5] })
    expect(r.ok === false && r.error.message).toContain('目前時間軸有 2 天')
    const zero = setLodgingByDays(days(0), { placeId: 'p1', days: [1] })
    expect(zero.ok === false && zero.error.message).toContain('還沒有任何一天')
    const zeroDay = setLodgingByDays(days(2), { placeId: 'p1', days: [0] })
    expect(zeroDay.ok).toBe(false)
  })

  it('days 含 NaN/小數/0/負數:回 invalid_day;超出現有天數回 day_not_found', () => {
    for (const bad of [NaN, 1.5, 0, -1]) {
      const r = setLodgingByDays(days(3), { placeId: 'p1', days: [1, bad] })
      expect(r.ok === false && r.error.code).toBe('invalid_day')
    }
    const over = setLodgingByDays(days(3), { placeId: 'p1', days: [9] })
    expect(over.ok === false && over.error.code).toBe('day_not_found')
  })

  it('days 為空陣列代表移除(依 placeId 或 lodgingId);沒有可移除的回錯誤', () => {
    const first = setLodgingByDays(days(3), { placeId: 'p1', days: [1, 2] }, 'l1')
    if (!first.ok) throw new Error('setup')
    const removed = setLodgingByDays(first.timeline, { placeId: 'p1', days: [] })
    expect(removed.ok && removed.removed).toBe(true)
    if (removed.ok) expect(lodgingsOf(removed.timeline)).toEqual([])
    const none = setLodgingByDays(days(3), { placeId: 'zzz', days: [] })
    expect(none.ok).toBe(false)
  })

  it('lodgingId 找不到:回錯誤並列出目前的住宿 id,不偷偷新增', () => {
    const first = setLodgingByDays(days(3), { placeId: 'p1', days: [1], name: '甲' }, 'l1')
    if (!first.ok) throw new Error('setup')
    const r = setLodgingByDays(first.timeline, { placeId: 'p1', days: [2], lodgingId: 'nope' })
    expect(r.ok === false && r.error.message).toContain('"l1"')
    expect(lodgingsOf(first.timeline)).toHaveLength(1)
  })
})
