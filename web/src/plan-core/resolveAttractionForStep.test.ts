import { describe, it, expect, vi, afterEach } from 'vitest'
import { ApiError } from '../api'
import { resolveAttractionForStep } from './resolveAttractionForStep'
import { createEmptyTimeline, getNode, insertAfter, type PlanTimeline } from './planTimeline'
import { setNodeStatus, EMPTY_NODE_STATUS, type NodeStatus, type NodeStatusMap } from './planNodeStatus'

// 驅動真實的 resolveAttractionForStep:名稱/說明/座標寫節點,loading/failed 寫狀態表,照片不寫節點。
function setup(keepContent = false) {
  const r = insertAfter(createEmptyTimeline(), null, { type: 'stop', placeId: 'p1', name: '查詢中…', desc: '作者寫的' }, 's1')
  if (!r.ok) throw new Error('setup')
  const state = { timeline: r.timeline as PlanTimeline, status: EMPTY_NODE_STATUS as NodeStatusMap, cancelled: false }
  const opts = {
    stepId: 's1',
    placeId: 'p1',
    setTimeline: ((fn: unknown) => {
      state.timeline = typeof fn === 'function' ? (fn as (p: PlanTimeline) => PlanTimeline)(state.timeline) : (fn as PlanTimeline)
    }) as never,
    setStatus: (id: string, patch: NodeStatus) => {
      state.status = setNodeStatus(state.status, id, patch)
    },
    isCancelled: () => state.cancelled,
    onSettled: vi.fn(),
    keepContent,
  }
  return { state, opts }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => vi.useRealTimers())

describe('resolveAttractionForStep', () => {
  it('開始即標 loading;成功後寫回名稱/說明/座標、清掉狀態、呼叫 onSettled,節點沒有照片欄位', async () => {
    const { state, opts } = setup()
    resolveAttractionForStep({ ...opts, fetchPlaceDetails: async () => ({ found: true, name: '赤崁樓', summary: '摘要', lat: 1, lng: 2, googlePhotoUrls: ['x'] } as never) })
    expect(state.status.get('s1')).toEqual({ loading: true })
    await flush()
    expect(getNode(state.timeline, 's1')).toMatchObject({ name: '赤崁樓', desc: '摘要', lat: 1, lng: 2, placeId: 'p1' })
    expect(getNode(state.timeline, 's1')).not.toHaveProperty('googlePhotoUrls')
    expect(state.status.size).toBe(0)
    expect(opts.onSettled).toHaveBeenCalledWith(1, 2)
  })

  it('失敗標 failed 並清 loading;名稱不被動到', async () => {
    const { state, opts } = setup()
    resolveAttractionForStep({ ...opts, fetchPlaceDetails: () => Promise.reject(new Error('x')) })
    await flush()
    expect(state.status.get('s1')).toEqual({ failed: true })
    expect(opts.onSettled).not.toHaveBeenCalled()
  })

  it('keepContent:不覆蓋名稱/說明、查不到也不標 failed', async () => {
    const a = setup(true)
    resolveAttractionForStep({ ...a.opts, fetchPlaceDetails: async () => ({ found: true, name: 'G', summary: 'GS', lat: 1, lng: 2 }) })
    await flush()
    expect(getNode(a.state.timeline, 's1')).toMatchObject({ name: '查詢中…', desc: '作者寫的', lat: 1 })
    const b = setup(true)
    resolveAttractionForStep({ ...b.opts, fetchPlaceDetails: () => Promise.reject(new Error('x')) })
    await flush()
    expect(b.state.status.size).toBe(0)
  })

  it('競態:節點已被移除/元件卸載(isCancelled)就放棄寫入', async () => {
    const { state, opts } = setup()
    resolveAttractionForStep({ ...opts, fetchPlaceDetails: async () => ({ found: true, name: 'X', lat: 1, lng: 2 }) })
    state.cancelled = true
    state.status = EMPTY_NODE_STATUS
    await flush()
    expect(getNode(state.timeline, 's1')?.name).toBe('查詢中…')
    expect(state.status.size).toBe(0)
  })

  it('429:維持 loading,3 秒後單次重試;重試成功清掉狀態', async () => {
    vi.useFakeTimers()
    const { state, opts } = setup()
    const rateLimited = new ApiError('rate limited', { status: 429, responseBody: { error: { code: 'rate_limited' } } } as never)
    const fetchPlaceDetails = vi.fn().mockRejectedValueOnce(rateLimited).mockResolvedValueOnce({ found: true, name: 'OK', lat: 1, lng: 2 })
    resolveAttractionForStep({ ...opts, fetchPlaceDetails })
    await vi.advanceTimersByTimeAsync(0)
    expect(state.status.get('s1')).toEqual({ loading: true })
    expect(fetchPlaceDetails).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(fetchPlaceDetails).toHaveBeenCalledTimes(2)
    expect(getNode(state.timeline, 's1')?.name).toBe('OK')
    expect(state.status.size).toBe(0)
  })
})
