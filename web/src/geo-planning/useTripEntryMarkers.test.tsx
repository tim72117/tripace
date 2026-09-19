// useTripEntryMarkers——隔離測試,理由與 mock 手法同 useSearchResultMarkers.
// test.tsx 開頭的說明。mock ./mapMarkers 的 tripEntryMarkerContent 與
// google.maps.marker.AdvancedMarkerElement。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTripEntryMarkers } from './useTripEntryMarkers'
import type { GeoTripEntry } from '../api'

type FakeMarkerCall = { position: { lat: number; lng: number }; title: string; content: unknown }

let constructedMarkers: FakeMarkerCall[] = []
let markerInstances: FakeAdvancedMarker[] = []

class FakeAdvancedMarker {
  map: unknown = null
  content: unknown
  zIndex: number | null = null
  title: string
  position: { lat: number; lng: number }
  constructor(opts: { position: { lat: number; lng: number }; map: unknown; title: string; content: unknown }) {
    this.map = opts.map
    this.content = opts.content
    this.title = opts.title
    this.position = opts.position
    constructedMarkers.push({ position: opts.position, title: opts.title, content: opts.content })
    markerInstances.push(this)
  }
}

const tripEntryMarkerContentMock = vi.fn((selected: boolean, color: string) => ({ tag: 'fake-flag', selected, color }))

vi.mock('./mapMarkers', () => ({
  tripEntryMarkerContent: (selected: boolean, color: string) => tripEntryMarkerContentMock(selected, color),
}))

;(globalThis as { google?: unknown }).google = {
  maps: { marker: { AdvancedMarkerElement: FakeAdvancedMarker } },
}

// makeFakeMap:getDiv() 回傳真實 DOM 元素供 getComputedStyle 讀取(jsdom
// 環境下對真實元素能正常運作,未設定的自訂屬性回傳空字串,落到程式碼裡
// 的 fallback 色碼),理由同 useAttractionOverlays.test.tsx 的
// makeFakeMap。可選擇性先設定 --color-accent,驗證讀取到自訂值而非
// fallback 的分支。
function makeFakeMap(accentColor?: string) {
  const div = document.createElement('div')
  if (accentColor) div.style.setProperty('--color-accent', accentColor)
  return { getDiv: () => div } as unknown as google.maps.Map
}

function tripEntry(overrides: Partial<GeoTripEntry> & { name: string; lat: number; lng: number }): GeoTripEntry {
  return { id: 'ent_1', ...overrides }
}

beforeEach(() => {
  constructedMarkers = []
  markerInstances = []
  tripEntryMarkerContentMock.mockClear()
})

