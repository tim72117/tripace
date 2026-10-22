// routeLineLayer 放進 useMapDrawLayer 的整合測試:假 google.maps 只提供 Polyline。
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMapDrawLayer } from '../index'
import { GROUP_Z } from '../zOrder'
import { routeLineLayer } from './routeLineLayer'

class FakePolyline {
  static all: FakePolyline[] = []
  options: Record<string, unknown>
  map: unknown
  constructor(opts: Record<string, unknown>) {
    this.options = { ...opts }
    this.map = opts.map
    FakePolyline.all.push(this)
  }
  setOptions(o: Record<string, unknown>) {
    Object.assign(this.options, o)
  }
  setMap(m: unknown) {
    this.map = m
  }
}
;(globalThis as { google?: unknown }).google = {
  maps: { Polyline: FakePolyline, event: { clearInstanceListeners: () => {} } },
}
const visible = () => FakePolyline.all.filter((p) => p.map != null)

const A = { id: 'a', lat: 1, lng: 2 }
const B = { id: 'b', lat: 3, lng: 4 }
const C = { id: 'c', lat: 5, lng: 6 }

type P = { stops: { id: string; lat: number; lng: number }[]; enabled: boolean }
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
  it('畫出一條 polyline,zIndex 為 GROUP_Z.routeLine,樣式帶上', () => {
    setup({ stops: [A, B], enabled: true })
    expect(visible()).toHaveLength(1)
    const o = visible()[0].options
    expect(o.zIndex).toBe(GROUP_Z.routeLine)
    expect(o.strokeColor).toBe('#abc')
    expect(o.path).toEqual([
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
    ])
  })

  it('關閉後被移除', () => {
    const h = setup({ stops: [A, B], enabled: true })
    h.rerender({ stops: [A, B], enabled: false })
    expect(visible()).toHaveLength(0)
  })

  it('站點增加時原地更新(不重建)', () => {
    const h = setup({ stops: [A, B], enabled: true })
    const first = visible()[0]
    h.rerender({ stops: [A, B, C], enabled: true })
    expect(FakePolyline.all).toHaveLength(1)
    expect(visible()[0]).toBe(first)
    expect(first.options.path).toHaveLength(3)
  })
})
