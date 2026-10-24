// tools.test.ts —目前只針對 remove_attraction 補測試:
// parseRemoveAttractionArgs 的參數驗證,以及 removeAttraction 這個
// ClientTool 在 ctx.removeStop 回傳 ok:false(id 不存在)時,是否如預期
// throw 出人類可讀的錯誤訊息,而不是靜默吞掉。其餘既有工具
// (search_attraction/add_attraction/add_note/list_itinerary)目前沒有
// 既有測試檔案可比照,這裡不額外補——範圍限定在這次新增的 remove_attraction。
import { describe, expect, it, vi } from 'vitest'
import { createEmptyTimeline, type PlanTimeline } from '../timeline/model'
import { STALE_READ_MESSAGE, structureSignature, addAttraction, addDayTool, listItinerary, moveDayTool, removeAttraction, removeLodgingTool, setLodgingTool, type AttractionStepsCtx } from './tools'

function makeCtx(overrides: Partial<AttractionStepsCtx> = {}): AttractionStepsCtx {
  return {
    getTimeline: () => createEmptyTimeline(),
    addStop: vi.fn(),
    setStopNote: vi.fn(),
    removeStop: vi.fn(async () => ({ ok: true as const })),
    addDay: vi.fn(async () => ({ ok: true as const, day: 1, dayCount: 1 })),
    moveDay: vi.fn(async () => ({ ok: true as const, dayCount: 1 })),
    setLodging: vi.fn(async () => ({ ok: true as const, lodgingId: 'l1', created: true, removed: false, days: [1], dayCount: 1 })),
    removeLodging: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  }
}

describe('removeAttraction', () => {
  it('缺少 id 時直接 throw,不呼叫 ctx.removeStop', async () => {
    const removeStop = vi.fn()
    const ctx = makeCtx({ removeStop })
    await expect(removeAttraction.handle({}, ctx)).rejects.toThrow('缺少 id')
    expect(removeStop).not.toHaveBeenCalled()
  })

  it('id 存在時呼叫 ctx.removeStop 並立即回傳成功(不等待動畫)', async () => {
    const removeStop = vi.fn(async () => ({ ok: true as const }))
    const ctx = makeCtx({ removeStop })
    const result = await removeAttraction.handle({ id: 'n2' }, ctx)
    expect(removeStop).toHaveBeenCalledWith('n2')
    expect(result).toEqual({ id: 'n2', removed: true })
  })

  it('ctx.removeStop 回傳 ok:false(id 不存在)時,把錯誤訊息原樣 throw 給呼叫端', async () => {
    const ctx = makeCtx({
      removeStop: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'anchor_not_found' as const, message: '找不到 id 為 "not-exist" 的節點,無法移除。' },
      })),
    })
    await expect(removeAttraction.handle({ id: 'not-exist' }, ctx)).rejects.toThrow('找不到 id 為 "not-exist" 的節點')
  })

  it('raw args 裡 id 不是 string 時視為缺漏(空字串),一律 throw', async () => {
    const removeStop = vi.fn()
    const ctx = makeCtx({ removeStop })
    await expect(removeAttraction.handle({ id: 123 }, ctx)).rejects.toThrow('缺少 id')
    expect(removeStop).not.toHaveBeenCalled()
  })
})

