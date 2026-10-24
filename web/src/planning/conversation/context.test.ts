// context.test.ts —createPlanAiCtx:「AI 自己的寫入算已讀」的簽名更新,以及天數上限。
// 底層用真的領域函式操作一份可變的時間軸(模擬 TripPlanPage 的 timelineRef),使用者的外部改動直接改這份時間軸。
import { describe, expect, it } from 'vitest'
import { addAttraction, addDayTool, listItinerary, removeAttraction, STALE_READ_MESSAGE } from './tools'
import { createPlanAiCtx, dayLimitMessage, MAX_DAY_JUMP } from './context'
import {
  addDay,
  createEmptyTimeline,
  insertAfter,
  moveDay,
  removeNode,
  updateNode,
  type PlanTimeline,
} from '../timeline/model'
import { timelineOf } from '../timeline/fixtures'

function setup(initial: PlanTimeline = createEmptyTimeline()) {
  const state = { timeline: initial }
  let seq = 0
  const { ctx, ensureFreshRead } = createPlanAiCtx({
    getTimeline: () => state.timeline,
    addStop: (anchorId, newId, data) => {
      const r = insertAfter(state.timeline, anchorId, data, newId)
      if (r.ok) state.timeline = r.timeline
      return r
    },
    setStopNote: (anchorId, text, category) => {
      const node = state.timeline.days.flatMap((d) => d.nodes).find((n) => n.id === anchorId)
      if (!node) return { ok: false, error: { code: 'anchor_not_found', message: 'nf' } }
      state.timeline = updateNode(state.timeline, anchorId, { note: { text, category } })
      return { ok: true, timeline: state.timeline, insertedId: anchorId }
    },
    // 仿 TripPlanPage.removeStop:只標記,節點稍後才由 land() 摘除(淡出動畫)
    removeStop: (id) => state.timeline.days.some((d) => d.nodes.some((n) => n.id === id)),
    addDay: (atDay) => {
      const r = addDay(state.timeline, atDay)
      if (!r.ok) return { ok: false, error: r.error }
      state.timeline = r.timeline
      return { ok: true, day: r.day, dayCount: r.timeline.days.length }
    },
    moveDay: (from, to) => {
      const r = moveDay(state.timeline, from, to)
      if (!r.ok) return { ...r, dayCount: state.timeline.days.length }
      state.timeline = r.timeline
      return { ...r, dayCount: r.timeline.days.length }
    },
    setLodging: () => ({ ok: false, error: { message: 'unused' } }),
    removeLodging: () => ({ ok: false, error: { code: 'lodging_not_found', message: 'unused' } }),
    newId: () => `n${++seq}`,
  })
  const land = (id: string) => {
    const r = removeNode(state.timeline, id)
    if (r.ok) state.timeline = r.timeline
  }
  return { state, ctx, ensureFreshRead, land }
}

// 使用者自己加一天(不經過 ctx):簽名會因天的結構改變而不同。
function userAddsDay(h: ReturnType<typeof setup>) {
  const r = addDay(h.state.timeline)
  if (!r.ok) throw new Error(r.error.message)
  h.state.timeline = r.timeline
}

const add = (ctx: ReturnType<typeof setup>['ctx'], args: Record<string, unknown> = {}) =>
  addAttraction.handle({ placeId: 'p', ...args }, ctx)

