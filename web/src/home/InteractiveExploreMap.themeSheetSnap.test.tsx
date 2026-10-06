// InteractiveExploreMap(landing 頁互動地圖)手機版主題卡的初始段位——
// 2026-10 使用者明確要求「主題點預設最小段,精選點預設中間段」(見
// GeoOutlinePhoneInfoSheet.tsx activeSnapIndex 宣告旁的完整說明)。
//
// 這份測試存在的理由:單獨掛載 GeoOutlinePhoneInfoSheet(見
// GeoOutlinePhoneInfoSheet.snapIndex.test.tsx)只驗證了「這個元件收到
// attraction prop 時自己的初始化邏輯」,但使用者實際操作時關心的是「從
// 外面(這個展示頁的完整互動流程)剛打開時」的段位——主題點有兩種真實
// 開啟路徑:(1)使用者點擊地圖上的主題點地標(handleAttractionSelect →
// setOpenThemeId),(2)頁面載入時 defaultOpenTheme 自動開啟(見
// InteractiveExploreMap.tsx 該 prop 的完整說明)。兩條路徑在元件層級
// 共用同一個 openThemeId state、同一份 JSX 渲染輸出,但這份共用關係
// 本身才是容易出錯的地方(時序、中間渲染狀態等),必須真的從
// InteractiveExploreMap 這一層出發、走過地圖點擊/自動開啟的實際流程,
// 才能驗證兩條路徑最終呈現的段位是否一致、正確——不能只相信「程式碼
// 看起來共用同一段邏輯」就跳過這層驗證。
//
// mock 手法比照 ExploreMap.attractionClick.test.tsx(同一份慣例:mock
// @googlemaps/js-api-loader、mock ./geoAttractionOverlay 的
// getAttractionOverlayClass 截住點擊 callback、mock ../api 的查詢函式),
// 額外 mock window.matchMedia 讓 useIsDesktop 回傳 false(走手機版分支,
// 這份測試只關心 GeoOutlinePhoneInfoSheet,不關心桌面版 AttractionInfoPanel)。
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { InteractiveExploreMap } from './InteractiveExploreMap'
import phoneBottomSheetStyles from '../components/PhoneBottomSheet.module.css'
import type { GeoAttraction } from '../api'

// 2026-10 實測踩過的教訓:render() 預設不套用 StrictMode,只會跑一次
// render——但正式應用程式(main.tsx)用 <React.StrictMode> 包著掛載,開發
// 模式下 React 會刻意對同一個 fiber 的 render 階段重跑一次,用來抓「render
// 不是純函式」這類問題。曾經有一版 activeSnapIndex 初始化邏輯在 render
// 期間寫入 useRef 再比對修正,這個寫法在單次 render 下完全正確、這份
// 測試(當時沒套 StrictMode)全部通過,但在真正套了 StrictMode 的開發
// 環境下,第二次重跑 render 時 ref 已經被第一次悄悄改過,導致比對邏輯
// 誤判「沒有變化」,把原本該觸發的修正吃掉(使用者實測回報「起始的主題
// 點又變中間段」)——這份測試完全沒抓到,直到使用者在瀏覽器裡實際操作
// 才發現。改用 StrictMode 包住 render() 後,測試環境的渲染行為才能真正
// 複現 dev 環境,同類「render 期間有副作用、對渲染次數敏感」的 bug 才
// 會在測試階段就曝露,不必等到使用者實測回報。
function renderStrict(ui: React.ReactElement) {
  return render(<StrictMode>{ui}</StrictMode>)
}

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

const fetchPublicGeoAttractionsMock = vi.fn()

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchPublicGeoAttractions: (...args: unknown[]) => fetchPublicGeoAttractionsMock(...args),
    fetchPublicGeoPlaceDetails: vi.fn(() => Promise.reject(new Error('not used in this test'))),
    fetchPublicGeoPlacePhotoAssets: vi.fn(() => Promise.reject(new Error('not used in this test'))),
  }
})

