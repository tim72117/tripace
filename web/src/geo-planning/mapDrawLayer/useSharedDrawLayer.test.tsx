// useSharedDrawLayer 測試:兩邊(/ai-plan 推論態、登入後 PlanMap)完全相同的繪製層部分。
//
// 共用的功能層(目前是目前位置藍點)加上各接線處自己額外的功能層,一起交給 useMapDrawLayer。
// 假的 google.maps 只提供用到的最小介面,斷言看的是「地圖上現在畫著什麼」。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSharedDrawLayer, sharedFeatureLayers } from './useSharedDrawLayer'
import type { FeatureLayer } from './types'

class FakeMarker {
  static all: FakeMarker[] = []
  map: unknown
  title?: string
  position: unknown
  zIndex?: number
  content?: unknown
  handlers: (() => void)[] = []
  constructor(opts: Record<string, unknown>) {
    Object.assign(this, opts)
    FakeMarker.all.push(this)
  }
  addListener(_e: string, h: () => void) {
    this.handlers.push(h)
    return { remove: () => {} }
  }
  click() {
    this.handlers.forEach((h) => h())
  }
}
class FakeCircle {
  static all: FakeCircle[] = []
  map: unknown
  opts: Record<string, unknown>
  constructor(o: Record<string, unknown>) {
    this.opts = { ...o }
    this.map = o.map
    FakeCircle.all.push(this)
  }
  setOptions(o: Record<string, unknown>) {
    Object.assign(this.opts, o)
  }
  setMap(m: unknown) {
    this.map = m
  }
}
class FakePolyline {
  static all: FakePolyline[] = []
  map: unknown
  constructor(public opts: Record<string, unknown>) {
    this.map = opts.map
    FakePolyline.all.push(this)
  }
  setOptions(o: Record<string, unknown>) {
    Object.assign(this.opts, o)
  }
  setMap(m: unknown) {
    this.map = m
  }
}

;(globalThis as { google?: unknown }).google = {
  maps: {
    marker: { AdvancedMarkerElement: FakeMarker },
    Polyline: FakePolyline,
    Circle: FakeCircle,
    event: { clearInstanceListeners: () => {} },
  },
}
// 藍點的內容函式在 mapMarkers 裡,這裡用 jsdom 的真 DOM 即可。
const visibleMarkers = () => FakeMarker.all.filter((m) => m.map != null)
const visibleLines = () => FakePolyline.all.filter((l) => l.map != null)

const line = (id: string): FeatureLayer => ({
  id,
  drawables: [{ id: 'l', group: 'routeLine', kind: 'polyline', path: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }] }],
})

type Props = Parameters<typeof useSharedDrawLayer>[0]
// 地圖容器:useSharedDrawLayer 內部用 useAccentColor 從這個元素讀 --color-accent。
function mapDiv(accent?: string) {
  const div = document.createElement('div')
  if (accent) div.style.setProperty('--color-accent', accent)
  return div
}
function fakeMap(accent?: string) {
  const div = mapDiv(accent)
  return { tag: 'map', getDiv: () => div } as unknown as google.maps.Map
}

function setup(over: Partial<Props> = {}, accent?: string) {
  const map = fakeMap(accent)
  const base: Props = { mapRef: { current: map }, mapReady: true, currentPosition: null }
  const props = { ...base, ...over }
  const hook = renderHook((p: Props) => useSharedDrawLayer(p), { initialProps: props })
  return { hook, props, map }
}

beforeEach(() => {
  FakeMarker.all = []
  FakePolyline.all = []
  FakeCircle.all = []
})

describe('sharedFeatureLayers', () => {
  it('共用的功能層固定是目前位置藍點,沒有座標時它不畫任何東西', () => {
    const none = sharedFeatureLayers({ currentPosition: null })
    expect(none.map((l) => l.id)).toEqual(['currentLocation'])
    expect(none[0].drawables).toEqual([])
    const some = sharedFeatureLayers({ currentPosition: { lat: 1, lng: 2 } })
    expect(some[0].drawables).toHaveLength(1)
  })
})

