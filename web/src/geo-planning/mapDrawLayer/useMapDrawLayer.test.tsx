// useMapDrawLayer 測試:統一繪製層(2026-10)。
//
// 假的 google.maps 只提供這支 hook 實際用到的最小介面(AdvancedMarkerElement、Circle、Polyline、
// event.clearInstanceListeners)。斷言看的是「地圖上現在畫著什麼」,以及重建、更新、清理的時機。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMapDrawLayer } from './index'
import type { Drawable, FeatureLayer, MarkerDrawable } from './types'
import { GROUP_Z } from './zOrder'

class FakeMarker {
  static all: FakeMarker[] = []
  map: unknown
  position: unknown
  title?: string
  zIndex?: number
  content: unknown
  gmpClickable?: boolean
  clickHandlers: (() => void)[] = []
  constructor(opts: Record<string, unknown>) {
    Object.assign(this, opts)
    FakeMarker.all.push(this)
  }
  addListener(event: string, h: () => void) {
    if (event === 'gmp-click') this.clickHandlers.push(h)
    return { remove: () => {} }
  }
  click() {
    this.clickHandlers.forEach((h) => h())
  }
}
class FakeShape {
  static all: FakeShape[] = []
  options: Record<string, unknown>
  map: unknown
  constructor(
    public kind: 'circle' | 'polyline',
    opts: Record<string, unknown>,
  ) {
    this.options = { ...opts }
    this.map = opts.map
    FakeShape.all.push(this)
  }
  setOptions(o: Record<string, unknown>) {
    Object.assign(this.options, o)
  }
  setMap(m: unknown) {
    this.map = m
  }
}
class FakeCircle extends FakeShape {
  constructor(o: Record<string, unknown>) {
    super('circle', o)
  }
}
class FakePolyline extends FakeShape {
  constructor(o: Record<string, unknown>) {
    super('polyline', o)
  }
}
const cleared: unknown[] = []

;(globalThis as { google?: unknown }).google = {
  maps: {
    marker: { AdvancedMarkerElement: FakeMarker },
    Circle: FakeCircle,
    Polyline: FakePolyline,
    event: { clearInstanceListeners: (x: unknown) => cleared.push(x) },
  },
}

const visibleMarkers = () => FakeMarker.all.filter((m) => m.map != null)
const visibleShapes = (kind?: string) => FakeShape.all.filter((s) => s.map != null && (!kind || s.kind === kind))

const marker = (id: string, extra: Partial<MarkerDrawable> = {}): MarkerDrawable => ({
  id,
  group: 'currentLocation',
  kind: 'marker',
  position: { lat: 1, lng: 2 },
  title: id,
  contentKey: 'k',
  createContent: () => document.createElement('i'),
  ...extra,
})

const one = (drawables: Drawable[]): FeatureLayer[] => [{ id: 't', drawables }]

type Props = Parameters<typeof useMapDrawLayer>[0]
function setup(drawables: Drawable[], over: Partial<Props> = {}) {
  const map = { tag: 'map1' } as unknown as google.maps.Map
  const ref = { current: map as google.maps.Map | null }
  const base: Props = { mapRef: ref, mapReady: true, layers: one(drawables) }
  const props = { ...base, ...over }
  const hook = renderHook((p: Props) => useMapDrawLayer(p), { initialProps: props })
  return { hook, props, ref, map }
}

beforeEach(() => {
  FakeMarker.all = []
  FakeShape.all = []
  cleared.length = 0
})

