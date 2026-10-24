import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { StrictMode } from 'react'
import { usePlanTimelineCore, REMOVE_FADE_MS, type PlanTimelineCoreOptions } from './usePlanTimelineCore'
import {
  loadTimeline,
  saveTimeline,
  localStoragePlanTimelineStore,
  PLAN_TIMELINE_STORAGE_KEY,
  type PlanTimelineStore,
} from './storage'
import { createEmptyTimeline, getNode, hasNode, insertAfter, listNodes } from './model'
import type { PlanNodeData } from './model'
import type { PlanTimeline } from './model'

// usePlanTimelineCore 的回歸測試——共用資料層框架(見該檔案開頭的完整說明)。
// 兩個使用端的差異收斂在 store 與 onStopInserted 兩個選項上,這裡逐一覆蓋。

function timelineWith(name: string): PlanTimeline {
  const r = insertAfter(createEmptyTimeline(), null, { type: 'stop', name }, `n-${name}`)
  if (!r.ok) throw new Error('fixture 建立失敗')
  return r.timeline
}

function namesOf(timeline: PlanTimeline): (string | undefined)[] {
  return listNodes(timeline).map((s) => s.name)
}

beforeEach(() => {
  localStorage.removeItem(PLAN_TIMELINE_STORAGE_KEY)
})

describe('基本操作(無 store,純記憶體)', () => {
  it('插入節點後時間軸依序反映出來', () => {
    const { result } = renderHook(() => usePlanTimelineCore())
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', name: '赤崁樓' })
    })
    act(() => {
      result.current.insertAttractionAfter('a', 'b', { type: 'stop', name: '安平古堡' })
    })
    expect(namesOf(result.current.timeline)).toEqual(['赤崁樓', '安平古堡'])
  })

  it('不傳 store 時不碰 localStorage,也不覆蓋既有的持久化內容', () => {
    saveTimeline(timelineWith('使用者排的'), 0)
    const { result } = renderHook(() => usePlanTimelineCore())
    // 初值是空的,不會讀到使用者的草稿
    expect(listNodes(result.current.timeline)).toHaveLength(0)
    act(() => {
      result.current.insertAttractionAfter(null, 'sim', { type: 'stop', name: '模擬腳本的站' })
    })
    expect(namesOf(result.current.timeline)).toEqual(['模擬腳本的站'])
    expect(namesOf(loadTimeline())).toEqual(['使用者排的'])
  })

  it('setNoteForStop 把備註寫在既有節點上,找不到節點回 anchor_not_found', () => {
    const { result } = renderHook(() => usePlanTimelineCore())
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', name: '赤崁樓' })
    })
    let ok = false
    let missing: ReturnType<typeof result.current.setNoteForStop> | undefined
    act(() => {
      ok = result.current.setNoteForStop('a', '傍晚人少', 'tip').ok
      missing = result.current.setNoteForStop('不存在', 'x', undefined)
    })
    expect(ok).toBe(true)
    expect(getNode(result.current.timeline, 'a')?.note).toEqual({ text: '傍晚人少', category: 'tip' })
    expect(listNodes(result.current.timeline)).toHaveLength(1)
    expect(missing && !missing.ok && missing.error.code).toBe('anchor_not_found')
  })

  it('clearTimeline 清空所有節點', () => {
    const { result } = renderHook(() => usePlanTimelineCore())
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', name: '赤崁樓' })
    })
    act(() => {
      result.current.clearTimeline()
    })
    expect(listNodes(result.current.timeline)).toHaveLength(0)
  })

  it('removeNodeNow 同步摘除節點,找不到回 ok:false 且 state 不變', () => {
    const { result } = renderHook(() => usePlanTimelineCore())
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', name: '赤崁樓' })
      result.current.insertAttractionAfter('a', 'b', { type: 'stop', name: '安平古堡' })
    })
    let removed = false
    let missing = true
    act(() => {
      removed = result.current.removeNodeNow('a').ok
      // 同一 tick 立刻讀得到
      expect(namesOf(result.current.timelineRef.current)).toEqual(['安平古堡'])
      missing = result.current.removeNodeNow('不存在').ok
    })
    expect(removed).toBe(true)
    expect(missing).toBe(false)
    expect(namesOf(result.current.timeline)).toEqual(['安平古堡'])
  })
})