describe('addDayTool / moveDayTool / add_attraction 的 day', () => {
  it('add_day:atDay 轉成整數傳給 ctx.addDay,不合法的值視為省略(加在最後面)', async () => {
    const addDay = vi.fn(async () => ({ ok: true as const, day: 3, dayCount: 3 }))
    const ctx = makeCtx({ addDay })
    expect(await addDayTool.handle({ atDay: 2 }, ctx)).toEqual({ day: 3, dayCount: 3 })
    expect(addDay).toHaveBeenLastCalledWith(2)
    await addDayTool.handle({ atDay: '4' }, ctx)
    expect(addDay).toHaveBeenLastCalledWith(4)
    for (const bad of [undefined, 0, -1, 1.5, 'x', null]) {
      await addDayTool.handle({ atDay: bad }, ctx)
      expect(addDay).toHaveBeenLastCalledWith(undefined)
    }
  })

  it('move_day:兩個天數都要是整數,缺漏就 throw 且不呼叫 ctx', async () => {
    const moveDay = vi.fn(async () => ({ ok: true as const, dayCount: 3 }))
    const ctx = makeCtx({ moveDay })
    await expect(moveDayTool.handle({ fromDay: 1 }, ctx)).rejects.toThrow('fromDay/toDay')
    await expect(moveDayTool.handle({ fromDay: 'a', toDay: 2 }, ctx)).rejects.toThrow('fromDay/toDay')
    expect(moveDay).not.toHaveBeenCalled()
    expect(await moveDayTool.handle({ fromDay: 3, toDay: '1' }, ctx)).toEqual({ fromDay: 3, toDay: 1, dayCount: 3 })
    expect(moveDay).toHaveBeenCalledWith(3, 1)
  })

  it('move_day:ctx 回 ok:false 時把訊息原樣 throw', async () => {
    const ctx = makeCtx({ moveDay: vi.fn(async () => ({ ok: false as const, error: { message: '目前時間軸有 2 天' } })) })
    await expect(moveDayTool.handle({ fromDay: 5, toDay: 1 }, ctx)).rejects.toThrow('目前時間軸有 2 天')
  })

  it('add_attraction 的 day 參數傳進 addStop,不合法就省略', async () => {
    const addStop = vi.fn(async () => ({ ok: true as const, id: 'x' }))
    const ctx = makeCtx({ addStop })
    await addAttraction.handle({ placeId: 'p', anchorId: null, day: 2 }, ctx)
    expect(addStop).toHaveBeenLastCalledWith(null, expect.objectContaining({ day: 2, placeId: 'p' }))
    await addAttraction.handle({ placeId: 'p', day: 0 }, ctx)
    expect(addStop).toHaveBeenLastCalledWith(null, expect.objectContaining({ day: undefined }))
  })

  it('list_itinerary 回傳依天分組的結構:每天一組 { day, steps },空的天也出現(steps 為空陣列)', async () => {
    const timeline: PlanTimeline = {
      days: [
        { id: 'd1', nodes: [{ id: 's1', type: 'stop', name: 'A', kind: '美食', duration: '1h', placeId: 'p1', time: '09:00', note: { text: '備註' } }] },
        { id: 'd2', nodes: [] },
        { id: 'd3', nodes: [{ id: 's2', type: 'stop', name: 'B', time: '10:00' }] },
      ],
    }
    const ctx = makeCtx({ getTimeline: () => timeline })
    const result = (await listItinerary.handle({}, ctx)) as { days: { day: number; steps: Record<string, unknown>[] }[] }
    expect(result.days.map((d) => d.day)).toEqual([1, 2, 3])
    expect(result.days[0].steps).toEqual([
      { id: 's1', time: '09:00', kind: '美食', duration: '1h', placeId: 'p1', name: 'A', note: { text: '備註' } },
    ])
    // 對話訊息已獨立於時間軸(PlanConversation),list_itinerary 的步驟不含 message,也不再回傳 type 欄位
    expect(result.days[0].steps[0]).not.toHaveProperty('type')
    expect(result.days[1].steps).toEqual([])
    expect(result.days[2].steps).toEqual([expect.objectContaining({ id: 's2', name: 'B', time: '10:00' })])
    // 步驟內不再有 day/label 欄位(天由外層分組表達)
    expect(result.days[0].steps[0]).not.toHaveProperty('day')
    expect(result.days[0].steps[0]).not.toHaveProperty('label')
  })

  it('list_itinerary 空時間軸回傳空的 days', async () => {
    expect(await listItinerary.handle({}, makeCtx())).toEqual({ days: [], lodgings: [] })
  })
})

describe('list_itinerary 的 lodgings', () => {
  it('回傳每筆旅館的 id/placeId/name 與由位置推算的第幾天(含不連續)', async () => {
    const timeline: PlanTimeline = {
      days: [{ id: 'd1', nodes: [] }, { id: 'd2', nodes: [] }, { id: 'd3', nodes: [] }, { id: 'd4', nodes: [] }],
      lodgings: [
        { id: 'l1', placeId: 'p1', name: '甲', dayIds: ['d2', 'd3'] },
        { id: 'l2', name: '乙', dayIds: ['d4', 'd1'] },
      ],
    }
    const result = (await listItinerary.handle({}, makeCtx({ getTimeline: () => timeline }))) as { lodgings: unknown[] }
    expect(result.lodgings).toEqual([
      { id: 'l1', placeId: 'p1', name: '甲', days: [2, 3] },
      { id: 'l2', placeId: undefined, name: '乙', days: [1, 4] },
    ])
  })
})

