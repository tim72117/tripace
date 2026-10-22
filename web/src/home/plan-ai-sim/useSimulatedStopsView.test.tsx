// useSimulatedStopsView:模擬態的站點檢視實例——站點從劇本時間軸投影,選取自己持有(不與推論態共用)。
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSimulatedStopsView } from './useSimulatedStopsView'
import type { PlanNode } from '../../plan-core/planTimeline'

const stop = (id: string, lat?: number, lng?: number) => ({ id, type: 'stop', name: id, lat, lng }) as unknown as PlanNode

describe('useSimulatedStopsView', () => {
  it('只投影有座標的 stop 節點;選取初值為 null', () => {
    const steps = [stop('a', 1, 2), stop('b'), { id: 's', type: 'section' } as unknown as PlanNode]
    const { result } = renderHook(() => useSimulatedStopsView(steps, { current: null }))
    expect(result.current.stops.map((s) => s.id)).toEqual(['a'])
    expect(result.current.selectedStopId).toBeNull()
    expect(result.current.hoverStopId).toBeNull()
  })

  it('自己持有選取:setter 寫入的是這個實例', () => {
    const { result } = renderHook(() => useSimulatedStopsView([stop('a', 1, 2)], { current: null }))
    act(() => result.current.setSelectedStopId('a'))
    act(() => result.current.setHoverStopId('a'))
    expect(result.current.selectedStopId).toBe('a')
    expect(result.current.hoverStopId).toBe('a')
  })

  it('新插入的站(latestInsertedStopIdRef)自動選中,同一個 id 只同步一次,使用者之後改選不會被搶回', () => {
    const ref = { current: 'a' as string | null }
    const steps = [stop('a', 1, 2), stop('b', 3, 4)]
    const { result, rerender } = renderHook(() => useSimulatedStopsView(steps, ref))
    expect(result.current.selectedStopId).toBe('a')
    act(() => result.current.setSelectedStopId('b'))
    rerender()
    expect(result.current.selectedStopId).toBe('b')
  })
})