describe('onStopInserted 契約', () => {
  it('對每個成功插入的 stop 觸發(含骨架節點),commit 之後才呼叫', () => {
    const seen: (string | undefined)[][] = []
    const onStopInserted = vi.fn()
    const { result } = renderHook(() => usePlanTimelineCore({ onStopInserted }))
    onStopInserted.mockImplementation(() => {
      seen.push(namesOf(result.current.timelineRef.current))
    })
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', name: '赤崁樓', placeId: 'p1' })
      // 骨架:沒 placeId、沒座標也觸發,過濾由呼叫端負責
      result.current.insertAttractionAfter('a', 'b', { type: 'stop' })
    })
    expect(onStopInserted).toHaveBeenCalledTimes(2)
    expect(onStopInserted).toHaveBeenNthCalledWith(1, 'a', expect.objectContaining({ name: '赤崁樓' }))
    expect(onStopInserted).toHaveBeenNthCalledWith(2, 'b', expect.objectContaining({ type: 'stop' }))
    // 回呼當下節點已經在時間軸上
    expect(seen[0]).toEqual(['赤崁樓'])
  })

  it('插入失敗(anchor 不存在)時不觸發', () => {
    const onStopInserted = vi.fn()
    const { result } = renderHook(() => usePlanTimelineCore({ onStopInserted }))
    let ok = true
    act(() => {
      ok = result.current.insertAttractionAfter('不存在的錨點', 'a', { type: 'stop', name: 'X' }).ok
    })
    expect(ok).toBe(false)
    expect(onStopInserted).not.toHaveBeenCalled()
  })
})

describe('commit 同步性', () => {
  it('同一 tick 連續兩次 commit,第二次讀得到第一次的結果', () => {
    const { result } = renderHook(() => usePlanTimelineCore())
    let counts: number[] = []
    act(() => {
      const c = result.current
      counts = [
        c.commitTimeline((cur) => {
          const r = insertAfter(cur, null, { type: 'stop', name: 'A' }, 'a')
          return r.ok ? { next: r.timeline, result: listNodes(r.timeline).length } : { result: -1 }
        }),
        c.commitTimeline((cur) => {
          const r = insertAfter(cur, 'a', { type: 'stop', name: 'B' }, 'b')
          return r.ok ? { next: r.timeline, result: listNodes(r.timeline).length } : { result: -1 }
        }),
      ]
    })
    expect(counts).toEqual([1, 2])
    expect(namesOf(result.current.timeline)).toEqual(['A', 'B'])
  })
})

describe('注入 localStorage store', () => {
  it('初值讀回既有內容,異動寫回去', () => {
    saveTimeline(timelineWith('先前排的'), 0)
    const { result } = renderHook(() => usePlanTimelineCore({ store: localStoragePlanTimelineStore }))
    expect(namesOf(result.current.timeline)).toEqual(['先前排的'])
    act(() => {
      result.current.insertAttractionAfter('n-先前排的', 'b', { type: 'stop', name: '新增的' })
    })
    expect(namesOf(loadTimeline())).toEqual(['先前排的', '新增的'])
  })

  it('Strict Mode 下初值內容正確(雙重 render 只丟棄第二份,不影響結果)', () => {
    saveTimeline(timelineWith('舊'), 0)
    const { result } = renderHook(() => usePlanTimelineCore({ store: localStoragePlanTimelineStore }), { wrapper: StrictMode })
    expect(namesOf(result.current.timeline)).toEqual(['舊'])
  })

  it('clearTimeline 連持久化內容一併清掉', () => {
    saveTimeline(timelineWith('舊的'), 0)
    const { result } = renderHook(() => usePlanTimelineCore({ store: localStoragePlanTimelineStore }))
    act(() => {
      result.current.clearTimeline()
    })
    expect(listNodes(result.current.timeline)).toHaveLength(0)
    expect(listNodes(loadTimeline())).toHaveLength(0)
  })

  it('多實例版次同步:一個實例寫入後,另一個實例提交前會先追上', () => {
    const a = renderHook(() => usePlanTimelineCore({ store: localStoragePlanTimelineStore }))
    const b = renderHook(() => usePlanTimelineCore({ store: localStoragePlanTimelineStore }))
    act(() => {
      a.result.current.insertAttractionAfter(null, 'x', { type: 'stop', name: 'A 寫的' })
    })
    // b 還停在掛載時的空內容
    expect(listNodes(b.result.current.timeline)).toHaveLength(0)
    act(() => {
      b.result.current.insertAttractionAfter('x', 'y', { type: 'stop', name: 'B 寫的' })
    })
    // b 先追上磁碟再插入,沒有把 A 的內容蓋掉
    expect(namesOf(b.result.current.timeline)).toEqual(['A 寫的', 'B 寫的'])
    expect(namesOf(loadTimeline())).toEqual(['A 寫的', 'B 寫的'])
  })

  it('resyncFromStorage 在純顯示情境把較新內容讀回來,且不重寫磁碟', () => {
    const a = renderHook(() => usePlanTimelineCore({ store: localStoragePlanTimelineStore }))
    const b = renderHook(() => usePlanTimelineCore({ store: localStoragePlanTimelineStore }))
    act(() => {
      a.result.current.insertAttractionAfter(null, 'x', { type: 'stop', name: 'A 寫的' })
    })
    const raw = localStorage.getItem(PLAN_TIMELINE_STORAGE_KEY)
    act(() => {
      b.result.current.resyncFromStorage()
    })
    expect(namesOf(b.result.current.timeline)).toEqual(['A 寫的'])
    expect(localStorage.getItem(PLAN_TIMELINE_STORAGE_KEY)).toBe(raw)
  })

  it('存檔失敗(store 回 null)時不推進 state,也不觸發 onStopInserted 以外的副作用', () => {
    const failing: PlanTimelineStore = {
      readRev: () => 0,
      loadTimelineWithRev: () => ({ timeline: createEmptyTimeline(), rev: 0 }),
      saveTimeline: () => null,
    }
    const { result } = renderHook(() => usePlanTimelineCore({ store: failing }))
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', name: '赤崁樓' })
    })
    expect(listNodes(result.current.timeline)).toHaveLength(0)
    expect(listNodes(result.current.timelineRef.current)).toHaveLength(0)
  })
})


