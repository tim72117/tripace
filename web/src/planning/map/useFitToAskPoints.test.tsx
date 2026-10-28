import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ASK_FIT_DEBOUNCE_MS, useFitToAskPoints } from './planMapShared'
import type { GeoSearchResult } from '../../api'

const pt = (placeId: string, lat: number, lng: number): GeoSearchResult => ({ kind: 'place', name: placeId, address: '', lat, lng, placeId })

class FakeBounds {
  points: { lat: number; lng: number }[] = []
  extend(p: { lat: number; lng: number }) {
    this.points.push(p)
  }
}

let map: { fitBounds: ReturnType<typeof vi.fn>; panTo: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.useFakeTimers()
  map = { fitBounds: vi.fn(), panTo: vi.fn() }
  ;(globalThis as unknown as { google: unknown }).google = { maps: { LatLngBounds: FakeBounds } }
})
afterEach(() => {
  vi.useRealTimers()
})

function setup(results: GeoSearchResult[], mapReady = true) {
  return renderHook(({ r, ready }) => useFitToAskPoints({ current: map as unknown as google.maps.Map }, ready, r), {
    initialProps: { r: results, ready: mapReady },
  })
}

describe('useFitToAskPoints', () => {
  it('點陸續出現:等穩定 ASK_FIT_DEBOUNCE_MS 後只對焦一次(用最後一批點)', () => {
    const { rerender } = setup([pt('a', 1, 1), pt('b', 2, 2)])
    vi.advanceTimersByTime(ASK_FIT_DEBOUNCE_MS - 50)
    rerender({ r: [pt('a', 1, 1), pt('b', 2, 2), pt('c', 3, 3)], ready: true })
    vi.advanceTimersByTime(ASK_FIT_DEBOUNCE_MS - 50)
    expect(map.fitBounds).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60)
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    const bounds = map.fitBounds.mock.calls[0][0] as FakeBounds
    expect(bounds.points).toHaveLength(3)
    expect(map.fitBounds.mock.calls[0][1]).toBe(64)
  })

  it('單點只平移;勾選變動(點集合沒變)不再對焦;沒有點或地圖未就緒不動作', () => {
    const one = setup([pt('a', 1, 2)])
    vi.advanceTimersByTime(ASK_FIT_DEBOUNCE_MS)
    expect(map.panTo).toHaveBeenCalledWith({ lat: 1, lng: 2 })
    expect(map.fitBounds).not.toHaveBeenCalled()
    one.unmount()

    map.fitBounds.mockClear()
    const many = setup([pt('a', 1, 1), pt('b', 2, 2)])
    vi.advanceTimersByTime(ASK_FIT_DEBOUNCE_MS)
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    many.rerender({ r: [pt('a', 1, 1), pt('b', 2, 2)], ready: true }) // 新陣列但內容相同
    vi.advanceTimersByTime(ASK_FIT_DEBOUNCE_MS * 2)
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    many.unmount()

    map.fitBounds.mockClear()
    setup([])
    setup([pt('a', 1, 1), pt('b', 2, 2)], false)
    vi.advanceTimersByTime(ASK_FIT_DEBOUNCE_MS * 2)
    expect(map.fitBounds).not.toHaveBeenCalled()
  })
})
