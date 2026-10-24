import { describe, it, expect, vi } from 'vitest'
import { createEmptyTimeline, getNode, insertAfter, removeNode, updateNode, type PlanNodeData, type PlanTimeline } from './planTimeline'
import { refreshTransitAround, refreshTransitForStop } from './refreshTransit'

// 組時間軸:依序 [id, data] 逐一接在前一個後面(data.day 決定跨天)。
function build(items: Array<[string, PlanNodeData]>): PlanTimeline {
  let t = createEmptyTimeline()
  let anchor: string | null = null
  for (const [id, data] of items) {
    const r = insertAfter(t, anchor, data, id)
    if (!r.ok) throw new Error('setup failed: ' + r.error.message)
    t = r.timeline
    anchor = id
  }
  return t
}

const stop = (name: string, lat?: number, lng?: number, day?: number): PlanNodeData => ({ type: 'stop', name, lat, lng, day })

const ESTIMATE = { icon: 'walk', mode: 'walking', minutes: 12, distance: '0.8 km' }

// harness——模擬 React 的 setState(支援 updater)與 getTimeline。
function harness(initial: PlanTimeline, estimate: () => Promise<typeof ESTIMATE>) {
  const state = { t: initial }
  const setTimeline = (a: PlanTimeline | ((p: PlanTimeline) => PlanTimeline)) => {
    state.t = typeof a === 'function' ? a(state.t) : a
  }
  const transitEstimate = vi.fn(estimate)
  return { state, setTimeline, getTimeline: () => state.t, dataSource: { transitEstimate } }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('refreshTransitForStop', () => {
  it('上一站沒座標:清空 transitFromPrev 且不查詢', () => {
    const t = updateNode(build([['a', stop('A')], ['b', stop('B', 1, 1)]]), 'b', { transitFromPrev: { minutes: 5 } })
    const h = harness(t, async () => ESTIMATE)
    refreshTransitForStop({ stopId: 'b', ...h })
    expect(getNode(h.state.t, 'b')?.transitFromPrev).toBeUndefined()
    expect(h.dataSource.transitEstimate).not.toHaveBeenCalled()
  })

  it('沒有前一站(每天第一站):清空且不查詢', () => {
    const t = updateNode(build([['a', stop('A', 1, 1)]]), 'a', { transitFromPrev: { minutes: 5 } })
    const h = harness(t, async () => ESTIMATE)
    refreshTransitForStop({ stopId: 'a', ...h })
    expect(getNode(h.state.t, 'a')?.transitFromPrev).toBeUndefined()
    expect(h.dataSource.transitEstimate).not.toHaveBeenCalled()
  })

  it('跨天:第二天第一站不以第一天最後一站為上一站', () => {
    const t = build([['a', stop('A', 1, 1, 1)], ['b', stop('B', 2, 2, 2)]])
    const h = harness(t, async () => ESTIMATE)
    refreshTransitForStop({ stopId: 'b', ...h })
    expect(getNode(h.state.t, 'b')?.transitFromPrev).toBeUndefined()
    expect(h.dataSource.transitEstimate).not.toHaveBeenCalled()
  })

  it('這一站自己沒座標:不動作', () => {
    const h = harness(build([['a', stop('A', 1, 1)], ['b', stop('B')]]), async () => ESTIMATE)
    refreshTransitForStop({ stopId: 'b', ...h })
    expect(h.dataSource.transitEstimate).not.toHaveBeenCalled()
  })

  it('成功:先 loading,再寫入結果', async () => {
    const h = harness(build([['a', stop('A', 1, 1)], ['b', stop('B', 2, 2)]]), async () => ESTIMATE)
    refreshTransitForStop({ stopId: 'b', ...h })
    expect(getNode(h.state.t, 'b')?.transitFromPrev).toEqual({ loading: true })
    await flush()
    expect(getNode(h.state.t, 'b')?.transitFromPrev).toEqual({ loading: false, ...ESTIMATE })
    expect(h.dataSource.transitEstimate).toHaveBeenCalledWith({ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, undefined)
  })

  it('失敗:清空', async () => {
    const h = harness(build([['a', stop('A', 1, 1)], ['b', stop('B', 2, 2)]]), async () => { throw new Error('x') })
    refreshTransitForStop({ stopId: 'b', ...h })
    await flush()
    expect(getNode(h.state.t, 'b')?.transitFromPrev).toBeUndefined()
  })

  it('查詢期間上一站改變:不寫入結果', async () => {
    const h = harness(build([['a', stop('A', 1, 1)], ['b', stop('B', 2, 2)]]), async () => ESTIMATE)
    refreshTransitForStop({ stopId: 'b', ...h })
    // 查詢期間在 a、b 之間插入 x,b 的上一站變成 x
    const r = insertAfter(h.state.t, 'a', stop('X', 3, 3), 'x')
    if (!r.ok) throw new Error('setup failed')
    h.state.t = r.timeline
    await flush()
    // insertAfter 本身已清掉 b 的舊交通(上一站變了);重點是過時的結果沒有被寫回
    expect(getNode(h.state.t, 'b')?.transitFromPrev).toBeUndefined()
  })

  it('查詢期間上一站改變且查詢失敗:同樣不動', async () => {
    const h = harness(build([['a', stop('A', 1, 1)], ['b', stop('B', 2, 2)]]), async () => { throw new Error('x') })
    refreshTransitForStop({ stopId: 'b', ...h })
    const r = insertAfter(h.state.t, 'a', stop('X', 3, 3), 'x')
    if (!r.ok) throw new Error('setup failed')
    h.state.t = r.timeline
    await flush()
    // insertAfter 本身已清掉 b 的舊交通(上一站變了);重點是過時的結果沒有被寫回
    expect(getNode(h.state.t, 'b')?.transitFromPrev).toBeUndefined()
  })

  it('查詢期間節點被移除:不寫入也不丟錯', async () => {
    const h = harness(build([['a', stop('A', 1, 1)], ['b', stop('B', 2, 2)]]), async () => ESTIMATE)
    refreshTransitForStop({ stopId: 'b', ...h })
    const r = removeNode(h.state.t, 'b')
    if (!r.ok) throw new Error('setup failed')
    h.state.t = r.timeline
    await flush()
    expect(getNode(h.state.t, 'b')).toBeUndefined()
  })

  it('forceMode 傳給 dataSource', async () => {
    const h = harness(build([['a', stop('A', 1, 1)], ['b', stop('B', 2, 2)]]), async () => ESTIMATE)
    refreshTransitForStop({ stopId: 'b', ...h, forceMode: 'driving' })
    await flush()
    expect(h.dataSource.transitEstimate).toHaveBeenCalledWith({ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, 'driving')
  })

  it('isCancelled:估算回來時已取消(呼叫端卸載),成功結果不寫入', async () => {
    const h = harness(build([['a', stop('A', 1, 1)], ['b', stop('B', 2, 2)]]), async () => ESTIMATE)
    let cancelled = false
    const setTimeline = vi.fn(h.setTimeline)
    refreshTransitForStop({ stopId: 'b', ...h, setTimeline, isCancelled: () => cancelled })
    expect(setTimeline).toHaveBeenCalledTimes(1) // 先掛 loading
    cancelled = true
    await flush()
    expect(setTimeline).toHaveBeenCalledTimes(1)
    expect(getNode(h.state.t, 'b')?.transitFromPrev).toEqual({ loading: true })
  })

  it('isCancelled:估算失敗回來時已取消,也不寫入', async () => {
    const h = harness(build([['a', stop('A', 1, 1)], ['b', stop('B', 2, 2)]]), async () => { throw new Error('x') })
    let cancelled = false
    const setTimeline = vi.fn(h.setTimeline)
    refreshTransitForStop({ stopId: 'b', ...h, setTimeline, isCancelled: () => cancelled })
    cancelled = true
    await flush()
    expect(setTimeline).toHaveBeenCalledTimes(1)
  })

  it('isCancelled 一開始就成立:完全不動(不掛 loading、不查詢)', () => {
    const h = harness(build([['a', stop('A', 1, 1)], ['b', stop('B', 2, 2)]]), async () => ESTIMATE)
    const setTimeline = vi.fn(h.setTimeline)
    refreshTransitForStop({ stopId: 'b', ...h, setTimeline, isCancelled: () => true })
    expect(setTimeline).not.toHaveBeenCalled()
    expect(h.dataSource.transitEstimate).not.toHaveBeenCalled()
  })

})

describe('refreshTransitAround', () => {
  it('座標落地後連下一站一起重算(下一站先前因上一站沒座標而被清空)', async () => {
    // b 還在查詢中沒座標;c 插入時 refresh 因上一站 b 沒座標而清空
    const t = build([['a', stop('A', 1, 1)], ['b', stop('B')], ['c', stop('C', 3, 3)]])
    const h = harness(t, async () => ESTIMATE)
    refreshTransitForStop({ stopId: 'c', ...h })
    expect(getNode(h.state.t, 'c')?.transitFromPrev).toBeUndefined()
    // b 座標落地
    h.state.t = updateNode(h.state.t, 'b', { lat: 2, lng: 2 })
    refreshTransitAround({ stopId: 'b', ...h })
    await flush()
    expect(getNode(h.state.t, 'b')?.transitFromPrev).toEqual({ loading: false, ...ESTIMATE })
    expect(getNode(h.state.t, 'c')?.transitFromPrev).toEqual({ loading: false, ...ESTIMATE })
  })

  it('isCancelled 會一併套用到下一站的重算', async () => {
    const h = harness(build([['a', stop('A', 1, 1)], ['b', stop('B', 2, 2)], ['c', stop('C', 3, 3)]]), async () => ESTIMATE)
    let cancelled = false
    refreshTransitAround({ stopId: 'b', ...h, isCancelled: () => cancelled })
    cancelled = true
    await flush()
    expect(getNode(h.state.t, 'b')?.transitFromPrev).toEqual({ loading: true })
    expect(getNode(h.state.t, 'c')?.transitFromPrev).toEqual({ loading: true })
  })

  it('沒有下一站時只重算自己', async () => {
    const h = harness(build([['a', stop('A', 1, 1)], ['b', stop('B', 2, 2)]]), async () => ESTIMATE)
    refreshTransitAround({ stopId: 'b', ...h })
    await flush()
    expect(h.dataSource.transitEstimate).toHaveBeenCalledTimes(1)
  })
})