// ───────────── 背景查詢與兩階段移除等「搬進共用 hook」的方法 ─────────────

function fakeDataSource() {
  return {
    placeDetails: vi.fn(async (placeId: string) => ({ found: true, name: `N-${placeId}`, summary: `S-${placeId}`, lat: 10, lng: 20 })),
    transitEstimate: vi.fn(async () => ({ mode: 'walking', icon: 'walk', minutes: 5, distance: '1 km' })),
  }
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })

const withCoords = (name: string, lat: number, lng: number): PlanNodeData => ({ type: 'stop', name, lat, lng })

describe('插入後的背景查詢預設流程', () => {
  it('有 placeId 沒座標:標 loading → 反查地點寫回名稱/座標 → 收掉 loading', async () => {
    const dataSource = fakeDataSource()
    const { result } = renderHook(() => usePlanTimelineCore({ dataSource }))
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', placeId: 'p1' })
    })
    expect(result.current.nodeStatusRef.current.get('a')?.loading).toBe(true)
    expect(dataSource.placeDetails).toHaveBeenCalledWith('p1')
    await settle()
    const node = getNode(result.current.timeline, 'a')
    expect(node).toMatchObject({ name: 'N-p1', desc: 'S-p1', lat: 10, lng: 20 })
    expect(result.current.nodeStatus.get('a')).toBeUndefined()
  })

  it('反查完成、座標落地後,與上一站之間的交通會重算', async () => {
    const dataSource = fakeDataSource()
    const { result } = renderHook(() => usePlanTimelineCore({ dataSource }))
    act(() => {
      result.current.insertAttractionAfter(null, 'a', withCoords('A', 1, 2))
    })
    await settle()
    dataSource.transitEstimate.mockClear()
    act(() => {
      result.current.insertAttractionAfter('a', 'b', { type: 'stop', placeId: 'p2' })
    })
    await settle()
    await settle()
    expect(dataSource.transitEstimate).toHaveBeenCalled()
    expect(getNode(result.current.timeline, 'b')?.transitFromPrev).toMatchObject({ minutes: 5, loading: false })
  })

  it('已有座標:不反查,直接重算交通', async () => {
    const dataSource = fakeDataSource()
    const { result } = renderHook(() => usePlanTimelineCore({ dataSource }))
    act(() => {
      result.current.insertAttractionAfter(null, 'a', withCoords('A', 1, 2))
      result.current.insertAttractionAfter('a', 'b', { ...withCoords('B', 3, 4), placeId: 'p2' })
    })
    await settle()
    expect(dataSource.placeDetails).not.toHaveBeenCalled()
    expect(dataSource.transitEstimate).toHaveBeenCalledTimes(1)
    expect(getNode(result.current.timeline, 'b')?.transitFromPrev).toMatchObject({ minutes: 5 })
  })

  it('骨架節點(無 placeId、無座標):什麼都不查,但 onStopInserted 仍觸發', () => {
    const dataSource = fakeDataSource()
    const onStopInserted = vi.fn()
    const { result } = renderHook(() => usePlanTimelineCore({ dataSource, onStopInserted }))
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop' })
    })
    expect(dataSource.placeDetails).not.toHaveBeenCalled()
    expect(dataSource.transitEstimate).not.toHaveBeenCalled()
    expect(onStopInserted).toHaveBeenCalledTimes(1)
  })

  it('needsLookup 選項可覆寫判斷(模擬態:有 placeId 就查,即使自帶座標)', async () => {
    const dataSource = fakeDataSource()
    const opts: PlanTimelineCoreOptions = { dataSource, needsLookup: (d) => !!d.placeId }
    const { result } = renderHook(() => usePlanTimelineCore(opts))
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { ...withCoords('劇本名', 1, 2), placeId: 'p1' })
    })
    await settle()
    expect(dataSource.placeDetails).toHaveBeenCalledWith('p1')
    expect(getNode(result.current.timeline, 'a')?.name).toBe('N-p1')
  })

  it('沒有 dataSource:不查詢,插入與 onStopInserted 照常', () => {
    const onStopInserted = vi.fn()
    const { result } = renderHook(() => usePlanTimelineCore({ onStopInserted }))
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', placeId: 'p1' })
    })
    expect(result.current.nodeStatusRef.current.size).toBe(0)
    expect(onStopInserted).toHaveBeenCalledTimes(1)
  })

  it('順序:預設查詢先啟動,onStopInserted 之後才呼叫,且此時節點已在時間軸上', () => {
    const dataSource = fakeDataSource()
    const order: string[] = []
    dataSource.placeDetails.mockImplementation(async (id: string) => {
      order.push('lookup')
      return { found: true, name: id, summary: '', lat: 1, lng: 1 }
    })
    let hasAtCallback = false
    const { result } = renderHook(() =>
      usePlanTimelineCore({
        dataSource,
        onStopInserted: (id) => {
          order.push('inserted')
          hasAtCallback = hasNode(result.current.timelineRef.current, id)
        },
      }),
    )
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', placeId: 'p1' })
    })
    expect(order).toEqual(['lookup', 'inserted'])
    expect(hasAtCallback).toBe(true)
  })

  it('競態:查詢回來前節點已被移除,放棄寫入也不留狀態', async () => {
    const dataSource = fakeDataSource()
    let release: (v: Awaited<ReturnType<typeof dataSource.placeDetails>>) => void = () => {}
    dataSource.placeDetails.mockImplementation(() => new Promise((r) => (release = r)))
    const { result } = renderHook(() => usePlanTimelineCore({ dataSource }))
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', placeId: 'p1' })
    })
    act(() => {
      result.current.removeNodeNow('a')
    })
    release({ found: true, name: 'X', summary: '', lat: 1, lng: 1 })
    await settle()
    expect(listNodes(result.current.timeline)).toHaveLength(0)
    expect(dataSource.transitEstimate).not.toHaveBeenCalled()
  })

  it('競態:元件卸載後查詢才回來,放棄(不更新狀態、不觸發交通)', async () => {
    const dataSource = fakeDataSource()
    let release: (v: Awaited<ReturnType<typeof dataSource.placeDetails>>) => void = () => {}
    dataSource.placeDetails.mockImplementation(() => new Promise((r) => (release = r)))
    const { result, unmount } = renderHook(() => usePlanTimelineCore({ dataSource }))
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', placeId: 'p1' })
    })
    const ref = result.current.timelineRef
    unmount()
    release({ found: true, name: 'X', summary: '', lat: 1, lng: 1 })
    await new Promise((r) => setTimeout(r, 0))
    expect(getNode(ref.current, 'a')?.lat).toBeUndefined()
    expect(dataSource.transitEstimate).not.toHaveBeenCalled()
  })

  it('followUpStop:骨架卡原地補成沒有 placeId 的完整資料時,收掉 loading 並重算交通', async () => {
    const dataSource = fakeDataSource()
    const { result } = renderHook(() => usePlanTimelineCore({ dataSource }))
    act(() => {
      result.current.insertAttractionAfter(null, 'a', withCoords('A', 1, 2))
      result.current.insertAttractionAfter('a', 'b', { type: 'stop' })
      result.current.setStatus('b', { loading: true })
    })
    await settle()
    dataSource.transitEstimate.mockClear()
    const filled = withCoords('B', 3, 4)
    act(() => {
      result.current.setTimeline((prev) => ({ ...prev, days: prev.days.map((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === 'b' ? { ...n, ...filled } : n)) })) }))
      result.current.followUpStop('b', filled)
    })
    await settle()
    expect(result.current.nodeStatus.get('b')).toBeUndefined()
    expect(dataSource.transitEstimate).toHaveBeenCalledTimes(1)
  })
})

