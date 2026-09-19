// ExploreMap 的「點擊地圖上景點區域(attraction)地標圖示」路徑——
// handleAttractionClickRouted 的完整 7 條分岔(見 ExploreMap.tsx 該函式
// 與其相關 props 的完整說明)。這段邏輯先前完全沒有測試覆蓋,且
// docs/handoff-attraction-theme-place-cards-2026-09.md 記錄過一個實際
// 發生、反覆修正才抓到根因的 production bug(非主題點點擊誤取代主題
// 卡)——這裡把當時修好的正確行為(7 條分岔全部)釘住,避免之後重構
// (見對話中討論的 MapHandle 架構)不小心破壞掉。
//
// mock 手法比照 ExploreMap.poiClick.test.tsx(同一份檔案已建立的既有
// 慣例:mock @googlemaps/js-api-loader、mock ../api 的查詢函式、補最小
// 可用的 global.google.maps),額外 mock ./geoAttractionOverlay 的
// getAttractionOverlayClass(比照 useAttractionOverlays.test.tsx 的
// FakeOverlay 手法),藉此截住每個 attraction 對應的 onClick callback
// (即 useAttractionOverlays.ts 的 handleAttractionClick,內部呼叫的
// onAttractionSelect 正是 ExploreMap.tsx 的 handleAttractionClickRouted)
// ,呼叫它模擬真實點擊,不需要真的操作 Google Maps DOM/事件系統。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { ExploreMap } from './ExploreMap'
import type { ClientConfig, GeoAttraction, GeoPlaceDetails } from '../api'

class FakeMap {
  addListener() {
    return { remove: () => {} }
  }
  getCenter() {
    return { lat: () => 35.0, lng: () => 135.76 }
  }
  getZoom() {
    return 12
  }
  getBounds() {
    return null
  }
  getDiv() {
    return document.createElement('div')
  }
  panTo() {}
  fitBounds() {}
  setZoom() {}
  setCenter() {}
}

vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: vi.fn(),
  importLibrary: vi.fn((name: string) => {
    if (name === 'maps') return Promise.resolve({ Map: FakeMap })
    if (name === 'marker') return Promise.resolve({ AdvancedMarkerElement: class {} })
    return Promise.reject(new Error(`unexpected importLibrary(${name})`))
  }),
}))

const fetchGeoPlaceDetailsMock = vi.fn<(...args: unknown[]) => Promise<GeoPlaceDetails>>()

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchGeoPlaceDetails: (...args: unknown[]) => fetchGeoPlaceDetailsMock(...args),
    fetchGeoAttractionsOnlyNearby: vi.fn(() => Promise.resolve({ attractions: [] })),
  }
})

// FakeOverlay:記錄每個 attraction 建構時傳入的 onClick,供測試直接呼叫
// 模擬點擊——不觸碰真正的 Google Maps OverlayView/DOM,理由同
// useAttractionOverlays.test.tsx 開頭的說明。
let clickHandlers: Map<string, (attraction: GeoAttraction) => void> = new Map()
class FakeOverlay {
  constructor(
    attraction: GeoAttraction,
    _position: unknown,
    _selected: boolean,
    _candidate: boolean,
    onClick: (attraction: GeoAttraction) => void,
  ) {
    clickHandlers.set(attraction.name, onClick)
  }
  setMap() {}
  setSelected() {}
  setCandidate() {}
  setHovered() {}
}

vi.mock('./geoAttractionOverlay', () => ({
  getAttractionOverlayClass: () => FakeOverlay,
}))

// event.trigger:ExploreMap.tsx 掛載時排一個 requestAnimationFrame 回呼,
// 觸發 google.maps.event.trigger(mapRef.current, 'resize')——這個回呼會
// 在測試斷言都跑完之後才真正執行(jsdom 的 rAF 是透過 timer 模擬),沒
// 補這個假實作會在測試結束後才拋出未捕捉例外,汙染輸出(即使各項斷言
// 本身仍會通過)。ExploreMap.poiClick.test.tsx 目前也有這個既有缺口
// (同一段程式碼位置),這裡先補齊自己新增的這份測試檔案。
;(globalThis as { google?: unknown }).google = {
  maps: {
    OverlayView: class {},
    LatLng: class {
      constructor(public lat: number, public lng: number) {}
    },
    event: { trigger: () => {} },
  },
}

