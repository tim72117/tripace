// planStopLayer 純函式測試:行程站點圓點功能層(2026-10 從獨立的站點圖層 hook 遷移進統一繪製層 map/draw/)。
//
// 行為對照遷移前的舊圖層(已移除):三態規則、疊放順序、點擊回報、主題點展開(範圍圓圈加
// 子景點小點)、進場動畫(從 base 變成強調態才播)。planStopMarkerContent 用假的,只記錄它收到的參數。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CircleDrawable, MarkerDrawable } from '../types'
import type { MapMarkerPoint } from '../../marker/planStops'

const content = vi.hoisted(() => ({ calls: [] as unknown[][], labelCalls: [] as unknown[][] }))
vi.mock('../../mapMarkers', () => ({
  planStopMarkerContent: (...args: unknown[]) => {
    content.calls.push(args)
    return document.createElement('i')
  },
  // withMarkerLabel 用假的:記錄收到的名稱,原樣回傳內容(真實行為見 mapMarkers.label.test.ts)。
  withMarkerLabel: (el: Element, name: string | undefined) => {
    content.labelCalls.push([name])
    return el
  },
}))

import { planStopLayer } from './planStopLayer'

const ACCENT = '#8B3A2F'
const pt = (id: string, extra: Partial<MapMarkerPoint> = {}): MapMarkerPoint => ({
  id,
  lat: 1,
  lng: 2,
  name: id,
  kind: 'attraction',
  ...extra,
})
const theme = (id: string): MapMarkerPoint =>
  pt(id, { kind: 'theme', children: [{ id: `${id}-c1`, lat: 3, lng: 4, name: 'C1' }, { id: `${id}-c2`, lat: 5, lng: 6 }] })

type Input = Parameters<typeof planStopLayer>[0]
const layer = (over: Partial<Input> = {}) => planStopLayer({ points: [pt('a')], accentColor: ACCENT, ...over })
const markers = (l: ReturnType<typeof layer>) => l.drawables.filter((d): d is MarkerDrawable => d.kind === 'marker')
const stop = (l: ReturnType<typeof layer>, id: string) => markers(l).find((m) => m.id === `stop:${id}`)!

beforeEach(() => {
  content.calls = []
  content.labelCalls = []
})

describe('planStopLayer 基本', () => {
  it('功能層 id 固定,沒有點就沒有東西可畫', () => {
    expect(layer({ points: [] }).id).toBe('planStop')
    expect(layer({ points: [] }).drawables).toEqual([])
  })

  it('每個站點一個 marker:id、座標、標題、可點;themeChild 類型的點不畫', () => {
    const l = layer({ points: [pt('a'), pt('b', { lat: 9, lng: 8, name: 'B' }), pt('x', { kind: 'themeChild' })] })
    expect(markers(l).map((m) => m.id)).toEqual(['stop:a', 'stop:b'])
    const b = stop(l, 'b')
    expect(b.position).toEqual({ lat: 9, lng: 8 })
    expect(b.title).toBe('B')
    expect(b.clickable).toBe(true)
  })
})

describe('planStopLayer 三態與疊放群組', () => {
  it('一般、hover、選中對應三個群組(疊放順序在 GROUP_Z)', () => {
    const l = layer({ points: [pt('a'), pt('b'), pt('c')], selectedId: 'a', hoverId: 'b' })
    expect(stop(l, 'a').group).toBe('planStopSelected')
    expect(stop(l, 'b').group).toBe('planStopHover')
    expect(stop(l, 'c').group).toBe('planStop')
  })

  it('同一個點又選中又 hover:選中優先', () => {
    expect(stop(layer({ selectedId: 'a', hoverId: 'a' }), 'a').group).toBe('planStopSelected')
  })

  it('轉乘配對的兩端都算 hover;其中一端已選中則維持選中', () => {
    const l = layer({ points: [pt('a'), pt('b'), pt('c')], hoverTransitPair: { fromId: 'a', toId: 'b' }, selectedId: 'b' })
    expect(stop(l, 'a').group).toBe('planStopHover')
    expect(stop(l, 'b').group).toBe('planStopSelected')
    expect(stop(l, 'c').group).toBe('planStop')
  })

  it('supportsHover 為 false(手機沒有滑鼠 hover):hoverId 與轉乘配對都忽略,選中不受影響', () => {
    const l = layer({
      points: [pt('a'), pt('b')],
      supportsHover: false,
      hoverId: 'a',
      hoverTransitPair: { fromId: 'a', toId: 'b' },
      selectedId: 'b',
    })
    expect(stop(l, 'a').group).toBe('planStop')
    expect(stop(l, 'b').group).toBe('planStopSelected')
  })
})

