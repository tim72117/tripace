// useAttractionOverlays——直接用 renderHook 隔離測試這個 hook 自己的
// orchestration 邏輯(哪些景點區域該顯示、overlay 何時重建 vs 只更新既有
// 實例、點擊回呼),不透過完整的 ExploreMap 掛載(那樣的整合測試成本高
// 很多,且會混進地圖建圖/查詢等不相關邏輯,見 ExploreMap.poiClick.test.tsx
// 開頭的說明,選擇的是另一種取捨)。
//
// mock ./geoAttractionOverlay 的 getAttractionOverlayClass,回傳一個純
// 記錄用的 FakeOverlay class,不觸碰真正的 Google Maps OverlayView/DOM
// markup——那是 geoAttractionOverlay.ts 自己的職責,不在這個測試範圍內。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAttractionOverlays } from './useAttractionOverlays'
import type { GeoAttraction } from '../api'

type FakeOverlayCall = {
  attraction: GeoAttraction
  position: { lat: number; lng: number }
  selected: boolean
  candidate: boolean
  onClick: (attraction: GeoAttraction) => void
}

let constructedOverlays: FakeOverlayCall[] = []
let overlayInstances: FakeOverlay[] = []

class FakeOverlay {
  setMapCalls: (google.maps.Map | null)[] = []
  selectedHistory: boolean[] = []
  candidateHistory: boolean[] = []
  hoveredHistory: boolean[] = []
  constructor(
    public attraction: GeoAttraction,
    position: { lat: number; lng: number },
    selected: boolean,
    candidate: boolean,
    public onClick: (attraction: GeoAttraction) => void,
  ) {
    constructedOverlays.push({ attraction, position, selected, candidate, onClick })
    overlayInstances.push(this)
  }
  setMap(map: google.maps.Map | null) {
    this.setMapCalls.push(map)
  }
  setSelected(selected: boolean) {
    this.selectedHistory.push(selected)
  }
  setCandidate(candidate: boolean) {
    this.candidateHistory.push(candidate)
  }
  setHovered(hovered: boolean) {
    this.hoveredHistory.push(hovered)
  }
}

vi.mock('./geoAttractionOverlay', () => ({
  getAttractionOverlayClass: () => FakeOverlay,
}))

// global.google.maps:hook 內用 new google.maps.LatLng(...)組座標——這裡
// 補最小可用假實作。
;(globalThis as { google?: unknown }).google = {
  maps: {
    LatLng: class {
      constructor(public lat: number, public lng: number) {}
    },
  },
}

// FakeMap:hook 目前不需要真的用到地圖實例的任何方法(見 mapRef 型別要求),
// 空物件即可滿足型別。
function makeFakeMap(): google.maps.Map {
  return {} as unknown as google.maps.Map
}

function attraction(overrides: Partial<GeoAttraction> & { name: string; lat: number; lng: number }): GeoAttraction {
  return { isTheme: false, ...overrides }
}

beforeEach(() => {
  constructedOverlays = []
  overlayInstances = []
})

