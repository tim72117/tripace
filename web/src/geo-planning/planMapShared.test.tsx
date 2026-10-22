// planMapShared:兩邊 PlanMap(/ai-plan 與登入後)共用的內部接線。
//   - useMapHandle:接住 NativeMapBase 回報的 MapHandle,同步成身分不變的 mapRef 與 mapReady、mapVersion。
//   - usePlanMapDrawing:把 PlanMap 的 prop(站點、選取、hover、轉乘配對、路線開關、目前位置、主題)
//     轉成統一繪製層(useSharedDrawLayer)的輸入。
// mock 掉 useSharedDrawLayer,只驗證交給它什麼。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { MapHandle } from './NativeMapBase'

const drawArgs: Record<string, unknown>[] = []
vi.mock('./mapDrawLayer/useSharedDrawLayer', () => ({
  useSharedDrawLayer: (args: Record<string, unknown>) => {
    drawArgs.push(args)
    return { expandedThemeId: 'theme-1' }
  },
}))

import { useMapHandle, usePlanMapDrawing } from './planMapShared'

const fakeMap = (tag: string) => ({ tag }) as unknown as google.maps.Map
const handle = (map: google.maps.Map | null, over: Partial<MapHandle> = {}): MapHandle => ({
  mapRef: { current: map },
  mapReady: map != null,
  mapVersion: 1,
  ...over,
})

beforeEach(() => {
  drawArgs.length = 0
})

describe('useMapHandle', () => {
  it('初始:地圖未就緒、版本 0、沒有錯誤、mapRef 是空的', () => {
    const { result } = renderHook(() => useMapHandle())
    expect(result.current.mapReady).toBe(false)
    expect(result.current.mapVersion).toBe(0)
    expect(result.current.error).toBeNull()
    expect(result.current.mapRef.current).toBeNull()
  })

  it('NativeMapBase 回報 handle:mapRef 同步成地圖實例,mapReady、mapVersion、error 跟著更新', () => {
    const { result } = renderHook(() => useMapHandle())
    const map = fakeMap('a')
    act(() => result.current.handleChange(handle(map, { mapVersion: 2, error: 'boom' })))
    expect(result.current.mapRef.current).toBe(map)
    expect(result.current.mapReady).toBe(true)
    expect(result.current.mapVersion).toBe(2)
    expect(result.current.error).toBe('boom')
    expect(result.current.handle.mapVersion).toBe(2)
  })

  it('mapRef 身分不變:地圖重建(新實例)後仍是同一個 ref 物件,內容換成新地圖', () => {
    const { result } = renderHook(() => useMapHandle())
    const ref = result.current.mapRef
    act(() => result.current.handleChange(handle(fakeMap('a'))))
    const second = fakeMap('b')
    act(() => result.current.handleChange(handle(second, { mapVersion: 2 })))
    expect(result.current.mapRef).toBe(ref)
    expect(ref.current).toBe(second)
  })

  it('handleChange 的身分穩定(不會因為呼叫端每次傳新函式而讓 NativeMapBase 重新觸發)', () => {
    const { result, rerender } = renderHook(({ cb }) => useMapHandle(cb), { initialProps: { cb: vi.fn() } })
    const first = result.current.handleChange
    rerender({ cb: vi.fn() })
    expect(result.current.handleChange).toBe(first)
  })

  it('呼叫端的 onHandleChange 收到同一份 handle,而且是最新的函式', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = renderHook(({ cb }) => useMapHandle(cb), { initialProps: { cb: first } })
    rerender({ cb: second })
    const h = handle(fakeMap('a'))
    act(() => result.current.handleChange(h))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(h)
  })
})

describe('usePlanMapDrawing', () => {
  const map = { mapRef: { current: fakeMap('m') }, mapReady: true, mapVersion: 3 }
  const stops = [{ id: 'a', lat: 1, lng: 2 }]
  const last = () => drawArgs[drawArgs.length - 1] as {
    mapRef: unknown
    mapReady: boolean
    mapVersion: number
    theme?: string | null
    currentPosition: unknown
    stopDots: Record<string, unknown>
    routeLine: { enabled: boolean }
    tripEntries?: unknown
    searchResults?: unknown
  }

  it('地圖狀態、主題原樣交給統一繪製層', () => {
    renderHook(() => usePlanMapDrawing({ ...map, theme: 'dark', stops }))
    expect(last().mapRef).toBe(map.mapRef)
    expect(last().mapReady).toBe(true)
    expect(last().mapVersion).toBe(3)
    expect(last().theme).toBe('dark')
  })

  it('站點、選取、hover、轉乘配對、點擊回呼變成 stopDots(selectedStopId → selectedId、hoverStopId → hoverId、onStopClick → onPointClick)', () => {
    const onStopClick = vi.fn()
    const pair = { fromId: 'a', toId: 'b' }
    renderHook(() => usePlanMapDrawing({ ...map, stops, selectedStopId: 'a', hoverStopId: 'b', hoverTransitPair: pair, onStopClick }))
    const dots = last().stopDots
    expect(dots.stops).toBe(stops)
    expect(dots.selectedId).toBe('a')
    expect(dots.hoverId).toBe('b')
    expect(dots.hoverTransitPair).toBe(pair)
    expect(dots.onPointClick).toBe(onStopClick)
  })

  it('沒傳站點:用同一個空陣列(身分穩定,不會每次渲染都換新)', () => {
    const { rerender } = renderHook(() => usePlanMapDrawing({ ...map }))
    const first = last().stopDots.stops
    rerender()
    expect(last().stopDots.stops).toBe(first)
    expect(first).toEqual([])
  })

  it('showPlanRouteLine 變成 routeLine.enabled,預設 false', () => {
    renderHook(() => usePlanMapDrawing({ ...map, stops }))
    expect(last().routeLine).toEqual({ enabled: false })
    renderHook(() => usePlanMapDrawing({ ...map, stops, showPlanRouteLine: true }))
    expect(last().routeLine).toEqual({ enabled: true })
  })

  it('目前位置:沒傳(或 undefined)就是 null(不畫藍點)', () => {
    renderHook(() => usePlanMapDrawing({ ...map, stops }))
    expect(last().currentPosition).toBeNull()
    renderHook(() => usePlanMapDrawing({ ...map, stops, currentPosition: { lat: 1, lng: 2 } }))
    expect(last().currentPosition).toEqual({ lat: 1, lng: 2 })
  })

  it('行程 entry 與搜尋結果只有傳了才交給統一繪製層(/ai-plan 不傳)', () => {
    renderHook(() => usePlanMapDrawing({ ...map, stops }))
    expect(last().tripEntries).toBeUndefined()
    expect(last().searchResults).toBeUndefined()
    const tripEntries = { entries: [] }
    const searchResults = { results: [] }
    renderHook(() => usePlanMapDrawing({ ...map, stops, tripEntries, searchResults }))
    expect(last().tripEntries).toBe(tripEntries)
    expect(last().searchResults).toBe(searchResults)
  })

  it('回傳目前展開的主題點 id', () => {
    const { result } = renderHook(() => usePlanMapDrawing({ ...map, stops }))
    expect(result.current.expandedThemeId).toBe('theme-1')
  })
})