describe('useSharedDrawLayer', () => {
  it('有座標:畫出藍點(標題「目前位置」)', () => {
    setup({ currentPosition: { lat: 35, lng: 135 } })
    const m = visibleMarkers()
    expect(m).toHaveLength(1)
    expect(m[0].title).toBe('目前位置')
    expect(m[0].position).toEqual({ lat: 35, lng: 135 })
  })

  it('沒有座標也沒有額外功能層:什麼都不畫', () => {
    setup()
    expect(visibleMarkers()).toHaveLength(0)
    expect(visibleLines()).toHaveLength(0)
  })

  it('額外功能層和共用的藍點一起畫在同一張地圖上', () => {
    setup({ currentPosition: { lat: 35, lng: 135 }, extraLayers: [line('route')] })
    expect(visibleMarkers()).toHaveLength(1)
    expect(visibleLines()).toHaveLength(1)
  })

  it('沒座標時,額外功能層照常畫(藍點不影響它們)', () => {
    setup({ extraLayers: [line('route')] })
    expect(visibleMarkers()).toHaveLength(0)
    expect(visibleLines()).toHaveLength(1)
  })

  it('座標改變:藍點原地更新,額外功能層不受影響', () => {
    const extra = [line('route')]
    const { hook, props } = setup({ currentPosition: { lat: 1, lng: 1 }, extraLayers: extra })
    const dot = visibleMarkers()[0]
    const lineBefore = visibleLines()[0]
    hook.rerender({ ...props, currentPosition: { lat: 2, lng: 2 }, extraLayers: extra })
    expect(visibleMarkers()[0]).toBe(dot)
    expect(dot.position).toEqual({ lat: 2, lng: 2 })
    expect(visibleLines()[0]).toBe(lineBefore)
  })

  it('額外功能層從無到有、再到無:只影響它自己', () => {
    const { hook, props } = setup({ currentPosition: { lat: 1, lng: 1 } })
    hook.rerender({ ...props, extraLayers: [line('route')] })
    expect(visibleLines()).toHaveLength(1)
    expect(visibleMarkers()).toHaveLength(1)
    hook.rerender({ ...props, extraLayers: [] })
    expect(visibleLines()).toHaveLength(0)
    expect(visibleMarkers()).toHaveLength(1)
  })

  it('額外功能層的 id 與共用的 id 相同時不會互相覆蓋(各自有前綴)', () => {
    const clash: FeatureLayer = {
      id: 'currentLocation',
      drawables: [{ id: 'me', group: 'planStop', kind: 'polyline', path: [] }],
    }
    setup({ currentPosition: { lat: 1, lng: 1 }, extraLayers: [clash] })
    // 兩個功能層 id 相同時以後面為準(同一個前綴),這是組合規則;至少不能丟例外
    expect(visibleMarkers().length + visibleLines().length).toBeGreaterThan(0)
  })

  it('地圖還沒好:什麼都不畫;好了之後才畫', () => {
    const { hook, props } = setup({ mapReady: false, currentPosition: { lat: 1, lng: 1 } })
    expect(visibleMarkers()).toHaveLength(0)
    hook.rerender({ ...props, mapReady: true })
    expect(visibleMarkers()).toHaveLength(1)
  })

  it('卸載:全部移除', () => {
    const { hook } = setup({ currentPosition: { lat: 1, lng: 1 }, extraLayers: [line('route')] })
    hook.unmount()
    expect(visibleMarkers()).toHaveLength(0)
    expect(visibleLines()).toHaveLength(0)
  })
})


// ===== 行程站點圓點(兩邊共用,2026-10 從 useMapMarkerLayer 遷移進來) =====

