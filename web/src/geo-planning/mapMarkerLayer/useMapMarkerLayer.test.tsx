// useMapMarkerLayer——隔離測試這支 hook 自己的 orchestration 邏輯(完全
// 受控的 selectedId/hoverId、雙向事件、supportsHover 開關、autoPan/
// pauseAutoPan),mock 手法同 useSearchResultMarkers.test.tsx/
// useTripEntryMarkers.test.tsx:
//   - mock ../mapMarkers 的 planStopMarkerContent,回傳帶 state 的假物件,
//     讓測試能直接讀 marker.content.state 判斷目前視覺狀態(不驗證真實
//     SVG markup,那是 mapMarkers.ts 自己的職責)。
//   - mock ../planStopOverlay 的 getPlanStopOverlayClass(hand-drawn 路徑)。
//   - 全域 google.maps 只提供這支 hook 實際用到的最小介面。
//
// 2026-10 改版(無限重渲染迴圈修正,見 types.ts/index.ts 開頭的完整
// 說明):這個 hook 不再是「內部受控+可選內部自主管理」的 useReducer
// 設計,改成完全受控(fully controlled)——selectedId/hoverId 永遠由
// 外部 props 決定,這個 hook 內部不持有、也不改變這兩個值。因此這份
// 測試不再驗證「result.current.select('a') 之後 result.current.selectedId
// 變成 'a'」這種「呼叫方法後內部狀態跟著變」的行為(完全受控下根本沒有
// 這種行為),改成驗證「呼叫方法/點擊 marker 後,對應的 on 回調有沒有
// 被正確呼叫、帶對的參數」,以及「selectedId/hoverId prop 改變後,
// marker 視覺有沒有正確同步」這兩件事。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMapMarkerLayer } from './index'
import type { MapMarkerLayerProps, MapMarkerPoint } from './types'

class FakeAdvancedMarker {
  map: unknown
  content: { state: string } | unknown
  zIndex: number | undefined
  title: string | undefined
  position: { lat: number; lng: number }
  clickHandlers: (() => void)[] = []
  constructor(opts: { position: { lat: number; lng: number }; map: unknown; title?: string; content: unknown; zIndex?: number }) {
    this.map = opts.map
    this.content = opts.content
    this.zIndex = opts.zIndex
    this.title = opts.title
    this.position = opts.position
    advancedMarkers.push(this)
  }
  addListener(event: string, handler: () => void) {
    if (event === 'gmp-click') this.clickHandlers.push(handler)
    return { remove: () => {} }
  }
  click() {
    this.clickHandlers.forEach((h) => h())
  }
}

class FakeCircle {
  map: unknown
  center: { lat: number; lng: number }
  constructor(opts: { map: unknown; center: { lat: number; lng: number } }) {
    this.map = opts.map
    this.center = opts.center
    circles.push(this)
  }
  setMap(map: unknown) {
    this.map = map
  }
}

class FakeOverlay {
  map: unknown = null
  state: string | null = null
  zIndex: number | null = null
  constructor(
    public position: unknown,
    public title: string | undefined,
    public onClick: (() => void) | undefined,
  ) {
    overlays.push(this)
  }
  setState(state: string) {
    this.state = state
  }
  setZIndex(z: number | null) {
    this.zIndex = z
  }
  setMap(map: unknown) {
    this.map = map
  }
}

let advancedMarkers: FakeAdvancedMarker[] = []
let circles: FakeCircle[] = []
let overlays: FakeOverlay[] = []

vi.mock('../mapMarkers', () => ({
  planStopMarkerContent: (state: string) => ({ state }),
}))

vi.mock('../planStopOverlay', () => ({
  getPlanStopOverlayClass: () => FakeOverlay,
}))

;(globalThis as { google?: unknown }).google = {
  maps: {
    marker: { AdvancedMarkerElement: FakeAdvancedMarker },
    Circle: FakeCircle,
    LatLng: class {
      constructor(
        public lat: number,
        public lng: number,
      ) {}
    },
    event: { clearInstanceListeners: () => {} },
  },
}

