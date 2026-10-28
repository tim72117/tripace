import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTrips } from './useTrips'
import { createTripTimelineStore } from './trips'

beforeEach(() => {
  localStorage.clear()
})

describe('useTrips', () => {
  it('建立、改名、切換、刪除都會反映到畫面狀態', () => {
    const { result } = renderHook(() => useTrips())
    expect(result.current.trips).toEqual([])
    expect(result.current.activeTrip).toBeNull()

    let aId = ''
    act(() => {
      aId = result.current.create('A').id
    })
    expect(result.current.trips.map((t) => t.name)).toEqual(['A'])
    expect(result.current.activeTripId).toBe(aId)

    act(() => {
      result.current.create('B')
    })
    expect(result.current.trips).toHaveLength(2)

    act(() => {
      result.current.setActive(aId)
      result.current.rename(aId, '日本')
    })
    expect(result.current.activeTrip?.name).toBe('日本')

    act(() => {
      result.current.remove(aId)
    })
    expect(result.current.trips.map((t) => t.name)).toEqual(['B'])
  })

  it('時間軸存檔後,清單的標題跟著更新', () => {
    const { result } = renderHook(() => useTrips())
    let id = ''
    act(() => {
      id = result.current.create().id
    })
    act(() => {
      createTripTimelineStore(id).saveTimeline({ days: [{ id: 'd', nodes: [{ id: 'n', type: 'stop', name: '赤崁樓' }] }] }, 0)
    })
    expect(result.current.trips[0].title).toBe('赤崁樓')
  })
})
