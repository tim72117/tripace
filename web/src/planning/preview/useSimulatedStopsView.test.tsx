// useSimulatedStopsView:模擬態的站點檢視實例——站點從劇本時間軸投影,選取自己持有(不與推論態共用)。
import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSimulatedStopsView } from './useSimulatedStopsView'
import type { PlanNode } from '../timeline/model'
import { timelineOf } from '../timeline/fixtures'
import type { PlanAiDataSource } from '../data/source'
import { withPlanData } from '../data/fixtures'

const stop = (id: string, lat?: number, lng?: number) => ({ id, type: 'stop', name: id, lat, lng }) as unknown as PlanNode

describe('useSimulatedStopsView', () => {
  it('只投影有座標的 stop 節點;選取初值為 null', () => {
    const timeline = timelineOf([stop('a', 1, 2), stop('b')])
    const { result } = renderHook(() => useSimulatedStopsView(timeline, { current: null }), { wrapper: withPlanData() })
    expect(result.current.stops.map((s) => s.id)).toEqual(['a'])
    expect(result.current.selectedStopId).toBeNull()
    expect(result.current.hoverStopId).toBeNull()
  })

  it('自己持有選取:setter 寫入的是這個實例', () => {
    const single = timelineOf([stop('a', 1, 2)])
    const { result } = renderHook(() => useSimulatedStopsView(single, { current: null }), { wrapper: withPlanData() })
    act(() => result.current.setSelectedStopId('a'))
    act(() => result.current.setHoverStopId('a'))
    expect(result.current.selectedStopId).toBe('a')
    expect(result.current.hoverStopId).toBe('a')
  })

  it('新插入的站(latestInsertedStopIdRef)自動選中,同一個 id 只同步一次,使用者之後改選不會被搶回', () => {
    const ref = { current: 'a' as string | null }
    const timeline = timelineOf([stop('a', 1, 2), stop('b', 3, 4)])
    const { result, rerender } = renderHook(() => useSimulatedStopsView(timeline, ref), { wrapper: withPlanData() })
    expect(result.current.selectedStopId).toBe('a')
    act(() => result.current.setSelectedStopId('b'))
    rerender()
    expect(result.current.selectedStopId).toBe('b')
  })

  it('主題點底下的 places 經資料存取層解析後,stops 才帶 children(只收有座標的);查詢完成前先當一般站點', async () => {
    const ds = {
      placeDetails: async (id: string) =>
        id === 'p-ok' ? { found: true, name: '子景點', lat: 5, lng: 6 } : { found: false },
      transitEstimate: async () => ({ mode: '', icon: '', minutes: 0, distance: '' }),
    } as unknown as PlanAiDataSource
    const timeline = timelineOf([{ ...stop('theme', 1, 2), places: ['p-ok', 'p-missing'] } as PlanNode])
    const { result } = renderHook(() => useSimulatedStopsView(timeline, { current: null }), { wrapper: withPlanData(ds) })
    expect(result.current.stops[0].children).toBeUndefined()
    await waitFor(() => expect(result.current.stops[0].children).toEqual([{ id: 'p-ok', lat: 5, lng: 6, name: '子景點' }]))
  })
})
