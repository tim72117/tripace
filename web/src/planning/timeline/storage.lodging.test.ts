// 住宿(PlanTimeline.lodgings)的持久化:往返、損毀資料的處理,以及舊草稿裡 kind 為「住宿」的 stop 轉成 lodging 記錄(v1 與 v2 載入路徑)。
import { beforeEach, describe, expect, it } from 'vitest'
import { getNode, listNodes, lodgingsOf, type PlanTimeline } from './model'
import { PLAN_TIMELINE_STORAGE_KEY, loadTimeline, saveTimeline } from './storage'

beforeEach(() => {
  localStorage.clear()
})

const put = (payload: unknown) => localStorage.setItem(PLAN_TIMELINE_STORAGE_KEY, JSON.stringify(payload))

describe('lodgings 往返', () => {
  it('存檔寫出 lodgings,讀回完全一致;沒有住宿時不寫這個欄位', () => {
    const t: PlanTimeline = {
      days: [{ id: 'd1', nodes: [] }, { id: 'd2', nodes: [] }],
      lodgings: [{ id: 'l1', placeId: 'p1', name: '甲', dayIds: ['d1', 'd2'], note: { text: '早餐含' } }],
    }
    saveTimeline(t)
    expect(JSON.parse(localStorage.getItem(PLAN_TIMELINE_STORAGE_KEY)!).lodgings).toHaveLength(1)
    expect(loadTimeline()).toEqual(t)

    saveTimeline({ days: [{ id: 'd1', nodes: [] }] })
    expect('lodgings' in JSON.parse(localStorage.getItem(PLAN_TIMELINE_STORAGE_KEY)!)).toBe(false)
    expect(loadTimeline().lodgings).toBeUndefined()
  })

  it('讀回時略過壞掉的旅館,dayIds 只留存在的天,留不下任何一天的整筆丟掉', () => {
    put({
      version: 2,
      days: [{ id: 'd1', nodes: [] }, { id: 'd2', nodes: [] }],
      lodgings: [
        { id: 'ok', dayIds: ['d1', 'gone'] },
        { id: 'allgone', dayIds: ['gone'] },
        { id: 'dup', dayIds: ['d1'] },
        { id: 'dup', dayIds: ['d2'] },
        { dayIds: ['d1'] },
        'oops',
      ],
      rev: 1,
    })
    expect(lodgingsOf(loadTimeline())).toEqual([{ id: 'ok', dayIds: ['d1'] }, { id: 'dup', dayIds: ['d1'] }])
  })
})

describe('舊草稿的住宿 stop 搬成 lodging', () => {
  const hotel = { id: 'h1', type: 'stop', kind: '住宿', name: '舊旅館', placeId: 'ph', time: '15:00', lat: 1, lng: 2, checkOutDay: 3, note: { text: '備註' } }
  const spot = { id: 's1', type: 'stop', kind: '景點', name: '景點', time: '10:00' }

  it('v2:placeId/name/note 帶過去,dayIds 是所在天到 checkOutDay(含頭含尾),節點從該天移除', () => {
    put({ version: 2, days: [{ id: 'd1', nodes: [spot, hotel] }, { id: 'd2', nodes: [] }, { id: 'd3', nodes: [] }, { id: 'd4', nodes: [] }], rev: 1 })
    const t = loadTimeline()
    expect(lodgingsOf(t)).toEqual([{ id: 'h1', placeId: 'ph', name: '舊旅館', dayIds: ['d1', 'd2', 'd3'], note: { text: '備註' } }])
    expect(listNodes(t).map((n) => n.id)).toEqual(['s1'])
    expect(getNode(t, 'h1')).toBeUndefined()
  })

  it('沒填 checkOutDay 或 checkOutDay 不合理:只住入住當天;超過總天數夾到最後一天', () => {
    const noCheckOut = { id: 'a', type: 'stop', kind: '住宿', name: 'A' }
    const bad = { id: 'b', type: 'stop', kind: '住宿', name: 'B', checkOutDay: 0 }
    const tooFar = { id: 'c', type: 'stop', kind: '住宿', name: 'C', checkOutDay: 99 }
    put({ version: 2, days: [{ id: 'd1', nodes: [noCheckOut, bad] }, { id: 'd2', nodes: [tooFar] }], rev: 1 })
    expect(lodgingsOf(loadTimeline()).map((l) => [l.id, l.dayIds])).toEqual([['a', ['d1']], ['b', ['d1']], ['c', ['d2']]])
  })

  it('已有 lodgings 的新資料不受影響,與舊式住宿站並存時一起保留', () => {
    put({
      version: 2,
      days: [{ id: 'd1', nodes: [hotel] }, { id: 'd2', nodes: [] }, { id: 'd3', nodes: [] }],
      lodgings: [{ id: 'new', placeId: 'pn', dayIds: ['d2'] }],
      rev: 1,
    })
    expect(lodgingsOf(loadTimeline()).map((l) => l.id)).toEqual(['new', 'h1'])
  })

  it('v1(鏈結串列)路徑也會轉換:住宿站依自己的 day 與 checkOutDay 對到天位置再取 id', () => {
    put({
      version: 1,
      headId: 's1',
      nodes: [
        ['s1', { ...spot, prevId: null, nextId: 'h1', day: 1 }],
        ['h1', { ...hotel, prevId: 's1', nextId: 's2', day: 2, checkOutDay: 3 }],
        ['s2', { id: 's2', type: 'stop', kind: '景點', name: '第三天', time: '09:00', prevId: 'h1', nextId: null, day: 3 }],
      ],
      rev: 1,
    })
    const t = loadTimeline()
    expect(lodgingsOf(t)).toEqual([{ id: 'h1', placeId: 'ph', name: '舊旅館', dayIds: ['d_legacy2', 'd_legacy3'], note: { text: '備註' } }])
    expect(listNodes(t).map((n) => n.id)).toEqual(['s1', 's2'])
  })

  it('轉換後再存檔:寫出 lodgings,不再含住宿站與 checkOutDay', () => {
    put({ version: 2, days: [{ id: 'd1', nodes: [hotel] }, { id: 'd2', nodes: [] }, { id: 'd3', nodes: [] }], rev: 1 })
    saveTimeline(loadTimeline(), 1)
    const raw = localStorage.getItem(PLAN_TIMELINE_STORAGE_KEY)!
    expect(raw).not.toContain('checkOutDay')
    expect(raw).not.toContain('住宿')
    expect(JSON.parse(raw).lodgings[0].dayIds).toEqual(['d1', 'd2', 'd3'])
  })
})