describe('planStopLayer 內容與進場動畫', () => {
  it('contentKey 隨狀態、glyph、size、強調色改變;輸入相同就相同(內容沒變不該重做)', () => {
    const key = (over: Partial<Input>, p: Partial<MapMarkerPoint> = {}) => stop(layer({ points: [pt('a', p)], ...over }), 'a').contentKey
    const base = key({})
    expect(key({})).toBe(base)
    expect(key({ selectedId: 'a' })).not.toBe(base)
    expect(key({ hoverId: 'a' })).not.toBe(key({ selectedId: 'a' }))
    expect(key({}, { glyph: '<g/>' })).not.toBe(base)
    expect(key({}, { size: 20 })).not.toBe(base)
    expect(key({ accentColor: '#000000' })).not.toBe(base)
  })

  it('圓點內容經 withMarkerLabel 帶上站點名稱;名稱改變 contentKey 跟著變(標籤才會更新)', () => {
    const l = layer({ points: [pt('a', { name: '赤崁樓' })] })
    stop(l, 'a').createContent()
    expect(content.labelCalls).toEqual([['赤崁樓']])
    const key = (name: string) => stop(layer({ points: [pt('a', { name })] }), 'a').contentKey
    expect(key('赤崁樓')).not.toBe(key('安平古堡'))
  })

  it('第一次建立:用當下狀態畫,不播進場動畫(entering 為 false),並帶上 glyph 與 size', () => {
    const l = layer({ points: [pt('a', { glyph: '<g/>', size: 18 })], selectedId: 'a' })
    stop(l, 'a').createContent()
    expect(content.calls[0]).toEqual(['selected', ACCENT, false, '<g/>', 18])
  })

  it('從 base 變成 hover 或選中:播進場動畫;強調態之間互換、同狀態只換顏色:不播', () => {
    const entering = (prev: string, next: Partial<Input>) => {
      content.calls = []
      const d = stop(layer(next), 'a')
      d.createContent({ previousContentKey: prev })
      return content.calls[0][2]
    }
    const keyOf = (over: Partial<Input>) => stop(layer(over), 'a').contentKey
    const base = keyOf({})
    const hover = keyOf({ hoverId: 'a' })
    const selected = keyOf({ selectedId: 'a' })
    expect(entering(base, { hoverId: 'a' })).toBe(true)
    expect(entering(base, { selectedId: 'a' })).toBe(true)
    expect(entering(hover, { selectedId: 'a' })).toBe(false)
    expect(entering(selected, { hoverId: 'a' })).toBe(false)
    expect(entering(selected, { selectedId: 'a', accentColor: '#111111' })).toBe(false)
    expect(entering(base, { accentColor: '#111111' })).toBe(false)
  })
})

describe('planStopLayer 點擊', () => {
  it('點圓點:先 onPointClick(id, 原本的點),再 onSelectedChange(id);id 是站點原本的 id', () => {
    const order: string[] = []
    const p = pt('a')
    const l = layer({
      points: [p],
      onPointClick: (id, point) => order.push(`click:${id}:${point === p}`),
      onSelectedChange: (id) => order.push(`select:${id}`),
    })
    stop(l, 'a').onClick!('a')
    expect(order).toEqual(['click:a:true', 'select:a'])
  })

  it('沒有傳回呼也不會出錯', () => {
    expect(() => stop(layer(), 'a').onClick!('a')).not.toThrow()
  })
})

describe('planStopLayer 主題點展開', () => {
  const circleOf = (l: ReturnType<typeof layer>) => l.drawables.find((d): d is CircleDrawable => d.kind === 'circle')
  const dots = (l: ReturnType<typeof layer>) => markers(l).filter((m) => m.id.startsWith('child:'))

  it('選中主題點:畫 200 公尺範圍圓圈(強調色、不可點)加每個子景點一顆小點', () => {
    const l = layer({ points: [theme('t')], selectedId: 't' })
    const c = circleOf(l)!
    expect(c.center).toEqual({ lat: 1, lng: 2 })
    expect(c.radiusMeters).toBe(200)
    expect(c.options).toMatchObject({ strokeColor: ACCENT, fillColor: ACCENT, strokeOpacity: 0.5, strokeWeight: 1.5, fillOpacity: 0.12 })
    expect(dots(l).map((d) => d.id)).toEqual(['child:t-c1', 'child:t-c2'])
    expect(dots(l)[0].position).toEqual({ lat: 3, lng: 4 })
    expect(dots(l)[0].title).toBe('C1')
    expect(dots(l).every((d) => !d.clickable && d.group === 'planStopChild')).toBe(true)
  })

  it('子景點小點的內容:10px 強調色圓點(白邊與陰影),不經過 planStopMarkerContent', () => {
    const l = layer({ points: [theme('t')], selectedId: 't' })
    const el = dots(l)[0].createContent() as HTMLElement
    expect(el.style.width).toBe('10px')
    expect(el.style.height).toBe('10px')
    expect(el.style.borderRadius).toBe('50%')
    expect(el.style.background).not.toBe('')
    expect(content.calls).toHaveLength(0)
  })

  it('選中的是子景點 id:仍展開它所屬的主題點', () => {
    expect(circleOf(layer({ points: [theme('t')], selectedId: 't-c1' }))).toBeDefined()
  })

  it('沒選中、選中一般站點、或主題點沒有 children:不展開', () => {
    expect(circleOf(layer({ points: [theme('t')] }))).toBeUndefined()
    expect(circleOf(layer({ points: [pt('a'), theme('t')], selectedId: 'a' }))).toBeUndefined()
    expect(circleOf(layer({ points: [pt('t', { kind: 'theme', children: [] })], selectedId: 't' }))).toBeUndefined()
  })

  it('強調色改變:圓圈與小點跟著變', () => {
    const l1 = layer({ points: [theme('t')], selectedId: 't' })
    const l2 = layer({ points: [theme('t')], selectedId: 't', accentColor: '#222222' })
    expect(circleOf(l2)!.options).toMatchObject({ strokeColor: '#222222' })
    expect(dots(l1)[0].contentKey).not.toBe(dots(l2)[0].contentKey)
  })
})