describe('useTripEntryMarkers — marker 建立', () => {
  it('mapReady=false 或 mapRef.current 為 null 時不建立任何 marker', () => {
    const map = makeFakeMap()
    renderHook(() =>
      useTripEntryMarkers({ mapRef: { current: map }, mapReady: false, tripEntries: [tripEntry({ name: 'A', lat: 1, lng: 1 })] }),
    )
    expect(constructedMarkers).toHaveLength(0)

    renderHook(() =>
      useTripEntryMarkers({ mapRef: { current: null }, mapReady: true, tripEntries: [tripEntry({ name: 'A', lat: 1, lng: 1 })] }),
    )
    expect(constructedMarkers).toHaveLength(0)
  })

  it('每筆行程 entry 各建立一顆 marker,position/title 對應,不受可視範圍篩選', () => {
    const map = makeFakeMap()
    const entries = [
      tripEntry({ name: '清水寺', lat: 34.9949, lng: 135.785 }),
      tripEntry({ name: '八坂神社', lat: 35.0037, lng: 135.7784 }),
    ]
    renderHook(() => useTripEntryMarkers({ mapRef: { current: map }, mapReady: true, tripEntries: entries }))
    expect(constructedMarkers).toHaveLength(2)
    expect(constructedMarkers[0]).toMatchObject({ position: { lat: 34.9949, lng: 135.785 }, title: '清水寺' })
    expect(constructedMarkers[1]).toMatchObject({ position: { lat: 35.0037, lng: 135.7784 }, title: '八坂神社' })
  })

  it('未設定 --color-accent 時退回 fallback 色碼 #8B3A2F', () => {
    const map = makeFakeMap() // 不設定自訂屬性
    renderHook(() =>
      useTripEntryMarkers({ mapRef: { current: map }, mapReady: true, tripEntries: [tripEntry({ name: 'A', lat: 1, lng: 1 })] }),
    )
    expect(tripEntryMarkerContentMock).toHaveBeenCalledWith(false, '#8B3A2F')
  })

  it('tripEntries 變動時重建整批 marker(先清舊的 map=null,再建新的)', () => {
    const map = makeFakeMap()
    const a = tripEntry({ name: 'A', lat: 1, lng: 1 })
    const { rerender } = renderHook(
      ({ tripEntries }: { tripEntries: GeoTripEntry[] }) =>
        useTripEntryMarkers({ mapRef: { current: map }, mapReady: true, tripEntries }),
      { initialProps: { tripEntries: [a] } },
    )
    const firstMarker = markerInstances[0]
    expect(firstMarker.map).toBe(map)

    const b = tripEntry({ name: 'B', lat: 2, lng: 2 })
    rerender({ tripEntries: [a, b] })

    expect(firstMarker.map).toBeNull() // 舊的被清掉
    expect(constructedMarkers).toHaveLength(3) // 第一輪 1 顆 + 第二輪 2 顆
  })
})

describe('useTripEntryMarkers — 選取狀態同步', () => {
  it('selectedKey 對應到某筆 entry 時,該 marker 的 content 用 selected=true 重新產生、zIndex 拉高', () => {
    const map = makeFakeMap()
    const a = tripEntry({ name: 'A', lat: 1, lng: 1 })
    const b = tripEntry({ name: 'B', lat: 2, lng: 2 })
    const entries = [a, b]
    const { rerender } = renderHook(
      ({ selectedKey }: { selectedKey?: string | null }) =>
        useTripEntryMarkers({ mapRef: { current: map }, mapReady: true, tripEntries: entries, selectedKey }),
      { initialProps: { selectedKey: undefined as string | null | undefined } },
    )
    tripEntryMarkerContentMock.mockClear()
    const [markerA, markerB] = markerInstances

    rerender({ selectedKey: 'entry:A:1:1' })

    expect(tripEntryMarkerContentMock).toHaveBeenNthCalledWith(1, true, '#8B3A2F')
    expect(tripEntryMarkerContentMock).toHaveBeenNthCalledWith(2, false, '#8B3A2F')
    expect(markerA.zIndex).toBe(999)
    expect(markerB.zIndex).toBeNull()
  })

  it('這個 hook 沒有「狀態沒變就跳過」的優化——同步 effect 每次觸發都會對全部 entry 重新呼叫 content(對照 useSearchResultMarkers 的行為差異,如實反映目前程式碼)', () => {
    const map = makeFakeMap()
    const entries = [tripEntry({ name: 'A', lat: 1, lng: 1 })]
    const { rerender } = renderHook(
      ({ hoverKey }: { hoverKey?: string | null }) =>
        useTripEntryMarkers({ mapRef: { current: map }, mapReady: true, tripEntries: entries, hoverKey }),
      { initialProps: { hoverKey: undefined as string | null | undefined } },
    )
    tripEntryMarkerContentMock.mockClear()

    // hoverKey 變成跟這顆 marker 無關的值,選取狀態實際上沒變,但目前
    // 實作仍會重新呼叫一次(沒有 markerStateRef 這類比對機制)。
    rerender({ hoverKey: 'entry:不相干:9:9' })

    expect(tripEntryMarkerContentMock).toHaveBeenCalledTimes(1)
  })
})