function makeFakeMap() {
  const div = document.createElement('div')
  return { getDiv: () => div, panTo: vi.fn() } as unknown as google.maps.Map & { panTo: ReturnType<typeof vi.fn> }
}

const A: MapMarkerPoint = { id: 'a', lat: 1, lng: 1, name: 'A', kind: 'attraction' }
const B: MapMarkerPoint = { id: 'b', lat: 2, lng: 2, name: 'B', kind: 'attraction' }
const T: MapMarkerPoint = {
  id: 't',
  lat: 3,
  lng: 3,
  name: 'T',
  kind: 'theme',
  children: [{ id: 't-c1', lat: 3.001, lng: 3.002, name: 'T1' }],
}
const POINTS = [A, B, T]

/** 只取一般 marker(排除主題點展開後的子景點小點)並依 title 查找 */
function markerByTitle(title: string) {
  const found = [...advancedMarkers].reverse().find((m) => m.title === title && m.map != null)
  if (!found) throw new Error(`找不到 marker ${title}`)
  return found
}
function visualState(title: string) {
  return (markerByTitle(title).content as { state: string }).state
}

type Props = Partial<MapMarkerLayerProps>
function setup(initial: Props = {}) {
  const map = makeFakeMap()
  const mapRef = { current: map }
  const hook = renderHook((props: Props) => useMapMarkerLayer({ mapRef, mapReady: true, points: POINTS, ...props }), {
    initialProps: initial,
  })
  return { map, ...hook }
}

beforeEach(() => {
  advancedMarkers = []
  circles = []
  overlays = []
})

describe('useMapMarkerLayer — marker 建立', () => {
  it('每個非 themeChild 的點各建立一顆 marker,初始皆為 base', () => {
    setup({ points: [...POINTS, { id: 'c', lat: 9, lng: 9, name: 'C', kind: 'themeChild' }] })
    expect(advancedMarkers.map((m) => m.title)).toEqual(['A', 'B', 'T'])
    expect(advancedMarkers.every((m) => (m.content as { state: string }).state === 'base')).toBe(true)
  })

  it('mapReady=false 時不建立 marker', () => {
    setup({ mapReady: false })
    expect(advancedMarkers).toHaveLength(0)
  })
})

describe('useMapMarkerLayer — 完全受控 selectedId/hoverId', () => {
  it('selectedId prop 改變時,marker 視覺同步更新(不需要呼叫任何方法)', () => {
    const { rerender } = setup({ selectedId: 'a' })
    expect(visualState('A')).toBe('selected')

    rerender({ selectedId: 'b' })
    expect(visualState('A')).toBe('base')
    expect(visualState('B')).toBe('selected')

    rerender({ selectedId: null })
    expect(visualState('B')).toBe('base')
  })

  it('selectedId 省略時視同 null,沒有任何點是 selected', () => {
    setup({})
    expect(visualState('A')).toBe('base')
    expect(visualState('B')).toBe('base')
  })

  it('hoverId prop 改變時,marker 視覺同步更新', () => {
    const { rerender } = setup({ hoverId: 'a' })
    expect(visualState('A')).toBe('hover')

    rerender({ hoverId: null })
    expect(visualState('A')).toBe('base')
  })

  it('hover 與 selected 同時命中同一點時 selected 優先', () => {
    setup({ selectedId: 'a', hoverId: 'a' })
    expect(visualState('A')).toBe('selected')
  })

  it('選中帶 children 的主題點時 expandedThemeId 回傳該點 id,並展開範圍圓圈+子景點小點', () => {
    const { result, rerender } = setup({ selectedId: 't' })
    expect(result.current.expandedThemeId).toBe('t')
    expect(circles).toHaveLength(1)
    expect(circles[0].center).toEqual({ lat: 3, lng: 3 })
    expect(advancedMarkers.some((m) => m.title === 'T1' && m.map != null)).toBe(true)

    rerender({ selectedId: 'a' })
    expect(result.current.expandedThemeId).toBeNull()
    expect(circles[0].map).toBeNull()
    expect(advancedMarkers.some((m) => m.title === 'T1' && m.map != null)).toBe(false)
  })
})