describe('set_lodging / remove_lodging', () => {
  it('參數驗證:缺 placeId、缺 days、days 含非整數都 throw,不呼叫 ctx', async () => {
    const setLodging = vi.fn()
    const ctx = makeCtx({ setLodging })
    await expect(setLodgingTool.handle({ days: [1] }, ctx)).rejects.toThrow('placeId')
    await expect(setLodgingTool.handle({ placeId: 'p' }, ctx)).rejects.toThrow('days')
    await expect(setLodgingTool.handle({ placeId: 'p', days: [1, 'x'] }, ctx)).rejects.toThrow('days')
    expect(setLodging).not.toHaveBeenCalled()
  })

  it('把 days(含字串數字)、name、lodgingId 交給 ctx.setLodging,回傳 upsert 結果', async () => {
    const setLodging = vi.fn(async () => ({ ok: true as const, lodgingId: 'l9', created: false, removed: false, days: [2, 3], dayCount: 4 }))
    const result = await setLodgingTool.handle({ placeId: 'p', days: [2, '3'], name: '旅館', lodgingId: 'l9' }, makeCtx({ setLodging }))
    expect(setLodging).toHaveBeenCalledWith({ placeId: 'p', days: [2, 3], name: '旅館', lodgingId: 'l9' })
    expect(result).toEqual({ lodgingId: 'l9', days: [2, 3], updated: true, dayCount: 4 })
  })

  it('days 為空陣列代表移除:原樣交給 ctx,回傳 removed', async () => {
    const setLodging = vi.fn(async () => ({ ok: true as const, lodgingId: 'l1', created: false, removed: true, days: [], dayCount: 3 }))
    const result = await setLodgingTool.handle({ placeId: 'p', days: [] }, makeCtx({ setLodging }))
    expect(setLodging).toHaveBeenCalledWith(expect.objectContaining({ days: [] }))
    expect(result).toEqual({ removed: true, lodgingId: 'l1' })
  })

  it('ctx 回傳失敗(例如天數超出範圍)時把訊息原樣 throw', async () => {
    const ctx = makeCtx({ setLodging: vi.fn(async () => ({ ok: false as const, error: { message: '目前時間軸有 2 天' } })) })
    await expect(setLodgingTool.handle({ placeId: 'p', days: [5] }, ctx)).rejects.toThrow('目前時間軸有 2 天')
  })

  it('remove_lodging:缺 lodgingId throw;失敗訊息原樣 throw;成功回傳 removed', async () => {
    await expect(removeLodgingTool.handle({}, makeCtx())).rejects.toThrow('lodgingId')
    const bad = makeCtx({ removeLodging: vi.fn(async () => ({ ok: false as const, error: { message: '找不到 id 為 "x" 的住宿' } })) })
    await expect(removeLodgingTool.handle({ lodgingId: 'x' }, bad)).rejects.toThrow('找不到 id 為 "x"')
    expect(await removeLodgingTool.handle({ lodgingId: 'l1' }, makeCtx())).toEqual({ removed: true, lodgingId: 'l1' })
  })
})

describe('structureSignature(行動前先確認目前行程的把關)', () => {
  const base: PlanTimeline = {
    days: [
      { id: 'd1', nodes: [{ id: 'a', type: 'stop', time: '09:00', name: '查詢中…' }] },
      { id: 'd2', nodes: [] },
    ],
  }
  const withNodes = (day1: PlanTimeline['days'][number]['nodes'], day2: PlanTimeline['days'][number]['nodes'] = []): PlanTimeline => ({
    days: [{ id: 'd1', nodes: day1 }, { id: 'd2', nodes: day2 }],
  })

  it('新增/刪除站、改天、改時間、增減天都會讓簽名改變', () => {
    const sig = structureSignature(base)
    expect(structureSignature(withNodes([base.days[0].nodes[0], { id: 'b', type: 'stop', time: '10:00' }]))).not.toBe(sig)
    expect(structureSignature(withNodes([]))).not.toBe(sig)
    expect(structureSignature(withNodes([], [base.days[0].nodes[0]]))).not.toBe(sig)
    expect(structureSignature(withNodes([{ ...base.days[0].nodes[0], time: '09:30' }]))).not.toBe(sig)
    expect(structureSignature({ days: [base.days[0]] })).not.toBe(sig)
  })

  it('背景補查地點資料(名稱、座標、備註變動)不會讓簽名改變', () => {
    const sig = structureSignature(base)
    expect(structureSignature(withNodes([{ ...base.days[0].nodes[0], name: '赤崁樓', lat: 1, lng: 2, note: { text: 'x' } }]))).toBe(sig)
  })

  it('旅館的 id 與停留的天納入簽名:增減旅館、改停留日、改天順序都會改變;沒有旅館時與過去相同', () => {
    const sig = structureSignature(base)
    const lodged = (dayIds: string[]): PlanTimeline => ({ ...base, lodgings: [{ id: 'l1', placeId: 'p', dayIds }] })
    expect(structureSignature(lodged(['d1']))).not.toBe(sig)
    expect(structureSignature(lodged(['d1']))).not.toBe(structureSignature(lodged(['d2'])))
    expect(structureSignature(lodged(['d1']))).toBe(structureSignature({ ...lodged(['d1']), lodgings: [{ id: 'l1', placeId: 'q', name: '改名', dayIds: ['d1'] }] }))
    expect(structureSignature({ ...base, lodgings: [] })).toBe(sig)
    // 天順序改變 → 旅館的第幾天改變 → 簽名改變
    const swapped: PlanTimeline = { ...lodged(['d1']), days: [base.days[1], base.days[0]] }
    expect(structureSignature(swapped)).not.toBe(structureSignature(lodged(['d1'])))
  })

  it('空行程有穩定的簽名;提示訊息要求先呼叫 list_itinerary', () => {
    expect(structureSignature(createEmptyTimeline())).toBe('')
    expect(STALE_READ_MESSAGE).toContain('list_itinerary')
  })
})