describe('AI 自己的寫入算已讀', () => {
  it('沒讀過就寫入:被擋(STALE_READ_MESSAGE)', async () => {
    const h = setup()
    await expect(add(h.ctx, { time: '09:00' })).rejects.toThrow(STALE_READ_MESSAGE)
  })

  it('讀一次之後連續兩次寫入,中間不需要再 list_itinerary', async () => {
    const h = setup()
    await listItinerary.handle({}, h.ctx)
    const first = (await add(h.ctx, { time: '09:00' })) as { id: string }
    const second = await add(h.ctx, { time: '11:00', anchorId: first.id })
    expect(second).toMatchObject({ anchorId: first.id })
    expect(h.state.timeline.days[0].nodes.map((n) => n.id)).toEqual(['n1', 'n2'])
  })

  it('混合不同改動工具(insert → add_day → note)也都不需要重讀', async () => {
    const h = setup()
    await listItinerary.handle({}, h.ctx)
    const a = (await add(h.ctx, { time: '09:00' })) as { id: string }
    await addDayTool.handle({}, h.ctx)
    await h.ctx.setStopNote(a.id, '備註', undefined)
    await add(h.ctx, { day: 2, time: '10:00' })
    expect(h.state.timeline.days).toHaveLength(2)
  })

  it('使用者在中間改了時間軸(拖曳時間):下一次寫入被擋,重新讀取後恢復', async () => {
    const h = setup()
    await listItinerary.handle({}, h.ctx)
    const a = (await add(h.ctx, { time: '09:00' })) as { id: string }
    // 使用者拖曳:不經過 ctx,直接改時間軸
    h.state.timeline = updateNode(h.state.timeline, a.id, { time: '08:00' })
    await expect(add(h.ctx, { time: '12:00', anchorId: a.id })).rejects.toThrow(STALE_READ_MESSAGE)
    await listItinerary.handle({}, h.ctx)
    await expect(add(h.ctx, { time: '12:00', anchorId: a.id })).resolves.toBeDefined()
  })

  it('使用者刪站:下一次寫入被擋', async () => {
    const h = setup()
    await listItinerary.handle({}, h.ctx)
    const a = (await add(h.ctx, { time: '09:00' })) as { id: string }
    h.land(a.id) // 使用者自己刪掉
    await expect(add(h.ctx, { time: '10:00' })).rejects.toThrow(STALE_READ_MESSAGE)
  })

  it('寫入失敗(anchor 不存在)不更新簽名:之後仍然新鮮的寫入照常成功;被擋的寫入也不會「洗白」外部改動', async () => {
    const h = setup()
    await listItinerary.handle({}, h.ctx)
    await expect(add(h.ctx, { anchorId: 'nope', time: '09:00' })).rejects.toThrow('找不到')
    await expect(add(h.ctx, { time: '09:00' })).resolves.toBeDefined()

    // 外部改動後,被擋的寫入不會把簽名更新成外部改動後的狀態
    userAddsDay(h)
    await expect(add(h.ctx, { time: '10:00' })).rejects.toThrow(STALE_READ_MESSAGE)
    await expect(add(h.ctx, { time: '10:00' })).rejects.toThrow(STALE_READ_MESSAGE)
  })

  it('remove_attraction:AI 自己的刪除算已讀,淡出動畫期間與摘除落地之後都不需要重讀', async () => {
    const h = setup(timelineOf([
      { id: 'a', type: 'stop', time: '09:00', name: 'a' },
      { id: 'b', type: 'stop', time: '10:00', name: 'b' },
    ]))
    await listItinerary.handle({}, h.ctx)
    await removeAttraction.handle({ id: 'a' }, h.ctx)
    // 動畫期間(節點還在)
    await expect(add(h.ctx, { time: '11:00', anchorId: 'b' })).resolves.toBeDefined()
    // 摘除落地(節點真的消失)
    h.land('a')
    await expect(add(h.ctx, { time: '12:00', anchorId: 'n1' })).resolves.toBeDefined()
  })

  it('remove 一個不存在的節點失敗:不更新簽名也不記待摘除', async () => {
    const h = setup()
    await listItinerary.handle({}, h.ctx)
    await expect(removeAttraction.handle({ id: 'nope' }, h.ctx)).rejects.toThrow('找不到')
    await expect(add(h.ctx, { time: '09:00' })).resolves.toBeDefined()
  })

  it('ensureFreshRead(詢問工具用)只檢查、不更新簽名', async () => {
    const h = setup()
    expect(() => h.ensureFreshRead()).toThrow(STALE_READ_MESSAGE)
    await listItinerary.handle({}, h.ctx)
    expect(() => h.ensureFreshRead()).not.toThrow()
    userAddsDay(h)
    expect(() => h.ensureFreshRead()).toThrow(STALE_READ_MESSAGE)
    expect(() => h.ensureFreshRead()).toThrow(STALE_READ_MESSAGE)
  })
})

describe('天數上限(一次最多往後跳 5 天)', () => {
  it('dayLimitMessage:沒超過回 null,超過的訊息寫出目前天數與上限', () => {
    expect(dayLimitMessage('day', undefined, 2)).toBeNull()
    expect(dayLimitMessage('day', 2 + MAX_DAY_JUMP, 2)).toBeNull()
    const msg = dayLimitMessage('day', 2 + MAX_DAY_JUMP + 1, 2)
    expect(msg).toContain('目前時間軸有 2 天')
    expect(msg).toContain('最多只能往後跳 5 天')
    expect(msg).toContain('第 7 天')
  })

  it('add_attraction 的 day:空時間軸 day=5 可以,day=6 被擋且不寫入', async () => {
    const h = setup()
    await listItinerary.handle({}, h.ctx)
    await expect(add(h.ctx, { day: 6, time: '09:00' })).rejects.toThrow('目前時間軸有 0 天')
    expect(h.state.timeline.days).toHaveLength(0)
    await expect(add(h.ctx, { day: 5, time: '09:00' })).resolves.toBeDefined()
    expect(h.state.timeline.days).toHaveLength(5)
  })

  it('上限用「寫入當下最新」的天數算:AI 自己剛補的天數讓上限跟著往後移', async () => {
    const h = setup()
    await listItinerary.handle({}, h.ctx)
    await add(h.ctx, { day: 5, time: '09:00' }) // 現在有 5 天
    await expect(add(h.ctx, { day: 10, time: '09:00' })).resolves.toBeDefined() // 5 + 5
    await expect(add(h.ctx, { day: 16, time: '09:00' })).rejects.toThrow('目前時間軸有 10 天')
  })

  it('add_day 的 atDay:超過現有天數 + 5 被擋,不新增天', async () => {
    const h = setup(timelineOf([{ id: 'a', type: 'stop', time: '09:00', name: 'a' }]))
    await listItinerary.handle({}, h.ctx)
    await expect(addDayTool.handle({ atDay: 7 }, h.ctx)).rejects.toThrow('目前時間軸有 1 天')
    expect(h.state.timeline.days).toHaveLength(1)
    await expect(addDayTool.handle({ atDay: 6 }, h.ctx)).resolves.toMatchObject({ day: 2 })
  })

  it('被上限擋下不更新簽名,也不影響後續合法的寫入', async () => {
    const h = setup()
    await listItinerary.handle({}, h.ctx)
    await expect(add(h.ctx, { day: 99 })).rejects.toThrow('超過上限')
    await expect(add(h.ctx, { time: '09:00' })).resolves.toBeDefined()
  })
})