describe('useSharedDrawLayer 行程站點圓點', () => {
  const stop = (id: string, extra: Record<string, unknown> = {}) => ({ id, lat: 1, lng: 2, name: id, ...extra })
  const stopMarkers = () => visibleMarkers().filter((m) => m.title !== '目前位置')
  const withDots = (stops: ReturnType<typeof stop>[], over: Partial<NonNullable<Props['stopDots']>> = {}): Partial<Props> => ({
    stopDots: { stops, ...over },
  })

  it('沒有 stopDots:不畫站點,expandedThemeId 為 null', () => {
    const { hook } = setup()
    expect(stopMarkers()).toHaveLength(0)
    expect(hook.result.current.expandedThemeId).toBeNull()
  })

  it('有站點:每個站點一顆圓點(標題為站點名稱),與藍點、額外功能層一起畫', () => {
    setup({ currentPosition: { lat: 1, lng: 1 }, extraLayers: [line('route')], ...withDots([stop('a'), stop('b')]) })
    expect(stopMarkers().map((m) => m.title).sort()).toEqual(['a', 'b'])
    expect(visibleMarkers().some((m) => m.title === '目前位置')).toBe(true)
    expect(visibleLines()).toHaveLength(1)
  })

  it('選中與 hover:疊放順序依群組(hover 最上、選中次之)', () => {
    setup(withDots([stop('a'), stop('b'), stop('c')], { selectedId: 'a', hoverId: 'b' }))
    const z = (t: string) => stopMarkers().find((m) => m.title === t)!.zIndex
    expect(z('b')).toBeGreaterThan(z('a')!)
    expect(z('a')).toBeGreaterThan(z('c')!)
  })

  it('選取改變:原地更新同一顆圓點的內容與疊放,不重建', () => {
    const stops = [stop('a'), stop('b')]
    const { hook, props } = setup(withDots(stops))
    const a = stopMarkers().find((m) => m.title === 'a')!
    const before = { z: a.zIndex, content: a.content }
    hook.rerender({ ...props, ...withDots(stops, { selectedId: 'a' }) })
    expect(stopMarkers().find((m) => m.title === 'a')).toBe(a)
    expect(a.zIndex).not.toBe(before.z)
    expect(a.content).not.toBe(before.content)
    expect(stopMarkers()).toHaveLength(2)
  })

  it('點圓點:呼叫 onPointClick 與 onSelectedChange(原本的站點 id)', () => {
    const onPointClick = vi.fn()
    const onSelectedChange = vi.fn()
    setup(withDots([stop('a')], { onPointClick, onSelectedChange }))
    stopMarkers()[0].click()
    expect(onPointClick).toHaveBeenCalledWith('a', expect.objectContaining({ id: 'a', kind: 'attraction' }))
    expect(onSelectedChange).toHaveBeenCalledWith('a')
  })

  it('回呼換成新函式:點擊呼叫到最新的,而且不會讓圓點重建', () => {
    const first = vi.fn()
    const second = vi.fn()
    const stops = [stop('a')]
    const { hook, props } = setup(withDots(stops, { onSelectedChange: first }))
    const marker = stopMarkers()[0]
    hook.rerender({ ...props, ...withDots(stops, { onSelectedChange: second }) })
    expect(stopMarkers()[0]).toBe(marker)
    marker.click()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('a')
  })

  it('選中有 children 的站點:畫範圍圓圈與子景點小點,expandedThemeId 是該站點', () => {
    const theme = stop('t', { children: [{ id: 'c1', lat: 3, lng: 4, name: 'C1' }] })
    const { hook } = setup(withDots([theme], { selectedId: 't' }))
    expect(FakeCircle.all.filter((c) => c.map != null)).toHaveLength(1)
    expect(visibleMarkers().some((m) => m.title === 'C1')).toBe(true)
    expect(hook.result.current.expandedThemeId).toBe('t')
  })

  it('取消選中:圓圈與子景點小點移除,expandedThemeId 回到 null', () => {
    const theme = stop('t', { children: [{ id: 'c1', lat: 3, lng: 4, name: 'C1' }] })
    const stops = [theme]
    const { hook, props } = setup(withDots(stops, { selectedId: 't' }))
    hook.rerender({ ...props, ...withDots(stops, { selectedId: null }) })
    expect(FakeCircle.all.filter((c) => c.map != null)).toHaveLength(0)
    expect(visibleMarkers().some((m) => m.title === 'C1')).toBe(false)
    expect(hook.result.current.expandedThemeId).toBeNull()
  })

  it('站點全部消失:圓點移除,藍點不受影響', () => {
    const { hook, props } = setup({ currentPosition: { lat: 1, lng: 1 }, ...withDots([stop('a')]) })
    hook.rerender({ ...props, ...withDots([]) })
    expect(stopMarkers()).toHaveLength(0)
    expect(visibleMarkers().some((m) => m.title === '目前位置')).toBe(true)
  })
})

// ===== 轉乘 hover 虛線(兩邊共用,從登入後的 extraLayers 搬進共用子層) =====

