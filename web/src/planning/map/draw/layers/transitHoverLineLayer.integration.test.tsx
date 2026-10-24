// transitHoverLineLayer 放進 useMapDrawLayer 的整合測試:假 google.maps 只提供 Polyline。
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMapDrawLayer } from '../index'
import { GROUP_Z } from '../zOrder'
import { transitHoverLineLayer } from './transitHoverLineLayer'

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

const stops = [
  { id: 'a', lat: 1, lng: 2 },
  { id: 'b', lat: 3, lng: 4 },
  { id: 'c', lat: 5, lng: 6 },
]

function setup(pair: { fromId: string; toId: string } | null) {
  const ref = { current: { tag: 'map' } as unknown as google.maps.Map | null }
  const render = (p: { fromId: string; toId: string } | null) => ({
    mapRef: ref,
    mapReady: true,
    layers: [transitHoverLineLayer({ stops, hoverTransitPair: p, accentColor: '#8B3A2F' })],
  })
  const hook = renderHook((p: ReturnType<typeof render>) => useMapDrawLayer(p), { initialProps: render(pair) })
  return { hook, render }
}

beforeEach(() => {
  FakePolyline.all = []
})

describe('transitHoverLineLayer + useMapDrawLayer', () => {
  it('hover 時畫一條虛線,zIndex 取自 GROUP_Z.transitHoverLine', () => {
    setup({ fromId: 'a', toId: 'b' })
    expect(visible()).toHaveLength(1)
    expect(visible()[0].options).toMatchObject({
      zIndex: GROUP_Z.transitHoverLine,
      strokeOpacity: 0,
      clickable: false,
    })
    // 路徑是弧線取樣:兩端是站點本身(形狀由 routeArc.test 驗)。
    const path = visible()[0].options.path as { lat: number; lng: number }[]
    expect(path[0]).toEqual({ lat: 1, lng: 2 })
    expect(path[path.length - 1]).toEqual({ lat: 3, lng: 4 })
  })

  it('hover 離開:線被移除', () => {
    const { hook, render } = setup({ fromId: 'a', toId: 'b' })
    hook.rerender(render(null))
    expect(visible()).toHaveLength(0)
  })

  it('hover 換成另一段:原地更新路徑,不重建', () => {
    const { hook, render } = setup({ fromId: 'a', toId: 'b' })
    const first = visible()[0]
    hook.rerender(render({ fromId: 'b', toId: 'c' }))
    expect(FakePolyline.all).toHaveLength(1)
    expect(visible()[0]).toBe(first)
    const path = first.options.path as { lat: number; lng: number }[]
    expect(path[0]).toEqual({ lat: 3, lng: 4 })
    expect(path[path.length - 1]).toEqual({ lat: 5, lng: 6 })
  })
})