describe('retryStopLookup 與掛載重試', () => {
  it('失敗標 failed;重試時回到 loading,成功後收掉 failed 並寫回資料', async () => {
    const dataSource = fakeDataSource()
    dataSource.placeDetails.mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => usePlanTimelineCore({ dataSource }))
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', placeId: 'p1' })
    })
    await settle()
    expect(result.current.nodeStatus.get('a')).toEqual({ failed: true })
    act(() => {
      result.current.retryStopLookup('a')
    })
    expect(result.current.nodeStatusRef.current.get('a')).toEqual({ loading: true })
    await settle()
    expect(result.current.nodeStatus.get('a')).toBeUndefined()
    expect(getNode(result.current.timeline, 'a')).toMatchObject({ name: 'N-p1', lat: 10 })
  })

  it('節點不存在、沒 placeId、沒有 dataSource 時不做事', () => {
    const dataSource = fakeDataSource()
    const a = renderHook(() => usePlanTimelineCore({ dataSource }))
    act(() => {
      a.result.current.insertAttractionAfter(null, 'a', withCoords('A', 1, 2))
    })
    act(() => {
      a.result.current.retryStopLookup('a')
      a.result.current.retryStopLookup('不存在')
    })
    expect(dataSource.placeDetails).not.toHaveBeenCalled()
    const b = renderHook(() => usePlanTimelineCore())
    act(() => {
      b.result.current.insertAttractionAfter(null, 'a', { type: 'stop', placeId: 'p' })
      b.result.current.retryStopLookup('a')
    })
    expect(b.result.current.nodeStatusRef.current.size).toBe(0)
  })

  it('retryFailedOnMount 開啟:掛載時重查「有 placeId 沒座標」的站,只跑一次', async () => {
    saveTimeline(
      (() => {
        const r = insertAfter(createEmptyTimeline(), null, { type: 'stop', placeId: 'p-old' }, 'old')
        if (!r.ok) throw new Error('fixture')
        return r.timeline
      })(),
      0,
    )
    const dataSource = fakeDataSource()
    const { result, rerender } = renderHook(() =>
      usePlanTimelineCore({ store: localStoragePlanTimelineStore, dataSource, retryFailedOnMount: true }),
    )
    expect(dataSource.placeDetails).toHaveBeenCalledTimes(1)
    expect(dataSource.placeDetails).toHaveBeenCalledWith('p-old')
    await settle()
    rerender()
    expect(dataSource.placeDetails).toHaveBeenCalledTimes(1)
    expect(getNode(result.current.timeline, 'old')?.lat).toBe(10)
  })

  it('retryFailedOnMount 預設關閉(模擬態不需要)', () => {
    saveTimeline(timelineWith('x'), 0)
    const dataSource = fakeDataSource()
    renderHook(() => usePlanTimelineCore({ store: localStoragePlanTimelineStore, dataSource }))
    expect(dataSource.placeDetails).not.toHaveBeenCalled()
  })
})

