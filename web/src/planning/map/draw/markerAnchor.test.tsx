// marker 錨點(anchor)測試(2026-10-24):圓形 marker 的圓心要對準座標,否則與連線端點對不齊。
//   - 簽章:anchor 進 data,改變時走 update(不重建)。
//   - 宿主:anchor 'center' 對 content 套 translateY(50%);'bottom'/沒傳清掉;內容換新時重新套;只改 anchor 也會套。
//   - 功能層:所有圓形 marker(站點圓點與主題子景點小點、藍點、搜尋結果、行程 entry)都宣告 anchor: 'center'。
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMapDrawLayer } from './index'
import { diffDrawables, signatureOf } from './diff'
import type { Drawable, FeatureLayer, MarkerDrawable } from './types'
import { planStopLayer } from './layers/planStopLayer'
import { currentLocationLayer } from './layers/currentLocationLayer'
import { searchResultLayer } from './layers/searchResultLayer'
import { tripEntryLayer } from './layers/tripEntryLayer'

class FakeMarker {
  static all: FakeMarker[] = []
  map: unknown
  position: unknown
  title?: string
  zIndex?: number
  content: unknown
  constructor(opts: Record<string, unknown>) {
    Object.assign(this, opts)
    FakeMarker.all.push(this)
  }
  addListener() {
    return { remove: () => {} }
  }
}
;(globalThis as { google?: unknown }).google = {
  maps: { marker: { AdvancedMarkerElement: FakeMarker }, event: { clearInstanceListeners: () => {} } },
}

const marker = (extra: Partial<MarkerDrawable> = {}): MarkerDrawable => ({
  id: 'm',
  group: 'planStop',
  kind: 'marker',
  position: { lat: 1, lng: 2 },
  contentKey: 'k1',
  createContent: () => document.createElement('div'),
  ...extra,
})
const one = (d: Drawable): FeatureLayer[] => [{ id: 't', drawables: [d] }]
const transformOf = (m: FakeMarker) => (m.content as HTMLElement).style.transform

describe('marker anchor:簽章', () => {
  it('anchor 進 data:改變時 update,不重建;沒傳等同 bottom', () => {
    expect(signatureOf(marker()).data).toBe(signatureOf(marker({ anchor: 'bottom' })).data)
    expect(signatureOf(marker()).data).not.toBe(signatureOf(marker({ anchor: 'center' })).data)
    const prev = new Map([['t:m', { ...signatureOf(marker()), kind: 'marker' as const }]])
    const r = diffDrawables(prev, [{ ...marker({ anchor: 'center' }), id: 't:m' }])
    expect(r.update.map((d) => d.id)).toEqual(['t:m'])
    expect(r.add).toEqual([])
    expect(r.remove).toEqual([])
  })
})

describe('marker anchor:宿主套用位移', () => {
  beforeEach(() => {
    FakeMarker.all = []
  })
  type Props = Parameters<typeof useMapDrawLayer>[0]
  function setup(d: Drawable) {
    const ref = { current: { tag: 'map' } as unknown as google.maps.Map | null }
    const props: Props = { mapRef: ref, mapReady: true, layers: one(d) }
    const hook = renderHook((p: Props) => useMapDrawLayer(p), { initialProps: props })
    return { hook, props }
  }

  it("anchor 'center':content 套 translateY(50%);沒傳:不位移", () => {
    setup(marker({ anchor: 'center' }))
    expect(transformOf(FakeMarker.all[0])).toBe('translateY(50%)')
    FakeMarker.all = []
    setup(marker())
    expect(transformOf(FakeMarker.all[0])).toBe('')
  })

  it('內容換新(contentKey 改變)時新的 content 也套位移;只改 anchor(內容不變)也會對既有 content 重新套用', () => {
    const { hook, props } = setup(marker({ anchor: 'center' }))
    const m = FakeMarker.all[0]
    const first = m.content
    hook.rerender({ ...props, layers: one(marker({ anchor: 'center', contentKey: 'k2' })) })
    expect(FakeMarker.all).toHaveLength(1)
    expect(m.content).not.toBe(first)
    expect(transformOf(m)).toBe('translateY(50%)')
    hook.rerender({ ...props, layers: one(marker({ anchor: 'bottom', contentKey: 'k2' })) })
    expect(FakeMarker.all).toHaveLength(1)
    expect(transformOf(m)).toBe('')
    hook.rerender({ ...props, layers: one(marker({ anchor: 'center', contentKey: 'k2' })) })
    expect(transformOf(m)).toBe('translateY(50%)')
  })

  it('SVG 內容(站點圓點)同樣套位移', () => {
    setup(marker({ anchor: 'center', createContent: () => document.createElementNS('http://www.w3.org/2000/svg', 'svg') }))
    expect(transformOf(FakeMarker.all[0])).toBe('translateY(50%)')
  })
})

describe('marker anchor:功能層都宣告 center(全部是圓形 marker)', () => {
  const markersOf = (l: FeatureLayer) => l.drawables.filter((d): d is MarkerDrawable => d.kind === 'marker')

  it('站點圓點(含旅館/美食點)與主題子景點小點', () => {
    const points = [
      { id: 't', lat: 1, lng: 2, name: 'T', kind: 'theme', children: [{ id: 'c1', lat: 3, lng: 4, name: 'C1' }] },
      { id: 'h', lat: 5, lng: 6, name: 'H', kind: 'attraction', glyph: '<g/>', size: 20 },
    ] as never
    const ms = markersOf(planStopLayer({ points, selectedId: 't', accentColor: '#8B3A2F' }))
    expect(ms.length).toBeGreaterThanOrEqual(3)
    expect(ms.every((m) => m.anchor === 'center')).toBe(true)
  })

  it('目前位置藍點', () => {
    expect(markersOf(currentLocationLayer({ position: { lat: 1, lng: 2 } }))[0].anchor).toBe('center')
  })

  it('搜尋結果三種(旅館、地點、定位)', () => {
    const results = [
      { kind: 'hotel', name: 'h', lat: 1, lng: 2 },
      { kind: 'place', name: 'p', lat: 1, lng: 2, category: 'food' },
      { kind: 'geocode', name: 'g', lat: 1, lng: 2 },
    ] as never
    const ms = markersOf(searchResultLayer({ results }))
    expect(ms).toHaveLength(3)
    expect(ms.every((m) => m.anchor === 'center')).toBe(true)
  })

  it('行程 entry(圓底旗子)', () => {
    const entries = [{ id: 1, name: 'e', lat: 1, lng: 2 }] as never
    expect(markersOf(tripEntryLayer({ entries, accentColor: '#8B3A2F' })).every((m) => m.anchor === 'center')).toBe(true)
  })
})