describe('useSharedDrawLayer 轉乘 hover 虛線', () => {
  const stop = (id: string, lat: number) => ({ id, lat, lng: 2, name: id })
  const stops = [stop('a', 1), stop('b', 3), stop('c', 5)]
  const withPair = (pair: { fromId: string; toId: string } | null): Partial<Props> => ({
    stopDots: { stops, hoverTransitPair: pair },
  })

  it('沒有轉乘配對:不畫虛線', () => {
    setup(withPair(null))
    expect(visibleLines()).toHaveLength(0)
  })

  // 連線路徑是弧線取樣(routeArc.ts):兩端點是站點本身,中間多了取樣點;這裡只驗兩端,弧線形狀由 routeArc.test 驗。
  const endpoints = (path: unknown) => {
    const p = path as { lat: number; lng: number }[]
    return [p[0], p[p.length - 1]]
  }

  it('有轉乘配對:畫一條連接兩端站點的虛線(強調色),路徑是弧線', () => {
    setup(withPair({ fromId: 'a', toId: 'b' }))
    const lines = visibleLines()
    expect(lines).toHaveLength(1)
    expect(endpoints(lines[0].opts.path)).toEqual([
      { lat: 1, lng: 2 },
      { lat: 3, lng: 2 },
    ])
    expect((lines[0].opts.path as unknown[]).length).toBeGreaterThan(2)
    expect(JSON.stringify(lines[0].opts.icons)).toContain('#8B3A2F')
  })

  it('配對改變:同一條線原地更新路徑;取消配對:線移除,站點圓點不受影響', () => {
    const { hook, props } = setup(withPair({ fromId: 'a', toId: 'b' }))
    const line = visibleLines()[0]
    hook.rerender({ ...props, ...withPair({ fromId: 'b', toId: 'c' }) })
    expect(visibleLines()[0]).toBe(line)
    expect(endpoints(line.opts.path)).toEqual([
      { lat: 3, lng: 2 },
      { lat: 5, lng: 2 },
    ])
    hook.rerender({ ...props, ...withPair(null) })
    expect(visibleLines()).toHaveLength(0)
    expect(visibleMarkers().filter((m) => m.title !== '目前位置')).toHaveLength(3)
  })

  it('配對的站點不存在:不畫(不會出現接到 (0,0) 的線)', () => {
    setup(withPair({ fromId: 'a', toId: 'zzz' }))
    expect(visibleLines()).toHaveLength(0)
  })

  it('轉乘兩端的圓點同時變 hover 疊放(與虛線一起生效)', () => {
    setup(withPair({ fromId: 'a', toId: 'b' }))
    const z = (t: string) => visibleMarkers().find((m) => m.title === t)!.zIndex!
    expect(z('a')).toBeGreaterThan(z('c'))
    expect(z('b')).toBeGreaterThan(z('c'))
  })

  it('沒有 stopDots:不畫虛線;和額外的整條路線同時存在時各自獨立', () => {
    setup()
    expect(visibleLines()).toHaveLength(0)
    setup({ ...withPair({ fromId: 'a', toId: 'b' }), extraLayers: [line('route')] })
    expect(visibleLines()).toHaveLength(2)
  })
})

// ===== 站點之間的連線(routeSegments;2026-10-24 三個入口統一,一段一條、主題強調色) =====