describe('removeStep 兩階段移除', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function setupThree(options: PlanTimelineCoreOptions = {}) {
    const hook = renderHook(() => usePlanTimelineCore(options))
    act(() => {
      hook.result.current.insertAttractionAfter(null, 'a', withCoords('A', 1, 1))
      hook.result.current.insertAttractionAfter('a', 'b', withCoords('B', 2, 2))
      hook.result.current.insertAttractionAfter('b', 'c', withCoords('C', 3, 3))
    })
    return hook
  }

  it('先標 removing 並保留節點,淡出時長後才摘除', () => {
    const { result } = setupThree()
    let ok = false
    act(() => {
      ok = result.current.removeStep('b')
    })
    expect(ok).toBe(true)
    expect(result.current.nodeStatus.get('b')?.removing).toBe(true)
    expect(namesOf(result.current.timeline)).toEqual(['A', 'B', 'C'])
    act(() => {
      vi.advanceTimersByTime(REMOVE_FADE_MS - 1)
    })
    expect(namesOf(result.current.timeline)).toEqual(['A', 'B', 'C'])
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(namesOf(result.current.timeline)).toEqual(['A', 'C'])
    expect(result.current.nodeStatus.get('b')).toBeUndefined()
  })

  it('REMOVE_FADE_MS 與 CSS 的 .removingFade transition(0.32s)同值', () => {
    expect(REMOVE_FADE_MS).toBe(320)
  })

  it('淡出期間重複移除擋下回 false;節點不存在也回 false', () => {
    const { result } = setupThree()
    let results: boolean[] = []
    act(() => {
      results = [result.current.removeStep('b'), result.current.removeStep('b'), result.current.removeStep('不存在')]
    })
    expect(results).toEqual([true, false, false])
  })

  it('摘除後補算下一站的交通(新的前一站→它)', async () => {
    const dataSource = fakeDataSource()
    const { result } = setupThree({ dataSource })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    dataSource.transitEstimate.mockClear()
    act(() => {
      result.current.removeStep('b')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REMOVE_FADE_MS)
    })
    expect(dataSource.transitEstimate).toHaveBeenCalledWith({ lat: 1, lng: 1 }, { lat: 3, lng: 3 }, undefined)
    expect(getNode(result.current.timeline, 'c')?.transitFromPrev).toMatchObject({ minutes: 5 })
  })

  it('onBeforeMutate 在標 removing 與摘除兩個時間點各呼叫一次', () => {
    const onBeforeMutate = vi.fn()
    const { result } = setupThree({ onBeforeMutate })
    act(() => {
      result.current.removeStep('b')
    })
    expect(onBeforeMutate).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(REMOVE_FADE_MS)
    })
    expect(onBeforeMutate).toHaveBeenCalledTimes(2)
  })

  it('removeFadeMs 選項可調整淡出時長', () => {
    const { result } = setupThree({ removeFadeMs: 50 })
    act(() => {
      result.current.removeStep('b')
      vi.advanceTimersByTime(50)
    })
    expect(namesOf(result.current.timeline)).toEqual(['A', 'C'])
  })

  it('淡出期間元件卸載:不再摘除、不補算交通', () => {
    const dataSource = fakeDataSource()
    const { result, unmount } = setupThree({ dataSource })
    const ref = result.current.timelineRef
    act(() => {
      result.current.removeStep('b')
    })
    dataSource.transitEstimate.mockClear()
    unmount()
    vi.advanceTimersByTime(REMOVE_FADE_MS)
    expect(namesOf(ref.current)).toEqual(['A', 'B', 'C'])
    expect(dataSource.transitEstimate).not.toHaveBeenCalled()
  })

  it('淡出期間時間軸被清空又以同一個 id 重新插入:舊計時器不會誤殺新節點', () => {
    const { result } = setupThree()
    act(() => {
      result.current.removeStep('b')
    })
    act(() => {
      result.current.clearTimeline()
    })
    act(() => {
      result.current.insertAttractionAfter(null, 'b', withCoords('B2', 9, 9))
    })
    act(() => {
      vi.advanceTimersByTime(REMOVE_FADE_MS)
    })
    expect(namesOf(result.current.timeline)).toEqual(['B2'])
  })
})