describe('useMapMarkerLayer — supportsHover', () => {
  it('supportsHover:false 時,hoverId prop 被忽略,恆回傳 null,marker 不會是 hover', () => {
    const { result, rerender } = setup({ supportsHover: false, hoverId: 'a' })
    expect(result.current.hoverId).toBeNull()
    expect(visualState('A')).toBe('base')

    rerender({ supportsHover: false, hoverId: 'b' })
    expect(result.current.hoverId).toBeNull()
    expect(visualState('B')).toBe('base')
  })

  it('supportsHover:false 時 hover() 方法是 no-op,不會呼叫 onHoverChange', () => {
    const onHoverChange = vi.fn()
    const { result } = setup({ supportsHover: false, onHoverChange })
    act(() => result.current.hover('a'))
    expect(onHoverChange).not.toHaveBeenCalled()
  })

  it('supportsHover:false 時 hoverTransitPair 被忽略', () => {
    setup({ supportsHover: false, hoverTransitPair: { fromId: 'a', toId: 'b' } })
    expect(visualState('A')).toBe('base')
    expect(visualState('B')).toBe('base')
  })

  it('supportsHover 執行期間由 true 轉 false,回傳的 hoverId 立刻變回 null(即使受控 hoverId prop 仍是舊值)', () => {
    const { result, rerender } = setup({ supportsHover: true, hoverId: 'a' })
    expect(result.current.hoverId).toBe('a')

    rerender({ supportsHover: false, hoverId: 'a' })
    expect(result.current.hoverId).toBeNull()
  })
})

describe('useMapMarkerLayer — onPointClick / onSelectedChange(點擊意圖通知)', () => {
  it('點擊 marker 時以 (id, point) 呼叫 onPointClick,並以 id 呼叫 onSelectedChange——純意圖通知,不會自己改變 selectedId', () => {
    const onPointClick = vi.fn()
    const onSelectedChange = vi.fn()
    const { result } = setup({ onPointClick, onSelectedChange })
    act(() => markerByTitle('B').click())
    expect(onPointClick).toHaveBeenCalledTimes(1)
    expect(onPointClick).toHaveBeenCalledWith('b', B)
    expect(onSelectedChange).toHaveBeenCalledTimes(1)
    expect(onSelectedChange).toHaveBeenCalledWith('b')
    // 沒有傳 selectedId prop,呼叫端也沒有把 onSelectedChange 收到的值
    // 寫回來,所以回傳的 selectedId 仍然是初始的 null——點擊本身不會
    // 自己改變這個值。
    expect(result.current.selectedId).toBeNull()
    expect(visualState('B')).toBe('base')
  })

  it('呼叫端把 onSelectedChange 收到的值寫回 selectedId prop 後,marker 視覺才會更新', () => {
    let selectedId: string | null = null
    const handleSelectedChange = (id: string | null) => {
      selectedId = id
    }
    const { rerender } = setup({ selectedId, onSelectedChange: handleSelectedChange })
    act(() => markerByTitle('B').click())
    rerender({ selectedId, onSelectedChange: handleSelectedChange })
    expect(visualState('B')).toBe('selected')
  })

  it('hand-drawn 路徑(useAdvancedMarkers:false)點擊 overlay 同樣觸發 onPointClick/onSelectedChange', () => {
    const onPointClick = vi.fn()
    const onSelectedChange = vi.fn()
    setup({ useAdvancedMarkers: false, onPointClick, onSelectedChange })
    expect(overlays).toHaveLength(3)
    act(() => overlays[0].onClick?.())
    expect(onPointClick).toHaveBeenCalledWith('a', A)
    expect(onSelectedChange).toHaveBeenCalledWith('a')
  })

  it('onPointClick/onSelectedChange 參照改變後(例如 inline arrow function 讀最新 state),既有 marker 點擊會呼叫到最新版本', () => {
    let latestTag = 'first'
    const calls: string[] = []
    const { rerender } = setup({ onSelectedChange: () => calls.push(latestTag) })

    latestTag = 'second'
    rerender({ onSelectedChange: () => calls.push(latestTag) })

    act(() => markerByTitle('A').click())
    expect(calls).toEqual(['second'])
  })
})