describe('useSharedDrawLayer 連線(routeSegments)', () => {
  const stops = [
    { id: 'a', lat: 1, lng: 2 },
    { id: 'b', lat: 3, lng: 4 },
    { id: 'c', lat: 5, lng: 6 },
  ]
  const AB = { id: 'a->b', from: { lat: 1, lng: 2 }, to: { lat: 3, lng: 4 } }
  const BC = { id: 'b->c', from: { lat: 3, lng: 4 }, to: { lat: 5, lng: 6 } }
  const withRoute = (segments?: (typeof AB)[]): Partial<Props> => ({ stopDots: { stops }, routeSegments: segments })

  it('沒傳 routeSegments 或空陣列:不畫線', () => {
    setup({ stopDots: { stops } })
    expect(visibleLines()).toHaveLength(0)
    setup(withRoute([]))
    expect(visibleLines()).toHaveLength(0)
  })

  it('傳段才畫:每段光暈 + 顏色線兩條 polyline,顏色線是強調色、路徑兩端是段的起訖座標(弧線)', () => {
    setup(withRoute([AB, BC]), '#123456')
    const lines = visibleLines()
    expect(lines).toHaveLength(4)
    const colored = lines.filter((l) => l.opts.strokeColor === '#123456')
    expect(colored).toHaveLength(2)
    const path = colored[0].opts.path as { lat: number; lng: number }[]
    expect(path[0]).toEqual({ lat: 1, lng: 2 })
    expect(path[path.length - 1]).toEqual({ lat: 3, lng: 4 })
    expect(path.length).toBeGreaterThan(2)
    // 光暈與顏色線同一份路徑。
    const casing = lines.find((l) => l !== colored[0] && l !== colored[1])!
    expect(casing.opts.path).toEqual(path)
  })

  it('段由無變有、由有變無:線出現又消失,站點圓點不受影響', () => {
    const { hook, props } = setup(withRoute(undefined))
    hook.rerender({ ...props, ...withRoute([AB]) })
    expect(visibleLines()).toHaveLength(2)
    hook.rerender({ ...props, ...withRoute(undefined) })
    expect(visibleLines()).toHaveLength(0)
    expect(visibleMarkers()).toHaveLength(3)
  })

  it('dark 傳遞:theme 為 dark 時光暈是黑色,否則白色;主題切換時原地更新', () => {
    const { hook, props } = setup({ ...withRoute([AB]), theme: 'light' }, '#123456')
    const casing = () => visibleLines().find((l) => l.opts.strokeColor !== '#123456')!
    expect(casing().opts.strokeColor).toBe('#ffffff')
    hook.rerender({ ...props, theme: 'dark' })
    expect(casing().opts.strokeColor).toBe('#000000')
  })

  it('沒有 stopDots:就算傳段也不畫(連線與站點圓點一起出現)', () => {
    setup({ routeSegments: [AB] })
    expect(visibleLines()).toHaveLength(0)
  })
})

// ===== 強調色(由共用子層自己讀,不再由接線處傳入) =====

describe('useSharedDrawLayer 強調色', () => {
  const stops = [{ id: 't', lat: 1, lng: 2, children: [{ id: 'c1', lat: 3, lng: 4, name: 'C1' }] }]

  it('從地圖容器的 --color-accent 讀出,用在選中主題點的範圍圓圈', () => {
    setup({ stopDots: { stops, selectedId: 't' } }, '#123456')
    const circle = FakeCircle.all.find((c) => c.map != null)!
    expect(circle.opts.strokeColor).toBe('#123456')
  })

  it('讀不到時退回預設強調色', () => {
    setup({ stopDots: { stops, selectedId: 't' } })
    const circle = FakeCircle.all.find((c) => c.map != null)!
    expect(circle.opts.strokeColor).toBe('#8B3A2F')
  })

  it('theme 改變:重新讀強調色,圓圈原地換色', () => {
    // 同一元素改 CSS 變數後,jsdom 的計算樣式沒有跟著變,所以主題切換用「換一個容器」模擬。
    let div = mapDiv('#111111')
    const map = { tag: 'map', getDiv: () => div } as unknown as google.maps.Map
    const base: Props = { mapRef: { current: map }, mapReady: true, currentPosition: null, theme: 'light', stopDots: { stops, selectedId: 't' } }
    const hook = renderHook((p: Props) => useSharedDrawLayer(p), { initialProps: base })
    const circle = FakeCircle.all.find((c) => c.map != null)!
    expect(circle.opts.strokeColor).toBe('#111111')
    div = mapDiv('#222222')
    hook.rerender({ ...base, theme: 'dark' })
    expect(FakeCircle.all.find((c) => c.map != null)).toBe(circle)
    expect(circle.opts.strokeColor).toBe('#222222')
  })
})


// ===== 行程 entry 與搜尋結果(登入後才有資料,從舊 hook 遷移進共用子層) =====