describe('dragStopTime', () => {
  it('寫入新時間並回 true,與前一站的交通重新估算', async () => {
    const dataSource = fakeDataSource()
    const { result } = renderHook(() => usePlanTimelineCore({ dataSource }))
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { ...withCoords('A', 1, 1), time: '09:00' })
      result.current.insertAttractionAfter('a', 'b', { ...withCoords('B', 2, 2), time: '10:00' })
    })
    await settle()
    dataSource.transitEstimate.mockClear()
    let ok = false
    act(() => {
      ok = result.current.dragStopTime('b', '10:30')
      // 同一 tick 立刻讀得到
      expect(getNode(result.current.timelineRef.current, 'b')?.time).toBe('10:30')
    })
    expect(ok).toBe(true)
    await settle()
    expect(dataSource.transitEstimate).toHaveBeenCalledWith({ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, undefined)
  })

  it('格式不合法或節點不存在:回 false、不異動、不呼叫 onBeforeMutate', () => {
    const onBeforeMutate = vi.fn()
    const { result } = renderHook(() => usePlanTimelineCore({ onBeforeMutate }))
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', name: 'A', time: '09:00' })
    })
    let results: boolean[] = []
    act(() => {
      results = [result.current.dragStopTime('a', '25:00'), result.current.dragStopTime('a', '9:5'), result.current.dragStopTime('不存在', '10:00')]
    })
    expect(results).toEqual([false, false, false])
    expect(getNode(result.current.timeline, 'a')?.time).toBe('09:00')
    expect(onBeforeMutate).not.toHaveBeenCalled()
  })

  it('寫入前先呼叫 onBeforeMutate(供自動捲動抑制),沒有 dataSource 時不查交通', () => {
    const calls: string[] = []
    const { result } = renderHook(() => usePlanTimelineCore({ onBeforeMutate: () => calls.push(`before:${getNode(result.current.timelineRef.current, 'a')?.time}`) }))
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', name: 'A', time: '09:00' })
      result.current.dragStopTime('a', '09:30')
    })
    expect(calls).toEqual(['before:09:00'])
    expect(getNode(result.current.timeline, 'a')?.time).toBe('09:30')
  })

  it('有 store 時拖拉的時間會持久化', () => {
    saveTimeline(timelineWith('A'), 0)
    const { result } = renderHook(() => usePlanTimelineCore({ store: localStoragePlanTimelineStore }))
    act(() => {
      result.current.dragStopTime('n-A', '11:00')
    })
    expect(getNode(loadTimeline(), 'n-A')?.time).toBe('11:00')
  })
})