const cfg: ClientConfig = { baseURL: 'http://localhost:8080', token: null }

function attraction(overrides: Partial<GeoAttraction> & { name: string; lat: number; lng: number }): GeoAttraction {
  return { isTheme: false, ...overrides }
}

const placeDetails: GeoPlaceDetails = {
  name: '測試地點',
  address: '測試地址',
  lat: 35.0,
  lng: 135.76,
  photoUrl: 'https://example.com/photo.jpg',
  googlePhotoUrls: [],
  pexelsPhotoUrls: [],
}

beforeEach(() => {
  clickHandlers = new Map()
  fetchGeoPlaceDetailsMock.mockReset()
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-api-key')
  vi.stubEnv('VITE_GOOGLE_MAPS_MAP_ID', 'test-map-id')
})

describe('ExploreMap handleAttractionClickRouted — 分岔 1:主題點(isTheme=true)', () => {
  it('不論有沒有 placeId,一律直接呼叫 onAttractionSelect,不查 Google Place Details', async () => {
    const theme = attraction({ name: '清水寺', lat: 1, lng: 1, isTheme: true, placeId: 'ChIJ有placeId' })
    const onAttractionSelect = vi.fn()
    const onAttractionOpenPlaceDetails = vi.fn()
    render(
      <ExploreMap
        cfg={cfg}
        initialCenter={{ lat: 35.0, lng: 135.76 }}
        initialAttractions={[theme]}
        onAttractionSelect={onAttractionSelect}
        onAttractionOpenPlaceDetails={onAttractionOpenPlaceDetails}
      />,
    )
    await waitFor(() => expect(clickHandlers.get('清水寺')).toBeDefined())

    clickHandlers.get('清水寺')!(theme)

    expect(onAttractionSelect).toHaveBeenCalledWith(theme)
    expect(fetchGeoPlaceDetailsMock).not.toHaveBeenCalled()
    expect(onAttractionOpenPlaceDetails).not.toHaveBeenCalled()
  })
})

describe('ExploreMap handleAttractionClickRouted — 分岔 2/3:非主題點+有 placeId+查詢成功', () => {
  it('onAttractionOpenPlaceDetails 有提供時:呼叫它,帶入 (details, attraction)', async () => {
    const a = attraction({ name: '奧丹', lat: 1, lng: 1, isTheme: false, placeId: 'ChIJ奧丹' })
    fetchGeoPlaceDetailsMock.mockResolvedValue(placeDetails)
    const onAttractionOpenPlaceDetails = vi.fn()
    const onPoiSelect = vi.fn()
    render(
      <ExploreMap
        cfg={cfg}
        initialCenter={{ lat: 35.0, lng: 135.76 }}
        initialAttractions={[a]}
        onAttractionOpenPlaceDetails={onAttractionOpenPlaceDetails}
        onPoiSelect={onPoiSelect}
      />,
    )
    await waitFor(() => expect(clickHandlers.get('奧丹')).toBeDefined())

    clickHandlers.get('奧丹')!(a)

    await waitFor(() => expect(fetchGeoPlaceDetailsMock).toHaveBeenCalledWith(cfg, 'ChIJ奧丹'))
    await waitFor(() => expect(onAttractionOpenPlaceDetails).toHaveBeenCalledWith(placeDetails, a))
    expect(onPoiSelect).not.toHaveBeenCalled()
  })

  it('onAttractionOpenPlaceDetails 未提供時:退回呼叫 onPoiSelect(details),不帶 attraction', async () => {
    const a = attraction({ name: '奧丹', lat: 1, lng: 1, isTheme: false, placeId: 'ChIJ奧丹' })
    fetchGeoPlaceDetailsMock.mockResolvedValue(placeDetails)
    const onPoiSelect = vi.fn()
    render(
      <ExploreMap
        cfg={cfg}
        initialCenter={{ lat: 35.0, lng: 135.76 }}
        initialAttractions={[a]}
        onPoiSelect={onPoiSelect}
      />,
    )
    await waitFor(() => expect(clickHandlers.get('奧丹')).toBeDefined())

    clickHandlers.get('奧丹')!(a)

    await waitFor(() => expect(onPoiSelect).toHaveBeenCalledWith(placeDetails))
  })
})

