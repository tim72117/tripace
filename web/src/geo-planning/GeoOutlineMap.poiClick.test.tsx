// GeoOutlineMap 的「點擊地圖上 Google 原生 POI 圖標」路徑——mock 整個
// @googlemaps/js-api-loader 與 api.ts 的查詢函式,不載入真實 Google Maps
// SDK,只驗證 click 監聽器有被正確註冊、點擊帶 placeId 的事件後確實呼叫
// fetchGeoPlaceDetails、查詢結果透過 onPoiSelect 往上回報。不驗證地圖
// 真實渲染、overlay/marker 圖層(那些測試成本高很多,且 attractions/
// hotels/places/tripEntries/geocodeCandidates 全部餵空陣列,對應的
// useAttractionOverlays 等 5 個 hook 在空陣列分支會提前 return,不會
// 呼叫到這裡沒有 mock 的 AdvancedMarkerElement/OverlayView 等 API)。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { GeoOutlineMap } from './GeoOutlineMap'
import type { ClientConfig, GeoPlaceDetails } from '../api'

// listeners:記錄 mock Map 實例上註冊過的所有事件監聽器,供測試手動
// 觸發(google.maps.Map.addListener 本身不提供「取得目前已註冊哪些
// 監聽器」的官方 API,這裡用最小可用的假實作記錄下來)。
type MapListeners = Record<string, ((event?: unknown) => void)[]>

let lastMapListeners: MapListeners = {}

class FakeMap {
  listeners: MapListeners = {}
  constructor() {
    lastMapListeners = this.listeners
  }
  addListener(event: string, handler: (event?: unknown) => void) {
    this.listeners[event] = this.listeners[event] ?? []
    this.listeners[event].push(handler)
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
  panTo() {}
  fitBounds() {}
  setZoom() {}
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
    // 掛載後 mapReady 變 true 會自動觸發依可視範圍查景點區域——回傳
    // 空結果即可,這條路徑不是這個測試檔案要驗證的對象。
    fetchGeoAttractionsOnlyNearby: vi.fn(() => Promise.resolve({ attractions: [] })),
  }
})

// global.google.maps:useAttractionOverlays(見該檔案的說明)在掛載時的
// effect 裡無條件呼叫 getAttractionOverlayClass()——即使
// filteredAttractions 是空陣列,這個函式本身(懶初始化、只建一次的
// OverlayView 子類別)仍會被呼叫到,子類別宣告 extends google.maps.
// OverlayView 在函式執行當下就會被求值,不補上這個全域物件會直接拋出
// ReferenceError。這裡補最小可用的假實作,只需要能被 extends、不需要
// 真的實作任何行為(這個測試不驗證景點區域圖層,只是要讓元件掛載不
// 崩潰)。
;(globalThis as { google?: unknown }).google = {
  maps: {
    OverlayView: class {},
    LatLng: class {
      constructor(public lat: number, public lng: number) {}
    },
  },
}

const cfg: ClientConfig = { baseURL: 'http://localhost:8080', token: null }

const placeDetails: GeoPlaceDetails = {
  name: '測試餐廳',
  address: '測試地址',
  lat: 35.0,
  lng: 135.76,
  photoUrl: 'https://example.com/photo.jpg',
}

beforeEach(() => {
  lastMapListeners = {}
  fetchGeoPlaceDetailsMock.mockReset()
  fetchGeoPlaceDetailsMock.mockResolvedValue(placeDetails)
  // VITE_GOOGLE_MAPS_API_KEY/MAP_ID 未設定時元件會直接顯示錯誤、不建圖
  // ——測試環境給假值即可,不需要真的能打 Google API。
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-api-key')
  vi.stubEnv('VITE_GOOGLE_MAPS_MAP_ID', 'test-map-id')
})

describe('GeoOutlineMap 點擊地圖上原生 POI', () => {
  it('click 監聽器有被註冊,點擊帶 placeId 的事件會呼叫 fetchGeoPlaceDetails 並透過 onPoiSelect 回報結果', async () => {
    const onPoiSelect = vi.fn()
    render(
      <GeoOutlineMap
        cfg={cfg}
        initialCenter={{ lat: 35.0, lng: 135.76 }}
        onPoiSelect={onPoiSelect}
      />,
    )

    await waitFor(() => {
      expect(lastMapListeners.click).toBeDefined()
      expect(lastMapListeners.click.length).toBeGreaterThan(0)
    })

    const stop = vi.fn()
    lastMapListeners.click[0]({ placeId: 'ChIJ測試placeId', stop })

    expect(stop).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(fetchGeoPlaceDetailsMock).toHaveBeenCalledWith(cfg, 'ChIJ測試placeId')
    })
    await waitFor(() => {
      expect(onPoiSelect).toHaveBeenCalledWith(placeDetails)
    })
  })

  it('點擊沒有 placeId 的一般點擊(地圖空白處)不觸發 fetchGeoPlaceDetails/onPoiSelect', async () => {
    const onPoiSelect = vi.fn()
    render(
      <GeoOutlineMap
        cfg={cfg}
        initialCenter={{ lat: 35.0, lng: 135.76 }}
        onPoiSelect={onPoiSelect}
      />,
    )

    await waitFor(() => {
      expect(lastMapListeners.click).toBeDefined()
    })

    const stop = vi.fn()
    lastMapListeners.click[0]({ stop })

    expect(stop).not.toHaveBeenCalled()
    expect(fetchGeoPlaceDetailsMock).not.toHaveBeenCalled()
    expect(onPoiSelect).not.toHaveBeenCalled()
  })
})