describe('天與住宿操作', () => {
  it('addDayToTimeline:回報領域層實際插入的第幾天與總天數;不合法的 atDay 回錯誤且不改動', () => {
    const { result } = renderHook(() => usePlanTimelineCore())
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', name: 'A' })
    })
    let r1: ReturnType<typeof result.current.addDayToTimeline> | undefined
    let r2: ReturnType<typeof result.current.addDayToTimeline> | undefined
    let r3: ReturnType<typeof result.current.addDayToTimeline> | undefined
    act(() => {
      r1 = result.current.addDayToTimeline(undefined)
      r2 = result.current.addDayToTimeline(99) // 超過「天數 + 1」視為加在最後面
      r3 = result.current.addDayToTimeline(0)
    })
    expect(r1).toEqual({ ok: true, day: 2, dayCount: 2 })
    expect(r2).toEqual({ ok: true, day: 3, dayCount: 3 })
    expect(r3?.ok).toBe(false)
    expect(result.current.timeline.days).toHaveLength(3)
  })

  it('moveDayInTimeline:整天移動(連同節點);超出範圍回錯誤與目前天數', () => {
    const { result } = renderHook(() => usePlanTimelineCore())
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', name: 'A' })
      result.current.addDayToTimeline(undefined)
      result.current.insertAttractionAfter('a', 'b', { type: 'stop', name: 'B', day: 2 })
    })
    let moved: ReturnType<typeof result.current.moveDayInTimeline> | undefined
    let bad: ReturnType<typeof result.current.moveDayInTimeline> | undefined
    act(() => {
      moved = result.current.moveDayInTimeline(2, 1)
      bad = result.current.moveDayInTimeline(1, 5)
    })
    expect(moved).toMatchObject({ ok: true, dayCount: 2 })
    expect(namesOf(result.current.timeline)).toEqual(['B', 'A'])
    expect(bad).toMatchObject({ ok: false, dayCount: 2 })
  })

  it('setLodgingInTimeline/removeLodgingFromTimeline:新增、更新、移除住宿,失敗不改動', () => {
    const { result } = renderHook(() => usePlanTimelineCore())
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', name: 'A' })
      result.current.addDayToTimeline(undefined)
    })
    let set: ReturnType<typeof result.current.setLodgingInTimeline> | undefined
    act(() => {
      set = result.current.setLodgingInTimeline({ placeId: 'hotel-1', days: [1, 2], name: '旅館' })
    })
    expect(set).toMatchObject({ ok: true, created: true })
    expect(result.current.timeline.lodgings).toHaveLength(1)
    let bad: ReturnType<typeof result.current.setLodgingInTimeline> | undefined
    act(() => {
      bad = result.current.setLodgingInTimeline({ placeId: 'hotel-2', days: [9] })
    })
    expect(bad?.ok).toBe(false)
    expect(result.current.timeline.lodgings).toHaveLength(1)
    const lodgingId = set && set.ok ? set.lodgingId : ''
    let removed: ReturnType<typeof result.current.removeLodgingFromTimeline> | undefined
    let missing: ReturnType<typeof result.current.removeLodgingFromTimeline> | undefined
    act(() => {
      removed = result.current.removeLodgingFromTimeline(lodgingId)
      missing = result.current.removeLodgingFromTimeline('不存在')
    })
    expect(removed?.ok).toBe(true)
    expect(missing?.ok).toBe(false)
    expect(result.current.timeline.lodgings ?? []).toHaveLength(0)
  })

  it('有 store 時天與住宿操作會持久化;存檔失敗時不推進 state', () => {
    const { result } = renderHook(() => usePlanTimelineCore({ store: localStoragePlanTimelineStore }))
    act(() => {
      result.current.addDayToTimeline(undefined)
    })
    expect(loadTimeline().days).toHaveLength(1)
    const failing: PlanTimelineStore = {
      readRev: () => 0,
      loadTimelineWithRev: () => ({ timeline: createEmptyTimeline(), rev: 0 }),
      saveTimeline: () => null,
    }
    const f = renderHook(() => usePlanTimelineCore({ store: failing }))
    act(() => {
      f.result.current.addDayToTimeline(undefined)
    })
    expect(f.result.current.timeline.days).toHaveLength(0)
  })
})