describe('useAttractionOverlays — filteredAttractions 分級規則', () => {
  it('level 為 undefined(即時查 Google Places 結果)一律顯示,不受 revealedAttractionNames 限制', () => {
    const mapRef = { current: makeFakeMap() }
    const live = attraction({ name: '即時結果', lat: 1, lng: 1, isTheme: false, level: undefined })
    renderHook(() =>
      useAttractionOverlays({
        mapRef,
        mapReady: true,
        attractions: [live],
        revealedAttractionNames: new Set(),
      }),
    )
    expect(constructedOverlays.map((c) => c.attraction.name)).toEqual(['即時結果'])
  })

  it('isTheme=true(主題點)恆顯示,不受 revealedAttractionNames 限制', () => {
    const mapRef = { current: makeFakeMap() }
    const theme = attraction({ name: '清水寺', lat: 1, lng: 1, isTheme: true, level: 1 })
    renderHook(() =>
      useAttractionOverlays({
        mapRef,
        mapReady: true,
        attractions: [theme],
        revealedAttractionNames: new Set(),
      }),
    )
    expect(constructedOverlays.map((c) => c.attraction.name)).toEqual(['清水寺'])
  })

  it('isTheme=false 且有 level(精選點):只有在 revealedAttractionNames 裡才顯示', () => {
    const mapRef = { current: makeFakeMap() }
    const revealed = attraction({ name: '二年坂', lat: 1, lng: 1, isTheme: false, level: 2 })
    const notRevealed = attraction({ name: '未揭露景點', lat: 2, lng: 2, isTheme: false, level: 2 })
    renderHook(() =>
      useAttractionOverlays({
        mapRef,
        mapReady: true,
        attractions: [revealed, notRevealed],
        revealedAttractionNames: new Set(['二年坂']),
      }),
    )
    expect(constructedOverlays.map((c) => c.attraction.name)).toEqual(['二年坂'])
  })

  it('revealedAttractionNames 為 undefined/null 時,精選點一律不顯示(主題點不受影響)', () => {
    const mapRef = { current: makeFakeMap() }
    const theme = attraction({ name: '八坂神社', lat: 1, lng: 1, isTheme: true, level: 1 })
    const curated = attraction({ name: '圓山公園', lat: 2, lng: 2, isTheme: false, level: 2 })
    renderHook(() =>
      useAttractionOverlays({
        mapRef,
        mapReady: true,
        attractions: [theme, curated],
        revealedAttractionNames: undefined,
      }),
    )
    expect(constructedOverlays.map((c) => c.attraction.name)).toEqual(['八坂神社'])
  })
})

describe('useAttractionOverlays — overlay 生命週期', () => {
  it('mapReady=false 時不建立任何 overlay', () => {
    const mapRef = { current: makeFakeMap() }
    renderHook(() =>
      useAttractionOverlays({
        mapRef,
        mapReady: false,
        attractions: [attraction({ name: 'A', lat: 1, lng: 1, isTheme: true })],
      }),
    )
    expect(constructedOverlays).toHaveLength(0)
  })

  it('mapRef.current 為 null 時不建立任何 overlay', () => {
    const mapRef = { current: null }
    renderHook(() =>
      useAttractionOverlays({
        mapRef,
        mapReady: true,
        attractions: [attraction({ name: 'A', lat: 1, lng: 1, isTheme: true })],
      }),
    )
    expect(constructedOverlays).toHaveLength(0)
  })

  it('filteredAttractions 變動時,重建整批 overlay(先清舊的 setMap(null),再建新的)', () => {
    const mapRef = { current: makeFakeMap() }
    const a = attraction({ name: 'A', lat: 1, lng: 1, isTheme: true })
    const b = attraction({ name: 'B', lat: 2, lng: 2, isTheme: true })
    const { rerender } = renderHook(
      ({ attractions }: { attractions: GeoAttraction[] }) =>
        useAttractionOverlays({ mapRef, mapReady: true, attractions }),
      { initialProps: { attractions: [a] } },
    )
    expect(constructedOverlays.map((c) => c.attraction.name)).toEqual(['A'])
    const firstOverlay = overlayInstances[0]

    rerender({ attractions: [a, b] })

    // 舊的那顆(A)在重建前應該被 setMap(null)清掉一次
    expect(firstOverlay.setMapCalls).toContain(null)
    // 重建後總共呼叫過 3 次建構子(第一輪 A、第二輪 A+B)
    expect(constructedOverlays).toHaveLength(3)
    expect(constructedOverlays.slice(1).map((c) => c.attraction.name)).toEqual(['A', 'B'])
  })

  it('點擊 overlay(觸發建構時傳入的 onClick)會呼叫 onAttractionSelect', () => {
    const mapRef = { current: makeFakeMap() }
    const onAttractionSelect = vi.fn()
    const a = attraction({ name: 'A', lat: 1, lng: 1, isTheme: true })
    renderHook(() =>
      useAttractionOverlays({ mapRef, mapReady: true, attractions: [a], onAttractionSelect }),
    )
    constructedOverlays[0].onClick(a)
    expect(onAttractionSelect).toHaveBeenCalledWith(a)
  })
})

