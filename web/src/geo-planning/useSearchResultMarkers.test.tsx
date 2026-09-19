// useSearchResultMarkers——隔離測試這個 hook 自己的 orchestration 邏輯,
// 理由與 mock 手法同 useAttractionOverlays.test.tsx 開頭的說明。mock
// ./mapMarkers 的 searchResultMarkerContent(回傳固定假值,不驗證真實
// SVG markup,那是 mapMarkers.ts 自己的職責)與 google.maps.marker.
// AdvancedMarkerElement(用 property assignment 設定 map,不是 setMap()
// 方法,跟 useAttractionOverlays 用的 OverlayView 風格不同,見下方
// FakeAdvancedMarker 的完整實作)。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSearchResultMarkers } from './useSearchResultMarkers'
import type { GeoSearchResult } from '../api'

type FakeMarkerCall = {
  position: { lat: number; lng: number }
  title: string
  content: unknown
  zIndex: number | null
}

let constructedMarkers: FakeMarkerCall[] = []
let markerInstances: FakeAdvancedMarker[] = []

class FakeAdvancedMarker {
  map: unknown = null
  content: unknown
  zIndex: number | null
  title: string
  position: { lat: number; lng: number }
  clickHandlers: (() => void)[] = []
  constructor(opts: { position: { lat: number; lng: number }; map: unknown; title: string; content: unknown; zIndex: number | null }) {
    this.map = opts.map
    this.content = opts.content
    this.zIndex = opts.zIndex
    this.title = opts.title
    this.position = opts.position
    constructedMarkers.push({ position: opts.position, title: opts.title, content: opts.content, zIndex: opts.zIndex })
    markerInstances.push(this)
  }
  addListener(event: string, handler: () => void) {
    if (event === 'gmp-click') this.clickHandlers.push(handler)
    return { remove: () => {} }
  }
}

const searchResultMarkerContentMock = vi.fn(
  (_result: unknown, _selected: boolean, _candidate: boolean, _index?: number) => ({ tag: 'fake-content' }) as unknown,
)

vi.mock('./mapMarkers', () => ({
  searchResultMarkerContent: (...args: [unknown, boolean, boolean, (number | undefined)?]) =>
    searchResultMarkerContentMock(...args),
}))

type FakeBoundsExtendCall = { lat: number; lng: number }
let constructedBounds: { extendCalls: FakeBoundsExtendCall[] }[] = []
class FakeLatLngBounds {
  extendCalls: FakeBoundsExtendCall[] = []
  constructor() {
    constructedBounds.push(this)
  }
  extend(point: FakeBoundsExtendCall) {
    this.extendCalls.push(point)
  }
}

;(globalThis as { google?: unknown }).google = {
  maps: {
    marker: { AdvancedMarkerElement: FakeAdvancedMarker },
    LatLngBounds: FakeLatLngBounds,
  },
}

type FitBoundsCall = { bounds: unknown; padding: number }
function makeFakeMap() {
  const fitBoundsCalls: FitBoundsCall[] = []
  const map = {
    fitBounds: (bounds: unknown, padding: number) => fitBoundsCalls.push({ bounds, padding }),
  } as unknown as google.maps.Map
  return { map, fitBoundsCalls }
}

function result(overrides: Partial<GeoSearchResult> & { kind: GeoSearchResult['kind']; name: string; lat: number; lng: number }): GeoSearchResult {
  return { address: '', ...overrides }
}

beforeEach(() => {
  constructedMarkers = []
  markerInstances = []
  constructedBounds = []
  searchResultMarkerContentMock.mockClear()
})