describe('插入有座標的站點到兩站之間:下一站的交通也要補算', () => {
  it('a → c 之間插入自帶座標的 b:b 與 c 的 transitFromPrev 都重算', async () => {
    const dataSource = fakeDataSource()
    const { result } = renderHook(() => usePlanTimelineCore({ dataSource }))
    act(() => {
      result.current.insertAttractionAfter(null, 'a', withCoords('A', 1, 1))
      result.current.insertAttractionAfter('a', 'c', withCoords('C', 3, 3))
    })
    await settle()
    dataSource.transitEstimate.mockClear()
    act(() => {
      result.current.insertAttractionAfter('a', 'b', withCoords('B', 2, 2))
    })
    await settle()
    expect(dataSource.transitEstimate).toHaveBeenCalledWith({ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, undefined)
    expect(dataSource.transitEstimate).toHaveBeenCalledWith({ lat: 2, lng: 2 }, { lat: 3, lng: 3 }, undefined)
    expect(getNode(result.current.timeline, 'b')?.transitFromPrev).toMatchObject({ minutes: 5, loading: false })
    expect(getNode(result.current.timeline, 'c')?.transitFromPrev).toMatchObject({ minutes: 5, loading: false })
  })
})

// toggleableStore——包住 localStorage store,可以中途切成「存檔失敗」(saveTimeline 回 null)。
function toggleableStore() {
  const ctl = { failing: false }
  const store: PlanTimelineStore = {
    readRev: () => localStoragePlanTimelineStore.readRev(),
    loadTimelineWithRev: () => localStoragePlanTimelineStore.loadTimelineWithRev(),
    saveTimeline: (t, rev) => (ctl.failing ? null : localStoragePlanTimelineStore.saveTimeline(t, rev)),
  }
  return { ctl, store }
}

describe('存檔失敗時結果要反映失敗', () => {
  it('insertAttractionAfter:回 ok:false(save_failed),不觸發背景查詢與 onStopInserted', () => {
    const { ctl, store } = toggleableStore()
    ctl.failing = true
    const dataSource = fakeDataSource()
    const onStopInserted = vi.fn()
    const { result } = renderHook(() => usePlanTimelineCore({ store, dataSource, onStopInserted }))
    let r: ReturnType<typeof result.current.insertAttractionAfter> | undefined
    act(() => {
      r = result.current.insertAttractionAfter(null, 'a', { type: 'stop', placeId: 'p1' })
    })
    expect(r?.ok).toBe(false)
    expect(r && !r.ok ? r.error.code : undefined).toBe('save_failed')
    expect(onStopInserted).not.toHaveBeenCalled()
    expect(dataSource.placeDetails).not.toHaveBeenCalled()
    expect(result.current.nodeStatusRef.current.size).toBe(0)
  })

  it('setNoteForStop/removeNodeNow/天與住宿操作:存檔失敗一律回 ok:false 且不改動', () => {
    const { ctl, store } = toggleableStore()
    const { result } = renderHook(() => usePlanTimelineCore({ store }))
    let lodgingId = ''
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', name: 'A' })
      result.current.addDayToTimeline(undefined)
      const set = result.current.setLodgingInTimeline({ placeId: 'h', days: [1] })
      if (set.ok) lodgingId = set.lodgingId
    })
    const before = result.current.timelineRef.current
    ctl.failing = true
    const results: { ok: boolean }[] = []
    act(() => {
      results.push(result.current.setNoteForStop('a', '備註', undefined))
      results.push(result.current.removeNodeNow('a'))
      results.push(result.current.addDayToTimeline(undefined))
      results.push(result.current.moveDayInTimeline(1, 2))
      results.push(result.current.setLodgingInTimeline({ placeId: 'h2', days: [2] }))
      results.push(result.current.removeLodgingFromTimeline(lodgingId))
    })
    expect(results.map((x) => x.ok)).toEqual([false, false, false, false, false, false])
    expect(result.current.timelineRef.current).toBe(before)
  })

  it('dragStopTime:存檔失敗回 false,不重算交通', async () => {
    const { ctl, store } = toggleableStore()
    const dataSource = fakeDataSource()
    const { result } = renderHook(() => usePlanTimelineCore({ store, dataSource }))
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { ...withCoords('A', 1, 1), time: '09:00' })
      result.current.insertAttractionAfter('a', 'b', { ...withCoords('B', 2, 2), time: '10:00' })
    })
    await settle()
    dataSource.transitEstimate.mockClear()
    ctl.failing = true
    let ok = true
    act(() => {
      ok = result.current.dragStopTime('b', '10:30')
    })
    expect(ok).toBe(false)
    expect(getNode(result.current.timeline, 'b')?.time).toBe('10:00')
    expect(dataSource.transitEstimate).not.toHaveBeenCalled()
  })

  describe('removeStep 第二階段存檔失敗', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('節點留著、清掉 removing 狀態(看得見也能再移除),不補算下一站交通', async () => {
      const { ctl, store } = toggleableStore()
      const dataSource = fakeDataSource()
      const { result } = renderHook(() => usePlanTimelineCore({ store, dataSource }))
      act(() => {
        result.current.insertAttractionAfter(null, 'a', withCoords('A', 1, 1))
        result.current.insertAttractionAfter('a', 'b', withCoords('B', 2, 2))
        result.current.insertAttractionAfter('b', 'c', withCoords('C', 3, 3))
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      dataSource.transitEstimate.mockClear()
      ctl.failing = true
      act(() => {
        result.current.removeStep('b')
      })
      expect(result.current.nodeStatus.get('b')?.removing).toBe(true)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REMOVE_FADE_MS)
      })
      expect(namesOf(result.current.timeline)).toEqual(['A', 'B', 'C'])
      expect(result.current.nodeStatus.get('b')?.removing).toBeFalsy()
      expect(dataSource.transitEstimate).not.toHaveBeenCalled()
      // 恢復存檔後可以再移除
      ctl.failing = false
      let again = false
      act(() => {
        again = result.current.removeStep('b')
      })
      expect(again).toBe(true)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REMOVE_FADE_MS)
      })
      expect(namesOf(result.current.timeline)).toEqual(['A', 'C'])
    })
  })
})

describe('交通估算的卸載保護', () => {
  it('卸載後估算才回來:不寫進舊 store', async () => {
    const dataSource = fakeDataSource()
    let release: (v: Awaited<ReturnType<typeof dataSource.transitEstimate>>) => void = () => {}
    dataSource.transitEstimate.mockImplementation(() => new Promise((r) => (release = r)))
    const { result, unmount } = renderHook(() => usePlanTimelineCore({ store: localStoragePlanTimelineStore, dataSource }))
    act(() => {
      result.current.insertAttractionAfter(null, 'a', withCoords('A', 1, 1))
      result.current.insertAttractionAfter('a', 'b', withCoords('B', 2, 2))
    })
    expect(getNode(result.current.timelineRef.current, 'b')?.transitFromPrev).toEqual({ loading: true })
    const ref = result.current.timelineRef
    unmount()
    release({ mode: 'walking', icon: 'walk', minutes: 5, distance: '1 km' })
    await new Promise((r) => setTimeout(r, 0))
    expect(getNode(loadTimeline(), 'b')?.transitFromPrev?.minutes).toBeUndefined()
    expect(getNode(ref.current, 'b')?.transitFromPrev).toEqual({ loading: true })
  })
})
