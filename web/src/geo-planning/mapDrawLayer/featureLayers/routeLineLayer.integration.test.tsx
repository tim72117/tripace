// routeLineLayer 放進 useMapDrawLayer 的整合測試:假 google.maps 只提供 Polyline。
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMapDrawLayer } from '../index'
import { GROUP_Z } from '../zOrder'
import { routeLineLayer, type RouteLineSegment } from './routeLineLayer'

class FakePolyline {
  static all: FakePolyline[] = []
  options: Record<string, unknown>
  map: unknown
  updates = 0
  constructor(opts: Record<string, unknown>) {
    this.options = { ...opts }
    this.map = opts.map
    FakePolyline.all.push(this)
  }
  setOptions(o: Record<string, unknown>) {
    Object.assign(this.options, o)
    this.updates++
  }
  setMap(m: unknown) {
    this.map = m
  }
}
;(globalThis as { google?: unknown }).google = {
  maps: { Polyline: FakePolyline, event: { clearInstanceListeners: () => {} } },
}
const visible = () => FakePolyline.all.filter((p) => p.map != null)

const AB: RouteLineSegment = { id: 'a->b', from: { lat: 1, lng: 2 }, to: { lat: 3, lng: 4 } }
const BC: RouteLineSegment = { id: 'b->c', from: { lat: 3, lng: 4 }, to: { lat: 5, lng: 6 } }

type P = { segments: RouteLineSegment[] }
function setup(init: P) {
  const ref = { current: { tag: 'map' } as unknown as google.maps.Map | null }
  return renderHook(
    (p: P) => useMapDrawLayer({ mapRef: ref, mapReady: true, layers: [routeLineLayer({ ...p, accentColor: '#abc' })] }),
    { initialProps: init },
  )
}

beforeEach(() => {
  FakePolyline.all = []
})

describe('routeLineLayer + useMapDrawLayer', () => {
  it('每段畫光暈 + 顏色線兩條 polyline,zIndex 分別為 GROUP_Z.routeCasing / routeLine(光暈在下),樣式帶上,路徑是弧線', () => {
    setup({ segments: [AB] })
    expect(visible()).toHaveLength(2)
    const [casing, line] = visible()
    expect(casing.options.zIndex).toBe(GROUP_Z.routeCasing)
    expect(line.options.zIndex).toBe(GROUP_Z.routeLine)
    expect(GROUP_Z.routeCasing).toBeLessThan(GROUP_Z.routeLine)
    expect(line.options.strokeColor).toBe('#abc')
    expect(line.options.clickable).toBe(false)
    const path = line.options.path as { lat: number; lng: number }[]
    expect(path[0]).toEqual({ lat: 1, lng: 2 })
    expect(path[path.length - 1]).toEqual({ lat: 3, lng: 4 })
    expect(path.length).toBeGreaterThan(2)
    expect(casing.options.path).toEqual(line.options.path)
  })

  it('段清空後全部移除', () => {
    const h = setup({ segments: [AB, BC] })
    expect(visible()).toHaveLength(4)
    h.rerender({ segments: [] })
    expect(visible()).toHaveLength(0)
  })

  it('加一段只新建那一段的兩條;改一段的座標只原地更新那一段,不重建', () => {
    const h = setup({ segments: [AB] })
    const [casing, line] = visible()
    h.rerender({ segments: [AB, BC] })
    expect(FakePolyline.all).toHaveLength(4)
    expect(visible()[0]).toBe(casing)
    expect(visible()[1]).toBe(line)
    expect(line.updates).toBe(0)

    h.rerender({ segments: [AB, { ...BC, to: { lat: 7, lng: 8 } }] })
    expect(FakePolyline.all).toHaveLength(4)
    expect(FakePolyline.all.map((p) => p.updates)).toEqual([0, 0, 1, 1])
    const path = FakePolyline.all[3].options.path as { lat: number; lng: number }[]
    expect(path[path.length - 1]).toEqual({ lat: 7, lng: 8 })
  })
})
