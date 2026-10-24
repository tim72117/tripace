// TripPlanPage 對 usePlanTimelineCore 的接線測試——不渲染整個 TripPlanPage(它會建立 onagent 連線、依賴 google.maps),
// 改用同樣的選項組合重現那段接線:store(永遠寫存檔)+ dataSource + retryFailedOnMount + onBeforeMutate 接
// suppressNextAutoScrollRef + onStopInserted 接對話的 staleAll(對話與時間軸是兩個獨立 hook,連動只在這個接線點)。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { usePlanTimelineCore, REMOVE_FADE_MS } from './usePlanTimelineCore'
import { usePlanConversation } from '../conversation/usePlanConversation'
import { localStoragePlanTimelineStore, loadTimeline, PLAN_TIMELINE_STORAGE_KEY, saveTimeline } from './storage'
import { createEmptyTimeline, getNode, insertAfter, listNodes } from './model'

function fakeDataSource() {
  return {
    placeDetails: vi.fn(async (placeId: string) => ({ found: true, name: `N-${placeId}`, summary: 's', lat: 10, lng: 20 })),
    transitEstimate: vi.fn(async () => ({ mode: 'walking', icon: 'walk', minutes: 5, distance: '1 km' })),
  }
}

function useTripPlanLike(dataSource = fakeDataSource()) {
  const suppressRef = useRef(false)
  const suppressCount = useRef(0)
  const conv = usePlanConversation()
  const core = usePlanTimelineCore({
    store: localStoragePlanTimelineStore,
    dataSource,
    retryFailedOnMount: true,
    onBeforeMutate: () => {
      suppressRef.current = true
      suppressCount.current += 1
    },
    onStopInserted: conv.staleAll,
  })
  // 對話 hook 也有同名的 resyncFromStorage,所以不能直接展開兩者。
  return { ...core, messages: conv.messages, appendMessage: conv.appendMessage, suppressRef, suppressCount, dataSource }
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })

beforeEach(() => {
  localStorage.removeItem(PLAN_TIMELINE_STORAGE_KEY)
})

describe('TripPlanPage 式接線', () => {
  it('新增站點會淡化對話裡還新鮮的訊息,之後的新訊息維持新鮮', () => {
    const { result } = renderHook(() => useTripPlanLike())
    act(() => {
      result.current.appendMessage({ id: 'm1', text: '一' })
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', name: 'A', lat: 1, lng: 1 })
      result.current.appendMessage({ id: 'm2', text: '二' })
    })
    expect(result.current.messages.map((m) => !!m.stale)).toEqual([true, false])
  })

  it('插入失敗時不淡化對話', () => {
    const { result } = renderHook(() => useTripPlanLike())
    act(() => {
      result.current.appendMessage({ id: 'm1', text: '一' })
      result.current.insertAttractionAfter('不存在', 'a', { type: 'stop', name: 'A' })
    })
    expect(result.current.messages[0].stale).toBeFalsy()
  })

  it('掛載重試只跑一次;重整(重新掛載)後草稿仍在並補上座標', async () => {
    const r = insertAfter(createEmptyTimeline(), null, { type: 'stop', placeId: 'p-old' }, 'old')
    if (!r.ok) throw new Error('fixture')
    saveTimeline(r.timeline, 0)
    const ds = fakeDataSource()
    const first = renderHook(() => useTripPlanLike(ds))
    await settle()
    first.rerender()
    expect(ds.placeDetails).toHaveBeenCalledTimes(1)
    first.unmount()
    // 座標已隨同寫進存檔,重新掛載不需要再重試。
    const ds2 = fakeDataSource()
    const second = renderHook(() => useTripPlanLike(ds2))
    expect(getNode(second.result.current.timeline, 'old')?.lat).toBe(10)
    expect(ds2.placeDetails).not.toHaveBeenCalled()
  })

  it('兩個實例共用同一份草稿:一個寫入後,另一個提交前追上、不蓋掉對方', () => {
    const a = renderHook(() => useTripPlanLike())
    const b = renderHook(() => useTripPlanLike())
    act(() => {
      a.result.current.insertAttractionAfter(null, 'x', { type: 'stop', name: 'A 寫的' })
    })
    act(() => {
      b.result.current.insertAttractionAfter('x', 'y', { type: 'stop', name: 'B 寫的' })
    })
    expect(listNodes(loadTimeline()).map((n) => n.name)).toEqual(['A 寫的', 'B 寫的'])
    // 面板從隱藏轉可見:resyncFromStorage 讀回另一個實例的內容
    act(() => {
      a.result.current.resyncFromStorage()
    })
    expect(listNodes(a.result.current.timeline).map((n) => n.name)).toEqual(['A 寫的', 'B 寫的'])
  })
})

describe('TripPlanPage 式接線:自動捲動抑制', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('removeStep 設旗標兩次(標 removing、摘除),dragStopTime 一次;刪除後重新整理仍不復活', () => {
    const { result } = renderHook(() => useTripPlanLike())
    act(() => {
      result.current.insertAttractionAfter(null, 'a', { type: 'stop', name: 'A', time: '09:00' })
      result.current.insertAttractionAfter('a', 'b', { type: 'stop', name: 'B', time: '10:00' })
    })
    expect(result.current.suppressCount.current).toBe(0)
    act(() => {
      result.current.dragStopTime('b', '10:30')
    })
    expect(result.current.suppressCount.current).toBe(1)
    act(() => {
      result.current.removeStep('a')
    })
    expect(result.current.suppressCount.current).toBe(2)
    act(() => {
      vi.advanceTimersByTime(REMOVE_FADE_MS)
    })
    expect(result.current.suppressCount.current).toBe(3)
    expect(result.current.suppressRef.current).toBe(true)
    expect(listNodes(loadTimeline()).map((n) => n.name)).toEqual(['B'])
    expect(getNode(loadTimeline(), 'b')?.time).toBe('10:30')
  })
})