describe('useSearchResultMarkers — marker 建立與 geocode 編號', () => {
  it('mapReady=false 或 mapRef.current 為 null 時不建立任何 marker', () => {
    const { map } = makeFakeMap()
    renderHook(() =>
      useSearchResultMarkers({
        mapRef: { current: map },
        mapReady: false,
        results: [result({ kind: 'hotel', name: 'A', lat: 1, lng: 1 })],
      }),
    )
    expect(constructedMarkers).toHaveLength(0)

    renderHook(() =>
      useSearchResultMarkers({
        mapRef: { current: null },
        mapReady: true,
        results: [result({ kind: 'hotel', name: 'A', lat: 1, lng: 1 })],
      }),
    )
    expect(constructedMarkers).toHaveLength(0)
  })

  it('每筆結果各建立一顆 marker,position/title 對應', () => {
    const { map } = makeFakeMap()
    const results = [
      result({ kind: 'hotel', name: '飯店A', lat: 1, lng: 2 }),
      result({ kind: 'place', name: '地點B', lat: 3, lng: 4 }),
    ]
    renderHook(() => useSearchResultMarkers({ mapRef: { current: map }, mapReady: true, results }))
    expect(constructedMarkers).toHaveLength(2)
    expect(constructedMarkers[0]).toMatchObject({ position: { lat: 1, lng: 2 }, title: '飯店A' })
    expect(constructedMarkers[1]).toMatchObject({ position: { lat: 3, lng: 4 }, title: '地點B' })
  })

  it('geocode 編號只在同一批 geocode 結果內連續計算,不受混雜的 hotel/place 影響', () => {
    const { map } = makeFakeMap()
    const results = [
      result({ kind: 'geocode', name: '候選1', lat: 1, lng: 1 }),
      result({ kind: 'hotel', name: '飯店', lat: 2, lng: 2 }),
      result({ kind: 'geocode', name: '候選2', lat: 3, lng: 3 }),
      result({ kind: 'geocode', name: '候選3', lat: 4, lng: 4 }),
    ]
    renderHook(() => useSearchResultMarkers({ mapRef: { current: map }, mapReady: true, results }))

    // searchResultMarkerContent 第 4 個參數是 geocode 編號(1-based),
    // 非 geocode 結果應傳 undefined。
    expect(searchResultMarkerContentMock.mock.calls[0][3]).toBe(1) // 候選1
    expect(searchResultMarkerContentMock.mock.calls[1][3]).toBeUndefined() // 飯店
    expect(searchResultMarkerContentMock.mock.calls[2][3]).toBe(2) // 候選2
    expect(searchResultMarkerContentMock.mock.calls[3][3]).toBe(3) // 候選3
  })

  it('geocode 結果存在時呼叫 fitBounds(padding 64),涵蓋全部 geocode 座標;沒有 geocode 結果時不呼叫', () => {
    const { map, fitBoundsCalls } = makeFakeMap()
    const results = [
      result({ kind: 'geocode', name: '候選1', lat: 1, lng: 1 }),
      result({ kind: 'geocode', name: '候選2', lat: 2, lng: 2 }),
      result({ kind: 'hotel', name: '飯店', lat: 3, lng: 3 }),
    ]
    renderHook(() => useSearchResultMarkers({ mapRef: { current: map }, mapReady: true, results }))
    expect(fitBoundsCalls).toHaveLength(1)
    expect(fitBoundsCalls[0].padding).toBe(64)
    expect(constructedBounds).toHaveLength(1)
    expect(constructedBounds[0].extendCalls).toEqual([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }])

    const { map: map2, fitBoundsCalls: fitBoundsCalls2 } = makeFakeMap()
    renderHook(() =>
      useSearchResultMarkers({
        mapRef: { current: map2 },
        mapReady: true,
        results: [result({ kind: 'hotel', name: '飯店', lat: 3, lng: 3 })],
      }),
    )
    expect(fitBoundsCalls2).toHaveLength(0)
  })

  it('點擊 marker(gmp-click)會呼叫 onSelect 並帶回對應的 result', () => {
    const { map } = makeFakeMap()
    const onSelect = vi.fn()
    const r = result({ kind: 'place', name: '地點', lat: 1, lng: 1 })
    renderHook(() =>
      useSearchResultMarkers({ mapRef: { current: map }, mapReady: true, results: [r], onSelect }),
    )
    markerInstances[0].clickHandlers[0]()
    expect(onSelect).toHaveBeenCalledWith(r)
  })
})

describe('useSearchResultMarkers — 選取/候選籃狀態同步(避免不必要的重繪)', () => {
  it('狀態真的改變的那顆 marker 才重新指派 content/zIndex,其餘完全不動', () => {
    const { map } = makeFakeMap()
    // results 陣列參照提到外層固定——理由同 useAttractionOverlays.test.tsx
    // 修正過的教訓,但這裡其實沒有這個風險:這個 hook 建立/重建的依賴是
    // resultsKey(內容摘要字串),不是陣列參照本身,天然不會誤判成資料
    // 變了(見 useSearchResultMarkers.ts 開頭的設計說明),仍固定參照純粹
    // 圖方便,不是必要條件。
    const results = [
      result({ kind: 'hotel', name: 'A', lat: 1, lng: 1 }),
      result({ kind: 'hotel', name: 'B', lat: 2, lng: 2 }),
    ]
    const { rerender } = renderHook(
      ({ selectedKey }: { selectedKey?: string | null }) =>
        useSearchResultMarkers({ mapRef: { current: map }, mapReady: true, results, selectedKey }),
      { initialProps: { selectedKey: undefined as string | null | undefined } },
    )
    searchResultMarkerContentMock.mockClear()
    const [markerA, markerB] = markerInstances

    rerender({ selectedKey: 'hotel:A:1:1' })

    // A 的狀態真的變了(從未選取變選取),應該重新指派 content
    expect(searchResultMarkerContentMock).toHaveBeenCalledTimes(1)
    expect(searchResultMarkerContentMock.mock.calls[0][0]).toMatchObject({ name: 'A' })
    expect(markerA.zIndex).toBe(999)
    // B 的狀態沒變,zIndex 應維持初始值(未選取、非 geocode → null)
    expect(markerB.zIndex).toBeNull()
  })

  it('同步 effect 重複觸發但狀態沒變時,完全不重新指派 content', () => {
    const { map } = makeFakeMap()
    const results = [result({ kind: 'hotel', name: 'A', lat: 1, lng: 1 })]
    const { rerender } = renderHook(
      ({ hoverKey }: { hoverKey?: string | null }) =>
        useSearchResultMarkers({ mapRef: { current: map }, mapReady: true, results, hoverKey }),
      { initialProps: { hoverKey: undefined as string | null | undefined } },
    )
    searchResultMarkerContentMock.mockClear()

    // hoverKey 從 undefined 變成另一個跟這顆 marker 無關的值,這顆 marker
    // 的 selected/candidate 狀態實際上沒有改變。
    rerender({ hoverKey: 'hotel:不相干:9:9' })

    expect(searchResultMarkerContentMock).not.toHaveBeenCalled()
  })
})