describe('useMapDrawLayer 基本', () => {
  it('mapReady 為 false 時什麼都不畫;好了之後才畫', () => {
    const { hook, props } = setup([marker('a')], { mapReady: false })
    expect(visibleMarkers()).toHaveLength(0)
    hook.rerender({ ...props, mapReady: true })
    expect(visibleMarkers()).toHaveLength(1)
  })

  it('marker:位置、標題、內容、地圖都帶上,zIndex 依群組查表,預設不可點', () => {
    const { map } = setup([marker('a', { group: 'planStop' })])
    const m = visibleMarkers()[0]
    expect(m.position).toEqual({ lat: 1, lng: 2 })
    expect(m.title).toBe('a')
    expect(m.map).toBe(map)
    expect(m.zIndex).toBe(GROUP_Z.planStop)
    expect(m.gmpClickable).not.toBe(true)
    expect(m.content).toBeInstanceOf(HTMLElement)
  })

  it('circle 與 polyline:畫在地圖上、zIndex 依群組、不可點', () => {
    setup([
      { id: 'c', group: 'searchResult', kind: 'circle', center: { lat: 1, lng: 2 }, radiusMeters: 300 },
      { id: 'p', group: 'tripEntry', kind: 'polyline', path: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }], options: { strokeWeight: 3 } },
    ])
    expect(visibleShapes('circle')[0].options).toMatchObject({
      center: { lat: 1, lng: 2 },
      radius: 300,
      zIndex: GROUP_Z.searchResult,
      clickable: false,
    })
    expect(visibleShapes('polyline')[0].options).toMatchObject({
      path: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }],
      zIndex: GROUP_Z.tripEntry,
      strokeWeight: 3,
      clickable: false,
    })
  })

  it('三種原生類型可以同時存在、各自獨立', () => {
    setup([
      marker('m'),
      { id: 'c', group: 'planStop', kind: 'circle', center: { lat: 0, lng: 0 }, radiusMeters: 10 },
      { id: 'p', group: 'planStop', kind: 'polyline', path: [] },
    ])
    expect(visibleMarkers()).toHaveLength(1)
    expect(visibleShapes()).toHaveLength(2)
  })
})

describe('useMapDrawLayer 組合多個功能層', () => {
  it('多個功能層的東西一起畫在同一張地圖上', () => {
    setup([], {
      layers: [
        { id: 'a', drawables: [marker('1')] },
        { id: 'b', drawables: [marker('2'), { id: 'c', group: 'planStop', kind: 'circle', center: { lat: 0, lng: 0 }, radiusMeters: 1 }] },
      ],
    })
    expect(visibleMarkers()).toHaveLength(2)
    expect(visibleShapes('circle')).toHaveLength(1)
  })

  it('不同功能層使用相同 id 不會互相覆蓋', () => {
    setup([], { layers: [{ id: 'a', drawables: [marker('x')] }, { id: 'b', drawables: [marker('x')] }] })
    expect(visibleMarkers()).toHaveLength(2)
  })

  it('其中一個功能層的內容變成空:只移除它的,其他功能層不受影響', () => {
    const { hook, props } = setup([], { layers: [{ id: 'a', drawables: [marker('1')] }, { id: 'b', drawables: [marker('2')] }] })
    hook.rerender({ ...props, layers: [{ id: 'a', drawables: [] }, { id: 'b', drawables: [marker('2')] }] })
    expect(visibleMarkers().map((m) => m.title)).toEqual(['2'])
  })

  it('其中一個功能層更新:另一個功能層的 marker 不會被重建', () => {
    const { hook, props } = setup([], { layers: [{ id: 'a', drawables: [marker('1')] }, { id: 'b', drawables: [marker('2')] }] })
    const untouched = visibleMarkers().find((m) => m.title === '2')!
    hook.rerender({ ...props, layers: [{ id: 'a', drawables: [marker('1', { position: { lat: 7, lng: 7 } })] }, { id: 'b', drawables: [marker('2')] }] })
    expect(visibleMarkers().find((m) => m.title === '2')).toBe(untouched)
    expect(FakeMarker.all).toHaveLength(2)
  })
})