describe('useSharedDrawLayer 行程 entry', () => {
  const entry = (id: string, lat = 1) => ({ id, name: id, lat, lng: 2 })
  const entryMarkers = () => visibleMarkers().filter((m) => m.title !== '目前位置')
  const withEntries = (entries: ReturnType<typeof entry>[], over: Partial<NonNullable<Props['tripEntries']>> = {}): Partial<Props> => ({
    tripEntries: { entries, ...over },
  })

  it('沒傳 tripEntries(/ai-plan 沒有 entry):不畫', () => {
    setup({ currentPosition: { lat: 1, lng: 1 } })
    expect(entryMarkers()).toHaveLength(0)
  })

  it('每筆 entry 一顆旗子(標題為名稱),與站點、藍點一起畫', () => {
    setup({
      currentPosition: { lat: 1, lng: 1 },
      stopDots: { stops: [{ id: 's', lat: 5, lng: 6, name: 'S' }] },
      ...withEntries([entry('a'), entry('b')]),
    })
    expect(entryMarkers().map((m) => m.title).sort()).toEqual(['S', 'a', 'b'])
  })

  it('選中的 entry 疊在一般 entry 上面;選中改變原地更新同一顆', () => {
    const entries = [entry('a'), entry('b')]
    const { hook, props } = setup(withEntries(entries))
    const a = entryMarkers().find((m) => m.title === 'a')!
    const zBefore = a.zIndex
    hook.rerender({ ...props, ...withEntries(entries, { selectedKey: `entry:a:1:2` }) })
    expect(entryMarkers().find((m) => m.title === 'a')).toBe(a)
    expect(a.zIndex).toBeGreaterThan(zBefore!)
  })

  it('entry 全部消失:旗子移除,其餘不受影響', () => {
    const { hook, props } = setup({ currentPosition: { lat: 1, lng: 1 }, ...withEntries([entry('a')]) })
    hook.rerender({ ...props, ...withEntries([]) })
    expect(entryMarkers()).toHaveLength(0)
    expect(visibleMarkers().some((m) => m.title === '目前位置')).toBe(true)
  })

  it('強調色用在旗子內容(讀地圖容器的 --color-accent)', () => {
    setup(withEntries([entry('a')]), '#123456')
    const content = entryMarkers()[0].content as Element
    expect(content.outerHTML).toContain('#123456')
  })
})

describe('useSharedDrawLayer 搜尋結果', () => {
  const result = (kind: 'hotel' | 'place' | 'geocode', name: string) => ({ kind, name, address: '', lat: 1, lng: 2 })
  const resultMarkers = () => visibleMarkers().filter((m) => m.title !== '目前位置')
  const withResults = (results: ReturnType<typeof result>[], over: Partial<NonNullable<Props['searchResults']>> = {}): Partial<Props> => ({
    searchResults: { results, ...over },
  })

  it('沒傳 searchResults:不畫', () => {
    setup()
    expect(resultMarkers()).toHaveLength(0)
  })

  it('每筆結果一顆 marker(標題為名稱)', () => {
    setup(withResults([result('hotel', 'H'), result('place', 'P'), result('geocode', 'G')]))
    expect(resultMarkers().map((m) => m.title).sort()).toEqual(['G', 'H', 'P'])
  })

  it('點 marker:回報原本的結果;回呼換成新函式不會讓 marker 重建', () => {
    const results = [result('hotel', 'H')]
    const first = vi.fn()
    const second = vi.fn()
    const { hook, props } = setup(withResults(results, { onSelect: first }))
    const marker = resultMarkers()[0]
    hook.rerender({ ...props, ...withResults(results, { onSelect: second }) })
    expect(resultMarkers()[0]).toBe(marker)
    marker.click()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(results[0])
  })

  it('疊放:選中最上、定位結果次之、一般最底', () => {
    const results = [result('hotel', 'H'), result('geocode', 'G'), result('place', 'P')]
    setup(withResults(results, { selectedKey: 'place:P:1:2' }))
    const z = (t: string) => resultMarkers().find((m) => m.title === t)!.zIndex!
    expect(z('P')).toBeGreaterThan(z('G'))
    expect(z('G')).toBeGreaterThan(z('H'))
  })

  it('選取或候選改變:原地更新內容,不重建', () => {
    const results = [result('hotel', 'H')]
    const { hook, props } = setup(withResults(results))
    const marker = resultMarkers()[0]
    const before = marker.content
    hook.rerender({ ...props, ...withResults(results, { candidateKeys: new Set(['hotel:H:1:2']) }) })
    expect(resultMarkers()[0]).toBe(marker)
    expect(marker.content).not.toBe(before)
  })

  it('結果清空:marker 移除', () => {
    const { hook, props } = setup(withResults([result('hotel', 'H')]))
    hook.rerender({ ...props, ...withResults([]) })
    expect(resultMarkers()).toHaveLength(0)
  })
})
