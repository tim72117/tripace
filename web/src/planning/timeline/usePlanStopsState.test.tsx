// usePlanStopsState / usePlanSelection:規劃面板站點的檢視狀態。
// 原本 /ai-plan(usePlanSelection 只有選取與 hover)、登入後手機(planning/member/phone/Content 的四個 useState)與
// 桌面(planning/member/desktop/Content 同樣四個 useState)各寫一份,現在共用這一份。
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { maskPlanStopsView, usePlanSelection, usePlanStopsState } from './usePlanStopsState'

describe('usePlanSelection', () => {
  it('初始沒有選取也沒有 hover', () => {
    const { result } = renderHook(() => usePlanSelection())
    expect(result.current.selectedStopId).toBeNull()
    expect(result.current.hoverStopId).toBeNull()
  })

  it('setter 寫入選取與 hover', () => {
    const { result } = renderHook(() => usePlanSelection())
    act(() => result.current.setSelectedStopId('a'))
    act(() => result.current.setHoverStopId('b'))
    expect(result.current.selectedStopId).toBe('a')
    expect(result.current.hoverStopId).toBe('b')
  })
})

describe('usePlanStopsState', () => {
  const stop = (id: string) => ({ id, lat: 1, lng: 2 })

  it('初始:沒有站點、選取、hover、轉乘配對', () => {
    const { result } = renderHook(() => usePlanStopsState())
    expect(result.current.stops).toEqual([])
    expect(result.current.selectedStopId).toBeNull()
    expect(result.current.hoverStopId).toBeNull()
    expect(result.current.hoverTransitPair).toBeNull()
  })

  it('tripPlanProps 的四個回呼把 TripPlanPage 回報的東西寫進對應的狀態', () => {
    const { result } = renderHook(() => usePlanStopsState())
    act(() => result.current.tripPlanProps.onStopsChange([stop('a'), stop('b')]))
    act(() => result.current.tripPlanProps.onSelectedStopChange('a'))
    act(() => result.current.tripPlanProps.onHoverStopChange('b'))
    act(() => result.current.tripPlanProps.onHoverTransitChange({ fromId: 'a', toId: 'b' }))
    expect(result.current.stops.map((s) => s.id)).toEqual(['a', 'b'])
    expect(result.current.selectedStopId).toBe('a')
    expect(result.current.hoverStopId).toBe('b')
    expect(result.current.hoverTransitPair).toEqual({ fromId: 'a', toId: 'b' })
  })

  it('回呼可以清掉:選取、hover、轉乘配對傳 null', () => {
    const { result } = renderHook(() => usePlanStopsState())
    act(() => {
      result.current.tripPlanProps.onSelectedStopChange('a')
      result.current.tripPlanProps.onHoverStopChange('b')
      result.current.tripPlanProps.onHoverTransitChange({ fromId: 'a', toId: 'b' })
    })
    act(() => {
      result.current.tripPlanProps.onSelectedStopChange(null)
      result.current.tripPlanProps.onHoverStopChange(null)
      result.current.tripPlanProps.onHoverTransitChange(null)
    })
    expect(result.current.selectedStopId).toBeNull()
    expect(result.current.hoverStopId).toBeNull()
    expect(result.current.hoverTransitPair).toBeNull()
  })

  it('點地圖圓點:setSelectedStopId 與 TripPlanPage 的選取回呼寫的是同一個狀態(兩邊不會各自高亮不同站)', () => {
    const { result } = renderHook(() => usePlanStopsState())
    act(() => result.current.setSelectedStopId('map-click'))
    expect(result.current.selectedStopId).toBe('map-click')
    act(() => result.current.tripPlanProps.onSelectedStopChange('card-click'))
    expect(result.current.selectedStopId).toBe('card-click')
  })

  it('tripPlanProps 與各 setter 的身分穩定(傳給 TripPlanPage 不會讓它每次渲染都收到新函式)', () => {
    const { result, rerender } = renderHook(() => usePlanStopsState())
    const first = result.current.tripPlanProps
    act(() => result.current.setSelectedStopId('a'))
    rerender()
    expect(result.current.tripPlanProps).toBe(first)
  })
})

describe('maskPlanStopsView', () => {
  const view = {
    stops: [{ id: 'a', lat: 1, lng: 2 }] as never,
    selectedStopId: 'a',
    hoverStopId: 'a',
    hoverTransitPair: { fromId: 'a', toId: 'b' } as never,
  }

  it('面板可見:原樣回傳', () => {
    expect(maskPlanStopsView(view, true)).toBe(view)
  })

  it('面板關閉:站點、選取、hover、轉乘配對整組遮蔽,且每次是同一個(身分穩定)', () => {
    const hidden = maskPlanStopsView(view, false)
    expect(hidden).toEqual({ stops: [], selectedStopId: null, hoverStopId: null, hoverTransitPair: null })
    expect(maskPlanStopsView(view, false)).toBe(hidden)
  })
})
