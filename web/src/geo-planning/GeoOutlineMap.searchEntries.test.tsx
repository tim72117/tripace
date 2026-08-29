// GeoOutlineMap 地圖上「類別標籤(景點/飯店/餐廳)」與「搜尋這個區域」
// 按鈕這兩個查詢入口——斷言各自呼叫 fetchGeoGeocode 時帶的 mode/
// center/radius/query 是否正確。城市搜尋框(onSearch prop)本身的查詢
// 邏輯不在這個元件裡(在呼叫端 GeoOutlinePanel.tsx 的 useEffect,見該
// 檔案),不在這裡涵蓋。
//
// 背景:2026-08 三個入口統一改走 fetchGeoGeocode(Text Search),各自
// 固定帶不同的 mode(見 GeoOutlineMap.tsx 的 runPlacesQuery/
// handleCategoryClick/handleSearchThisArea 完整說明)——城市搜尋框用
// bias(兩階段,由 GeoOutlinePanel.tsx 負責)、類別標籤/搜尋這個區域
// 固定用 restrict、固定半徑 categoryQueryRadiusMeters(1500m)、中心點
// 一律是目前地圖中心(不是查詢文字本身指涉的地點)。這批「哪個入口用
// 哪種模式/半徑/中心」的決策目前完全沒有測試覆蓋,只靠程式碼裡的註解
// 交代意圖——很容易在下一次重構時被誤改(例如 mode 傳反、半徑常數被
// 誤動、center 改成用查詢文字反查而非地圖中心)卻沒有任何測試會亮紅燈,
// 見 GeoOutlinePhoneView.listDrawer.test.tsx 同一輪對「清單沒有自動
// 打開」bug 的教訓。
//
// mock 策略同 GeoOutlineMap.poiClick.test.tsx:整個 @googlemaps/
// js-api-loader 與 api.ts 查詢函式,不載入真實 SDK。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { GeoOutlineMap } from './GeoOutlineMap'
import type { ClientConfig, GeoGeocodeCandidate } from '../api'

type MapListeners = Record<string, ((event?: unknown) => void)[]>

let lastMapListeners: MapListeners = {}
let lastMapCenter = { lat: 35.0, lng: 135.76 }

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
    return { lat: () => lastMapCenter.lat, lng: () => lastMapCenter.lng }
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

const fetchGeoGeocodeMock = vi.fn<(...args: unknown[]) => Promise<{ query: string; candidates: GeoGeocodeCandidate[] }>>()

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchGeoGeocode: (...args: unknown[]) => fetchGeoGeocodeMock(...args),
    fetchGeoAttractionsOnlyNearby: vi.fn(() => Promise.resolve({ attractions: [] })),
  }
})

;(globalThis as { google?: unknown }).google = {
  maps: {
    OverlayView: class {},
    LatLng: class {
      constructor(public lat: number, public lng: number) {}
    },
  },
}

const cfg: ClientConfig = { baseURL: 'http://localhost:8080', token: null }

beforeEach(() => {
  lastMapListeners = {}
  lastMapCenter = { lat: 35.0, lng: 135.76 }
  fetchGeoGeocodeMock.mockReset()
  fetchGeoGeocodeMock.mockResolvedValue({ query: '', candidates: [] })
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-api-key')
  vi.stubEnv('VITE_GOOGLE_MAPS_MAP_ID', 'test-map-id')
})

describe('GeoOutlineMap 地圖上的查詢入口：fetchGeoGeocode 呼叫參數', () => {
  it('點擊「景點」類別標籤：固定用 restrict 模式、地圖中心、1500m 半徑', async () => {
    const onCityChange = vi.fn()
    render(
      <GeoOutlineMap
        cfg={cfg}
        initialCenter={{ lat: 35.0, lng: 135.76 }}
        city=""
        onCityChange={onCityChange}
        onSearch={() => {}}
      />,
    )

    await waitFor(() => {
      expect(lastMapListeners.idle).toBeDefined()
    })

    const categoryButton = await waitFor(() => {
      const btn = document.querySelector('button[title="景點"]')
      if (!btn) throw new Error('景點 button not found yet')
      return btn as HTMLButtonElement
    })

    act(() => categoryButton.click())

    // 標籤文字要寫回搜尋框(見 handleCategoryClick 的說明)。
    expect(onCityChange).toHaveBeenCalledWith('景點')

    await waitFor(() => {
      expect(fetchGeoGeocodeMock).toHaveBeenCalledTimes(1)
    })
    expect(fetchGeoGeocodeMock).toHaveBeenCalledWith(
      cfg,
      '景點',
      { lat: 35.0, lng: 135.76 },
      'restrict',
      1500,
    )
  })

  it('「搜尋這個區域」按鈕：沿用搜尋框文字、固定用 restrict 模式、地圖中心、1500m 半徑', async () => {
    const onCityChange = vi.fn()
    const { rerender } = render(
      <GeoOutlineMap
        cfg={cfg}
        initialCenter={{ lat: 35.0, lng: 135.76 }}
        city="京都"
        onCityChange={onCityChange}
        onSearch={() => {}}
      />,
    )

    await waitFor(() => {
      expect(lastMapListeners.idle).toBeDefined()
    })

    // 模擬使用者拖曳/縮放地圖後結束(idle 事件)——這是「搜尋這個區域」
    // 按鈕出現的前提(areaDirty 變 true,見 geoAreaSearchState.ts 的
    // map-idle 轉換,該檔案已有獨立測試守著這個轉換本身,這裡只借用它
    // 讓按鈕顯示出來)。地圖中心順便移動,驗證這裡查詢時真的是用「按下
    // 當下」的地圖中心,不是掛載時的舊值。
    lastMapCenter = { lat: 34.5, lng: 135.5 }
    act(() => {
      lastMapListeners.idle[0]()
    })

    const searchThisAreaButton = await waitFor(() => {
      const btn = document.querySelector('button[aria-busy]')
      if (!btn) throw new Error('搜尋這個區域 button not found yet')
      return btn as HTMLButtonElement
    })

    act(() => searchThisAreaButton.click())

    await waitFor(() => {
      expect(fetchGeoGeocodeMock).toHaveBeenCalledTimes(1)
    })
    // city prop 是「京都」——沿用搜尋框目前文字,不是類別標籤文字。
    expect(fetchGeoGeocodeMock).toHaveBeenCalledWith(
      cfg,
      '京都',
      { lat: 34.5, lng: 135.5 },
      'restrict',
      1500,
    )

    // rerender 只是確保 React 沒有因為這次互動拋出任何警告/錯誤
    // (act 警告等)——不是這個測試的核心斷言。
    rerender(
      <GeoOutlineMap
        cfg={cfg}
        initialCenter={{ lat: 35.0, lng: 135.76 }}
        city="京都"
        onCityChange={onCityChange}
        onSearch={() => {}}
      />,
    )
  })
})