describe('ExploreMap handleAttractionClickRouted — 分岔 4/5:非主題點+有 placeId+查詢失敗', () => {
  it('onAttractionOpenPlaceWithoutGoogle 有提供時:查詢失敗後改呼叫它,帶入 attraction', async () => {
    const a = attraction({ name: '七味家本舖', lat: 1, lng: 1, isTheme: false, placeId: 'ChIJ七味家' })
    fetchGeoPlaceDetailsMock.mockRejectedValue(new Error('查詢失敗'))
    const onAttractionOpenPlaceWithoutGoogle = vi.fn()
    const onAttractionSelect = vi.fn()
    render(
      <ExploreMap
        cfg={cfg}
        initialCenter={{ lat: 35.0, lng: 135.76 }}
        initialAttractions={[a]}
        onAttractionOpenPlaceWithoutGoogle={onAttractionOpenPlaceWithoutGoogle}
        onAttractionSelect={onAttractionSelect}
      />,
    )
    await waitFor(() => expect(clickHandlers.get('七味家本舖')).toBeDefined())

    clickHandlers.get('七味家本舖')!(a)

    await waitFor(() => expect(fetchGeoPlaceDetailsMock).toHaveBeenCalled())
    await waitFor(() => expect(onAttractionOpenPlaceWithoutGoogle).toHaveBeenCalledWith(a))
    // 這正是 2026-09-07 交接文件記錄的那個 bug 的反面驗證:查詢失敗時
    // 不該退回呼叫 onAttractionSelect(取代主題卡)。
    expect(onAttractionSelect).not.toHaveBeenCalled()
  })

  it('onAttractionOpenPlaceWithoutGoogle 未提供時:查詢失敗後退回呼叫 onAttractionSelect', async () => {
    const a = attraction({ name: '七味家本舖', lat: 1, lng: 1, isTheme: false, placeId: 'ChIJ七味家' })
    fetchGeoPlaceDetailsMock.mockRejectedValue(new Error('查詢失敗'))
    const onAttractionSelect = vi.fn()
    render(
      <ExploreMap
        cfg={cfg}
        initialCenter={{ lat: 35.0, lng: 135.76 }}
        initialAttractions={[a]}
        onAttractionSelect={onAttractionSelect}
      />,
    )
    await waitFor(() => expect(clickHandlers.get('七味家本舖')).toBeDefined())

    clickHandlers.get('七味家本舖')!(a)

    await waitFor(() => expect(onAttractionSelect).toHaveBeenCalledWith(a))
  })
})

describe('ExploreMap handleAttractionClickRouted — 分岔 6/7:非主題點+沒有 placeId', () => {
  it('onAttractionOpenPlaceWithoutGoogle 有提供時:直接呼叫它,完全不查 Google', async () => {
    const a = attraction({ name: '產寧坂聚落', lat: 1, lng: 1, isTheme: false }) // 無 placeId
    const onAttractionOpenPlaceWithoutGoogle = vi.fn()
    const onAttractionSelect = vi.fn()
    render(
      <ExploreMap
        cfg={cfg}
        initialCenter={{ lat: 35.0, lng: 135.76 }}
        initialAttractions={[a]}
        onAttractionOpenPlaceWithoutGoogle={onAttractionOpenPlaceWithoutGoogle}
        onAttractionSelect={onAttractionSelect}
      />,
    )
    await waitFor(() => expect(clickHandlers.get('產寧坂聚落')).toBeDefined())

    clickHandlers.get('產寧坂聚落')!(a)

    expect(fetchGeoPlaceDetailsMock).not.toHaveBeenCalled()
    expect(onAttractionOpenPlaceWithoutGoogle).toHaveBeenCalledWith(a)
    expect(onAttractionSelect).not.toHaveBeenCalled()
  })

  it('onAttractionOpenPlaceWithoutGoogle 未提供時:退回呼叫 onAttractionSelect(手機版單一 sheet 堆疊情境)', async () => {
    const a = attraction({ name: '產寧坂聚落', lat: 1, lng: 1, isTheme: false })
    const onAttractionSelect = vi.fn()
    render(
      <ExploreMap
        cfg={cfg}
        initialCenter={{ lat: 35.0, lng: 135.76 }}
        initialAttractions={[a]}
        onAttractionSelect={onAttractionSelect}
      />,
    )
    await waitFor(() => expect(clickHandlers.get('產寧坂聚落')).toBeDefined())

    clickHandlers.get('產寧坂聚落')!(a)

    expect(onAttractionSelect).toHaveBeenCalledWith(a)
  })
})
