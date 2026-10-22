// attractionGlowLayer 測試:景點區域光暈的功能層(2026-10)。
// 光暈實例是自訂 DOM 的 OverlayView(geoAttractionOverlay),這裡用假類別,只看「畫哪些、狀態怎麼套」。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GeoAttraction } from '../../../api'

class FakeGlow {
  static all: FakeGlow[] = []
  selected: boolean
  candidate: boolean
  hovered = false
  hidden = false
  focused = false
  themeCollapsed = false
  constructor(
    public attraction: GeoAttraction,
    public position: unknown,
    selected: boolean,
    candidate: boolean,
    public onClick: (a: GeoAttraction) => void,
  ) {
    this.selected = selected
    this.candidate = candidate
    FakeGlow.all.push(this)
  }
  setSelected(v: boolean) {
    this.selected = v
  }
  setCandidate(v: boolean) {
    this.candidate = v
  }
  setHovered(v: boolean) {
    this.hovered = v
  }
  setHidden(v: boolean) {
    this.hidden = v
  }
  setFocused(v: boolean) {
    this.focused = v
  }
  setThemePhotoCollapsed(v: boolean) {
    this.themeCollapsed = v
  }
  setMap() {}
}

vi.mock('../../geoAttractionOverlay', () => ({ getAttractionOverlayClass: () => FakeGlow }))
;(globalThis as { google?: unknown }).google = { maps: { LatLng: class { constructor(public lat: number, public lng: number) {} } } }

import { attractionGlowLayer, filterRevealedAttractions } from './attractionGlowLayer'

const att = (name: string, extra: Partial<GeoAttraction> = {}): GeoAttraction =>
  ({ id: name, name, lat: 1, lng: 2, ...extra }) as GeoAttraction

beforeEach(() => {
  FakeGlow.all = []
})

describe('filterRevealedAttractions', () => {
  it('沒有等級的、主題點一律顯示;有等級的要在揭露名單內', () => {
    const list = [att('a'), att('b', { level: 3 }), att('c', { level: 3 }), att('t', { level: 4, isTheme: true })]
    expect(filterRevealedAttractions(list, new Set(['b'])).map((d) => d.name)).toEqual(['a', 'b', 't'])
    expect(filterRevealedAttractions(list, null).map((d) => d.name)).toEqual(['a', 't'])
  })
})

describe('attractionGlowLayer', () => {
  const base = { onSelect: () => {}, onCreate: () => {}, onDispose: () => {} }

  it('每個景點一個 overlay,id 用 geoItemKey', () => {
    const layer = attractionGlowLayer({ ...base, attractions: [att('a'), att('b')] })
    expect(layer.id).toBe('attractionGlow')
    expect(layer.drawables.map((d) => d.id)).toEqual(['attraction:a:1:2', 'attraction:b:1:2'])
    expect(layer.drawables.every((d) => d.kind === 'overlay' && d.group === 'attractionGlow')).toBe(true)
  })

  it('同一個 key 重複的景點只畫一個', () => {
    const layer = attractionGlowLayer({ ...base, attractions: [att('a'), att('a')] })
    expect(layer.drawables).toHaveLength(1)
  })

  it('建立時帶入選取、候選、hover 狀態與點擊回呼', () => {
    const onSelect = vi.fn()
    const layer = attractionGlowLayer({
      ...base,
      onSelect,
      attractions: [att('a')],
      selectedKey: 'attraction:a:1:2',
      candidateKeys: new Set(['attraction:a:1:2']),
      hoveredCuratedId: 'a',
    })
    const d = layer.drawables[0] as Extract<(typeof layer.drawables)[number], { kind: 'overlay' }>
    const g = d.create() as FakeGlow
    expect(g.selected).toBe(true)
    expect(g.candidate).toBe(true)
    expect(g.hovered).toBe(true)
    g.onClick(att('a'))
    expect(onSelect).toHaveBeenCalled()
  })

  it('hoverKey 也算選取態', () => {
    const layer = attractionGlowLayer({ ...base, attractions: [att('a')], hoverKey: 'attraction:a:1:2' })
    const d = layer.drawables[0] as { create: () => FakeGlow }
    expect(d.create().selected).toBe(true)
  })

  it('狀態不同 stateKey 不同;update 套用新狀態', () => {
    const a = attractionGlowLayer({ ...base, attractions: [att('a')] }).drawables[0]
    const b = attractionGlowLayer({ ...base, attractions: [att('a')], selectedKey: 'attraction:a:1:2' }).drawables[0]
    expect((a as { stateKey: string }).stateKey).not.toBe((b as { stateKey: string }).stateKey)
    const g = (a as { create: () => FakeGlow }).create()
    ;(b as { update: (i: FakeGlow) => void }).update(g)
    expect(g.selected).toBe(true)
  })

  it('onCreate / onDispose 帶景點的 key 與實例', () => {
    const onCreate = vi.fn()
    const onDispose = vi.fn()
    const layer = attractionGlowLayer({ ...base, onCreate, onDispose, attractions: [att('a')] })
    const d = layer.drawables[0] as { onCreate: (i: FakeGlow) => void; onDispose: (i: FakeGlow) => void; create: () => FakeGlow }
    const g = d.create()
    d.onCreate(g)
    d.onDispose(g)
    expect(onCreate).toHaveBeenCalledWith('attraction:a:1:2', expect.objectContaining({ name: 'a' }), g)
    expect(onDispose).toHaveBeenCalledWith('attraction:a:1:2', g)
  })

  it('隱藏、聚焦、主題照片收起:用 id 比對,建立時套用,狀態不同 stateKey 不同', () => {
    const list = [att('t', { isTheme: true, level: 4 }), att('u', { isTheme: true, level: 4 }), att('c', { level: 3 })]
    const layer = attractionGlowLayer({
      ...base,
      attractions: list,
      hiddenAttractionId: 't',
      focusedAttractionId: 'c',
      themePhotoOnlyWhenFocused: true,
      focusedThemeId: 'u',
    })
    const [t, u, c] = layer.drawables.map((d) => (d as { create: () => FakeGlow }).create())
    expect([t.hidden, u.hidden, c.hidden]).toEqual([true, false, false])
    expect([t.focused, u.focused, c.focused]).toEqual([false, false, true])
    // 只有主題點會收;聚焦的主題點(u)不收;精選點(c)不受影響
    expect([t.themeCollapsed, u.themeCollapsed, c.themeCollapsed]).toEqual([true, false, false])
    const plain = attractionGlowLayer({ ...base, attractions: list })
    expect((plain.drawables[0] as { stateKey: string }).stateKey).not.toBe((layer.drawables[0] as { stateKey: string }).stateKey)
  })

  it('三組狀態都沒傳:全部維持關閉(既有呼叫端行為不變)', () => {
    const layer = attractionGlowLayer({ ...base, attractions: [att('t', { isTheme: true, level: 4 })] })
    const g = (layer.drawables[0] as { create: () => FakeGlow }).create()
    expect([g.hidden, g.focused, g.themeCollapsed]).toEqual([false, false, false])
  })
})
