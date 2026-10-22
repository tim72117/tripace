// panMapTo:把地圖移到某個點,若有「安全區」元素(UI 層配出來、看不見的主顯示區洞)就移到讓目標落在安全區中心。
// 從 useMapSafeArea 抽出來,讓 /ai-plan 的 useMapSafeArea 與登入後的 usePanTarget 走同一條路。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const solve = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('./solveSafeAreaCenter', () => ({ solveSafeAreaCenter: (...a: unknown[]) => solve.fn(...a) }))

import { panMapTo } from './panMapTo'

class FakeLatLng {
  constructor(
    public lat: number,
    public lng: number,
  ) {}
}
class FakePoint {
  constructor(
    public x: number,
    public y: number,
  ) {}
}
;(globalThis as { google?: unknown }).google = { maps: { LatLng: FakeLatLng, Point: FakePoint } }

const target = { lat: 1, lng: 2 }

function fakeMap(over: Record<string, unknown> = {}) {
  const panTo = vi.fn()
  const projection = {
    fromLatLngToPoint: vi.fn((ll: FakeLatLng) => new FakePoint(ll.lng, ll.lat)),
    fromPointToLatLng: vi.fn((p: FakePoint) => ({ lat: () => p.y, lng: () => p.x })),
  }
  const map = {
    panTo,
    getProjection: () => projection,
    getZoom: () => 14,
    getCenter: () => ({ lat: () => 10, lng: () => 20 }),
    getDiv: () => ({ getBoundingClientRect: () => ({ top: 0, left: 0, width: 390, height: 844 }) }),
    ...over,
  }
  return { map: map as unknown as google.maps.Map, panTo, projection }
}

const safeEl = { getBoundingClientRect: () => ({ top: 72, left: 0, width: 390, height: 318 }) } as unknown as Element

beforeEach(() => {
  solve.fn.mockReset()
})

describe('panMapTo', () => {
  it('沒有安全區元素:就是 map.panTo(target)(同一個物件,行為與原本直接呼叫完全相同)', () => {
    const { map, panTo } = fakeMap()
    panMapTo(map, target, null)
    expect(panTo).toHaveBeenCalledWith(target)
    expect(panTo.mock.calls[0][0]).toBe(target)
    expect(solve.fn).not.toHaveBeenCalled()
  })

  it('沒傳安全區參數:同上', () => {
    const { map, panTo } = fakeMap()
    panMapTo(map, target)
    expect(panTo.mock.calls[0][0]).toBe(target)
  })

  it('安全區沒有面積(疊加層收起,display: none):視為沒有安全區,退回 map.panTo(target)', () => {
    const hidden = { getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }) } as unknown as Element
    const { map, panTo } = fakeMap()
    panMapTo(map, target, hidden)
    expect(panTo.mock.calls[0][0]).toBe(target)
    expect(solve.fn).not.toHaveBeenCalled()
  })

  it('地圖還拿不到投影、縮放或中心:退回 map.panTo(target)', () => {
    for (const over of [{ getProjection: () => null }, { getZoom: () => undefined }, { getCenter: () => undefined }]) {
      const { map, panTo } = fakeMap(over)
      panMapTo(map, target, safeEl)
      expect(panTo).toHaveBeenCalledWith(target)
      expect(solve.fn).not.toHaveBeenCalled()
    }
  })

  it('解不出來(solver 回 null):退回 map.panTo(target)', () => {
    solve.fn.mockReturnValue(null)
    const { map, panTo } = fakeMap()
    panMapTo(map, target, safeEl)
    expect(panTo).toHaveBeenCalledWith(target)
  })

  it('解得出來:移到 solver 算出的新中心,讓目標落在安全區中心', () => {
    solve.fn.mockReturnValue({ newCenter: { lat: 5, lng: 6 } })
    const { map, panTo } = fakeMap()
    panMapTo(map, target, safeEl)
    expect(panTo).toHaveBeenCalledWith({ lat: 5, lng: 6 })
  })

  it('把目標、目前中心、縮放、地圖與安全區的螢幕範圍交給 solver', () => {
    solve.fn.mockReturnValue({ newCenter: { lat: 5, lng: 6 } })
    const { map } = fakeMap()
    panMapTo(map, target, safeEl)
    const arg = solve.fn.mock.calls[0][0] as Record<string, unknown>
    expect(arg.target).toBe(target)
    expect(arg.currentCenter).toEqual({ lat: 10, lng: 20 })
    expect(arg.zoom).toBe(14)
    expect(arg.mapRect).toEqual({ top: 0, left: 0, width: 390, height: 844 })
    expect(arg.safeRect).toEqual({ top: 72, left: 0, width: 390, height: 318 })
  })

  it('solver 的座標換算:經度緯度 ↔ 投影點,點換不回座標時回 null', () => {
    solve.fn.mockReturnValue({ newCenter: { lat: 5, lng: 6 } })
    const { map, projection } = fakeMap()
    panMapTo(map, target, safeEl)
    const arg = solve.fn.mock.calls[0][0] as {
      projectToPoint: (l: { lat: number; lng: number }) => unknown
      projectToLatLng: (p: { x: number; y: number }) => unknown
    }
    expect(arg.projectToPoint({ lat: 3, lng: 4 })).toEqual(new FakePoint(4, 3))
    expect(arg.projectToLatLng({ x: 8, y: 7 })).toEqual({ lat: 7, lng: 8 })
    projection.fromPointToLatLng.mockReturnValueOnce(null as never)
    expect(arg.projectToLatLng({ x: 1, y: 1 })).toBeNull()
  })
})