describe('useAttractionOverlays — 選取/候選籃/hover 狀態只更新既有實例,不重建 DOM', () => {
  it('selectedKey/hoverKey 變動時呼叫既有 overlay 的 setSelected,不觸發重建', () => {
    const mapRef = { current: makeFakeMap() }
    const a = attraction({ name: 'A', lat: 1, lng: 1, isTheme: true })
    // attractions 陣列參照提到 renderHook 呼叫之外、固定不變——若在
    // render callback 內直接寫 `attractions: [a]`,每次 rerender 都會
    // 是新的陣列參照,filteredAttractions 的 useMemo 會誤判資料真的變了
    // 而觸發整批重建,蓋掉這裡真正要驗證的「只更新既有實例」路徑。
    const attractions = [a]
    const { rerender } = renderHook(
      ({ selectedKey }: { selectedKey?: string | null }) =>
        useAttractionOverlays({ mapRef, mapReady: true, attractions, selectedKey }),
      { initialProps: { selectedKey: undefined as string | null | undefined } },
    )
    const overlay = overlayInstances[0]
    const constructCountBefore = constructedOverlays.length

    rerender({ selectedKey: 'attraction:A:1:1' })

    expect(overlay.selectedHistory).toContain(true)
    // 沒有新的建構呼叫(重建只發生在 filteredAttractions 變動時)
    expect(constructedOverlays).toHaveLength(constructCountBefore)
  })

  it('candidateKeys 變動時呼叫既有 overlay 的 setCandidate,不觸發重建', () => {
    const mapRef = { current: makeFakeMap() }
    const a = attraction({ name: 'A', lat: 1, lng: 1, isTheme: true })
    const attractions = [a]
    const { rerender } = renderHook(
      ({ candidateKeys }: { candidateKeys?: Set<string> }) =>
        useAttractionOverlays({ mapRef, mapReady: true, attractions, candidateKeys }),
      { initialProps: { candidateKeys: undefined as Set<string> | undefined } },
    )
    const overlay = overlayInstances[0]
    const constructCountBefore = constructedOverlays.length

    rerender({ candidateKeys: new Set(['attraction:A:1:1']) })

    expect(overlay.candidateHistory).toContain(true)
    expect(constructedOverlays).toHaveLength(constructCountBefore)
  })

  it('hoveredCuratedName 變動時呼叫既有 overlay 的 setHovered,不觸發重建', () => {
    const mapRef = { current: makeFakeMap() }
    const a = attraction({ name: '二年坂', lat: 1, lng: 1, isTheme: false, level: 2 })
    const attractions = [a]
    // revealedAttractionNames 同理也要提到外層固定——它也是
    // filteredAttractions useMemo 的依賴之一。
    const revealedAttractionNames = new Set(['二年坂'])
    const { rerender } = renderHook(
      ({ hoveredCuratedName }: { hoveredCuratedName?: string | null }) =>
        useAttractionOverlays({
          mapRef,
          mapReady: true,
          attractions,
          revealedAttractionNames,
          hoveredCuratedName,
        }),
      { initialProps: { hoveredCuratedName: undefined as string | null | undefined } },
    )
    const overlay = overlayInstances[0]
    const constructCountBefore = constructedOverlays.length

    rerender({ hoveredCuratedName: '二年坂' })

    expect(overlay.hoveredHistory).toContain(true)
    expect(constructedOverlays).toHaveLength(constructCountBefore)
  })
})