describe('useMapDrawLayer 更新', () => {
  it('位置改變:原地更新同一個 marker,不重建', () => {
    const { hook, props } = setup([marker('a')])
    const first = visibleMarkers()[0]
    hook.rerender({ ...props, layers: one([marker('a', { position: { lat: 9, lng: 9 } })]) })
    expect(visibleMarkers()).toHaveLength(1)
    expect(visibleMarkers()[0]).toBe(first)
    expect(first.position).toEqual({ lat: 9, lng: 9 })
  })

  it('內容 key 改變:重新產生內容;沒變就不重新產生', () => {
    const createContent = vi.fn(() => document.createElement('i'))
    const { hook, props } = setup([marker('a', { createContent })])
    expect(createContent).toHaveBeenCalledTimes(1)
    hook.rerender({ ...props, layers: one([marker('a', { createContent })]) })
    expect(createContent).toHaveBeenCalledTimes(1)
    hook.rerender({ ...props, layers: one([marker('a', { createContent, contentKey: 'k2' })]) })
    expect(createContent).toHaveBeenCalledTimes(2)
  })

  it('createContent:建立時沒有前一個 key;之後內容 key 改變時帶上前一個 key(讓功能層判斷進場動畫)', () => {
    const seen: (string | undefined)[] = []
    const make = (contentKey: string) =>
      marker('a', {
        contentKey,
        createContent: (ctx) => {
          seen.push(ctx?.previousContentKey)
          return document.createElement('i')
        },
      })
    const { hook, props } = setup([make('base')])
    hook.rerender({ ...props, layers: one([make('hover')]) })
    hook.rerender({ ...props, layers: one([make('selected')]) })
    expect(seen).toEqual([undefined, 'base', 'hover'])
  })

  it('群組改變:zIndex 跟著改', () => {
    const { hook, props } = setup([marker('a', { group: 'currentLocation' })])
    hook.rerender({ ...props, layers: one([marker('a', { group: 'planStop' })]) })
    expect(visibleMarkers()[0].zIndex).toBe(GROUP_Z.planStop)
  })

  it('circle 的幾何改變:setOptions 更新,不重建', () => {
    const circle = (r: number): Drawable => ({ id: 'c', group: 'planStop', kind: 'circle', center: { lat: 0, lng: 0 }, radiusMeters: r })
    const { hook, props } = setup([circle(100)])
    const shape = visibleShapes('circle')[0]
    hook.rerender({ ...props, layers: one([circle(500)]) })
    expect(visibleShapes('circle')).toHaveLength(1)
    expect(visibleShapes('circle')[0]).toBe(shape)
    expect(shape.options.radius).toBe(500)
  })

  it('從清單消失:移除;新出現:加上', () => {
    const { hook, props } = setup([marker('a'), marker('b')])
    hook.rerender({ ...props, layers: one([marker('b'), marker('c')]) })
    expect(visibleMarkers().map((m) => m.title).sort()).toEqual(['b', 'c'])
  })

  it('clickable 改變:重建(gmpClickable 只能在建立時決定)', () => {
    const { hook, props } = setup([marker('a')])
    hook.rerender({ ...props, layers: one([marker('a', { clickable: true })]) })
    expect(visibleMarkers()).toHaveLength(1)
    expect(visibleMarkers()[0].gmpClickable).toBe(true)
  })
})

describe('useMapDrawLayer 互動', () => {
  it('可點的 marker:點擊呼叫 onClick(原本的 id,不含功能層前綴),而且是最新的那個 onClick', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { hook, props } = setup([marker('a', { clickable: true, onClick: first })])
    hook.rerender({ ...props, layers: one([marker('a', { clickable: true, onClick: second })]) })
    act(() => visibleMarkers()[0].click())
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('a')
  })

  it('不可點的 marker 不註冊點擊監聽', () => {
    setup([marker('a', { onClick: vi.fn() })])
    expect(visibleMarkers()[0].clickHandlers).toHaveLength(0)
  })
})

describe('useMapDrawLayer 地圖重建與清理', () => {
  it('mapVersion 改變(地圖被重建成新實例):舊的清掉,全部重掛到新地圖', () => {
    const { hook, props, ref } = setup([
      marker('a'),
      { id: 'c', group: 'planStop', kind: 'circle', center: { lat: 0, lng: 0 }, radiusMeters: 5 },
    ])
    const oldMarker = visibleMarkers()[0]
    const newMap = { tag: 'map2' } as unknown as google.maps.Map
    ref.current = newMap
    hook.rerender({ ...props, mapVersion: 1 })
    expect(oldMarker.map).toBeNull()
    expect(cleared).toContain(oldMarker)
    expect(visibleMarkers()).toHaveLength(1)
    expect(visibleMarkers()[0].map).toBe(newMap)
    expect(visibleShapes('circle')[0].map).toBe(newMap)
  })

  it('mapReady 變 false:全部移除', () => {
    const { hook, props } = setup([marker('a')])
    hook.rerender({ ...props, mapReady: false })
    expect(visibleMarkers()).toHaveLength(0)
  })

  it('卸載:全部移除', () => {
    const { hook } = setup([marker('a'), { id: 'p', group: 'planStop', kind: 'polyline', path: [] }])
    hook.unmount()
    expect(visibleMarkers()).toHaveLength(0)
    expect(visibleShapes()).toHaveLength(0)
  })
})