describe('useMapMarkerLayer — 主題點子景點晚到/選中子景點', () => {
  it('選取主題點時 children 還是空陣列,之後才補上內容,會重新展開範圍圓圈', () => {
    const themeNoChildrenYet = { ...T, children: [] }
    const { result, rerender } = setup({ points: [A, B, themeNoChildrenYet], selectedId: 't' })
    expect(result.current.expandedThemeId).toBeNull()

    rerender({ points: [A, B, T], selectedId: 't' })
    expect(result.current.expandedThemeId).toBe('t')
  })

  it('selectedId 剛好是子景點 id 時,expandedThemeId 回傳其所屬父主題點 id', () => {
    const { result } = setup({ selectedId: 't-c1' })
    expect(result.current.expandedThemeId).toBe('t')
  })
})

describe('useMapMarkerLayer — autoPanOnSelect / pauseAutoPan', () => {
  it('autoPanOnSelect 預設 false:selectedId 改變不呼叫 panTo', () => {
    const { map, rerender } = setup({ selectedId: null })
    rerender({ selectedId: 'a' })
    expect(map.panTo).not.toHaveBeenCalled()
  })

  it('autoPanOnSelect:true 時,selectedId 改變會 panTo 該點座標', () => {
    const { map, rerender } = setup({ autoPanOnSelect: true, selectedId: null })
    rerender({ autoPanOnSelect: true, selectedId: 'b' })
    expect(map.panTo).toHaveBeenCalledTimes(1)
    expect(map.panTo).toHaveBeenLastCalledWith({ lat: 2, lng: 2 })
  })

  it('pauseAutoPan:true 時,selectedId 改變不會 panTo', () => {
    const { map, rerender } = setup({ autoPanOnSelect: true, pauseAutoPan: true, selectedId: null })
    rerender({ autoPanOnSelect: true, pauseAutoPan: true, selectedId: 'a' })
    expect(map.panTo).not.toHaveBeenCalled()
  })

  it('pauseAutoPan 由 true 轉回 false 時,會補一次 panTo 到目前選取點(現行行為)', () => {
    const { map, rerender } = setup({ autoPanOnSelect: true, pauseAutoPan: true, selectedId: 'a' })
    expect(map.panTo).not.toHaveBeenCalled()
    rerender({ autoPanOnSelect: true, pauseAutoPan: false, selectedId: 'a' })
    expect(map.panTo).toHaveBeenCalledTimes(1)
    expect(map.panTo).toHaveBeenLastCalledWith({ lat: 1, lng: 1 })
  })
})

describe('useMapMarkerLayer — select / hover / clearSelection(語意化捷徑)', () => {
  it('select(id) 等同呼叫 onSelectedChange(id),不會自己改變 selectedId', () => {
    const onSelectedChange = vi.fn()
    const { result } = setup({ onSelectedChange })
    act(() => result.current.select('t'))
    expect(onSelectedChange).toHaveBeenCalledWith('t')
    expect(result.current.selectedId).toBeNull()
  })

  it('hover(id) 等同呼叫 onHoverChange(id)', () => {
    const onHoverChange = vi.fn()
    const { result } = setup({ onHoverChange })
    act(() => result.current.hover('b'))
    expect(onHoverChange).toHaveBeenCalledWith('b')
    act(() => result.current.hover(null))
    expect(onHoverChange).toHaveBeenCalledWith(null)
  })

  it('clearSelection() 等同呼叫 onSelectedChange(null)', () => {
    const onSelectedChange = vi.fn()
    const { result } = setup({ selectedId: 't', onSelectedChange })
    act(() => result.current.clearSelection())
    expect(onSelectedChange).toHaveBeenCalledWith(null)
  })
})