// FakeOverlay:記錄每個 attraction 建構時傳入的 onClick,供測試直接呼叫
// 模擬點擊地圖上的主題點地標——不觸碰真正的 Google Maps OverlayView/DOM,
// 理由同 ExploreMap.attractionClick.test.tsx 開頭的說明。
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
  setFocused() {}
  setThemePhotoCollapsed() {}
  setPhotoUrls() {}
  setHidden() {}
  setLabelHidden() {}
  getLabelEl() {
    return null
  }
  getVisualEl() {
    return null
  }
  getLabelPriority() {
    return 0
  }
  isHidden() {
    return false
  }
}

vi.mock('../geo-planning/geoAttractionOverlay', () => ({
  getAttractionOverlayClass: () => FakeOverlay,
}))

;(globalThis as { google?: unknown }).google = {
  maps: {
    OverlayView: class {},
    LatLng: class {
      constructor(public lat: number, public lng: number) {}
    },
    event: { trigger: () => {} },
  },
}

// ResizeObserver:NativeMapBase.tsx 掛載時用它偵測地圖容器何時變成可見
// 尺寸,isVisible 變 true 才會真的觸發 Google Maps 建圖(見該檔案
// isVisible/建圖 effect 的完整說明:`if (!isVisible && !mapRef.current)
// return`)——jsdom 沒有實作 ResizeObserver,若只給一個空操作的假實作
// (observe 什麼都不做),isVisible 會永遠停在初始值 false,地圖永遠
// 不會真的建立,連帶 useAttractionOverlays 也不會建立任何 overlay,
// 「點擊地圖上的主題點」這條路徑就完全測不到(這份測試最初卡住正是
// 這個原因)。改成 observe() 被呼叫時同步立即觸發一次回報非零尺寸的
// callback,模擬容器一開始就是可見的情境。
class FakeResizeObserver {
  callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { width: 390, height: 844 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
  disconnect() {}
  unobserve() {}
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver)

// id:2026-10 使用者明確要求主題點改用 id 判斷(見 InteractiveExploreMap.tsx
// openThemeId 的完整說明)——現實中人工建檔的主題點恆有 id,這裡補上固定
// 字串(以 name 當 id,測試不關心實際格式,只需要非 undefined)避免這份
// fixture 跟真實資料形狀脫節。
function themeAttraction(name: string): GeoAttraction {
  return { id: `lmk_${name}`, name, lat: 35.0, lng: 135.76, isTheme: true }
}

function getPanel() {
  return screen.getByTestId('phone-bottom-sheet')
}

function isCollapsedToMinSnap() {
  return getPanel().className.includes(phoneBottomSheetStyles.panelCollapsed)
}

beforeEach(() => {
  clickHandlers = new Map()
  fetchPublicGeoAttractionsMock.mockReset()
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-api-key')
  vi.stubEnv('VITE_GOOGLE_MAPS_MAP_ID', 'test-map-id')
  // useIsDesktop 讀 matchMedia(min-width: 768px)——固定回傳 false,讓這個
  // 展示頁走手機版的 GeoOutlinePhoneInfoSheet 分支(見該 hook 的完整說明)。
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
})

describe('InteractiveExploreMap — 主題點 bottom sheet 從外部真實路徑開啟時的初始段位', () => {
  it('路徑一:使用者點擊地圖上的主題點地標 → 開啟時是最小段', async () => {
    fetchPublicGeoAttractionsMock.mockResolvedValue({ attractions: [themeAttraction('清水寺')] })
    renderStrict(<InteractiveExploreMap city="京都" />)

    await waitFor(() => expect(clickHandlers.get('清水寺')).toBeDefined())

    clickHandlers.get('清水寺')!(themeAttraction('清水寺'))

    await waitFor(() => expect(screen.queryByTestId('phone-bottom-sheet')).toBeInTheDocument())
    expect(isCollapsedToMinSnap()).toBe(true)
  })

  it('路徑二:頁面載入時 defaultOpenTheme 自動開啟 → 開啟時同樣是最小段(與路徑一一致)', async () => {
    fetchPublicGeoAttractionsMock.mockResolvedValue({ attractions: [themeAttraction('九份老街')] })
    renderStrict(<InteractiveExploreMap city="九份" defaultOpenTheme="九份老街" />)

    await waitFor(() => expect(screen.queryByTestId('phone-bottom-sheet')).toBeInTheDocument())
    expect(isCollapsedToMinSnap()).toBe(true)
  })
})
