// GeoOutlinePhoneInfoSheet 的 activeSnapIndex 初始化分流——2026-10 使用者
// 明確要求「主題點預設最小段,精選點預設中間段」(見該 state 宣告旁的完整
// 說明)。這個元件在 InteractiveExploreMap.tsx 裡被兩種不同「路徑」共用
// 同一個實例:使用者點擊地圖上的主題點、以及頁面載入時透過
// defaultOpenTheme 自動開啟某個主題點——兩條路徑最終都是把 attraction
// prop 從 null 變成有值,觸發這個元件重新掛載(見 `open = content != null
// || attraction != null; if (!open) return null` 這個條件渲染,兩者都是
// 全新 mount,不是同一個實例的 prop 更新),所以不需要真的搭建完整的
// InteractiveExploreMap/地圖點擊/defaultOpenTheme 自動開啟流程去各自驗證
// 一次——只要驗證這個元件收到 attraction/content 的當下,activeSnapIndex
// 初始值與換卡後的值都正確,就等於兩條路徑都正確(它們除了怎麼把值灌進
// props 以外,共用完全相同的後續渲染邏輯)。
//
// 驗證手法:PhoneBottomSheet 的 isAtMinSnap(activeSnapIndex===0 且非
// 單段模式)會讓 .panel 套上 panelCollapsed class(見該元件的完整說明)
// ——藉由檢查 data-testid="phone-bottom-sheet" 這個節點的 class 是否包含
// PhoneBottomSheet.module.css 匯出的 panelCollapsed,就能在不量測實際
// px/不模擬拖曳手勢的情況下,間接但準確地驗證目前是否停在最小段。
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { GeoOutlinePhoneInfoSheet } from './GeoOutlinePhoneInfoSheet'
import phoneBottomSheetStyles from '../components/PhoneBottomSheet.module.css'
import type { ClientConfig, GeoAttraction } from '../api'
import type { PlaceInfoContent } from './PlacePanel'

// 2026-10 實測踩過的教訓:render()/rerender() 預設不套用 StrictMode,只會
// 跑一次 render——但正式應用程式(main.tsx)用 <React.StrictMode> 包著
// 掛載,開發模式下 React 會刻意對同一個 fiber 的 render 階段重跑一次,
// 用來抓「render 不是純函式」這類問題。曾經有一版 activeSnapIndex 初始化
// 邏輯在 render 期間寫入 useRef 再比對修正,這個寫法在單次 render 下
// 完全正確、這份測試(當時沒套 StrictMode)全部通過,但在真正套了
// StrictMode 的開發環境下,第二次重跑 render 時 ref 已經被第一次悄悄
// 改過,導致比對邏輯誤判「沒有變化」,把原本該觸發的修正吃掉(使用者
// 實測回報「起始的主題點又變中間段」)——這份測試完全沒抓到,直到使用者
// 在瀏覽器裡實際操作才發現,尤其是下方「同一個掛載中的元件換卡片」這兩個
// 案例,正是最容易踩到這個問題的路徑(attraction prop 在同一個 fiber 上
// 變動,不是重新 mount)。改用 StrictMode 包住 render()/rerender() 後,
// 測試環境的渲染行為才能真正複現 dev 環境,同類「render 期間有副作用、
// 對渲染次數敏感」的 bug 才會在測試階段就曝露。

const fetchGeoPlaceDetailsMock = vi.fn()
const fetchPublicGeoPlaceDetailsMock = vi.fn()

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchGeoPlaceDetails: (...args: unknown[]) => fetchGeoPlaceDetailsMock(...args),
    fetchPublicGeoPlaceDetails: (...args: unknown[]) => fetchPublicGeoPlaceDetailsMock(...args),
  }
})

// PhotoCarousel 依賴 IntersectionObserver(手機版橫滑模式偵測目前捲動到
// 哪一張)與 useIsDesktop 背後的 window.matchMedia——jsdom 都沒有實作,
// 比照 PhotoCarousel.test.tsx 開頭的既有慣例補最小可用假實作,不驗證
// PhotoCarousel 本身的行為(那是它自己測試檔案的職責)。
class FakeIntersectionObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}
vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
// ResizeObserver:附近景點橫滑清單用它偵測容器從不可見變成可見(見
// GeoOutlinePhoneInfoSheet.tsx nearbyListNodeRef 那段 effect 的完整
// 說明),jsdom 同樣沒有實作,補最小可用假實作。
class FakeResizeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver)
window.matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})) as unknown as typeof window.matchMedia

const cfg: ClientConfig = { baseURL: 'http://localhost:8080', token: null }

function themeAttraction(overrides: Partial<GeoAttraction> & { name: string } = { name: '清水寺' }): GeoAttraction {
  return { isTheme: true, lat: 1, lng: 1, ...overrides }
}

function poiContent(overrides: Partial<PlaceInfoContent> = {}): PlaceInfoContent {
  return { name: '奧丹', badges: [], ...overrides }
}

function getPanel() {
  return screen.getByTestId('phone-bottom-sheet')
}

function isCollapsedToMinSnap() {
  return getPanel().className.includes(phoneBottomSheetStyles.panelCollapsed)
}

function renderStrict(ui: React.ReactElement) {
  return render(<StrictMode>{ui}</StrictMode>)
}

beforeEach(() => {
  fetchGeoPlaceDetailsMock.mockReset()
  fetchPublicGeoPlaceDetailsMock.mockReset()
})

describe('GeoOutlinePhoneInfoSheet — activeSnapIndex 初始化(不同路徑進來的段落)', () => {
  it('主題點路徑(attraction 有值,對應點擊主題點/defaultOpenTheme 自動開啟兩種來源)一開啟預設最小段', async () => {
    renderStrict(
      <GeoOutlinePhoneInfoSheet
        content={null}
        attraction={themeAttraction()}
        cfg={cfg}
        onClose={() => {}}
      />,
    )
    await waitFor(() => expect(getPanel()).toBeInTheDocument())
    expect(isCollapsedToMinSnap()).toBe(true)
  })

  it('精選點路徑(content 有值,attraction 為 null)一開啟預設中間段,不是最小段', async () => {
    renderStrict(
      <GeoOutlinePhoneInfoSheet
        content={poiContent()}
        attraction={null}
        cfg={cfg}
        onClose={() => {}}
      />,
    )
    await waitFor(() => expect(getPanel()).toBeInTheDocument())
    expect(isCollapsedToMinSnap()).toBe(false)
  })

  it('同一個掛載中的元件換成另一張主題卡(attraction 名稱變動)時,重新套用最小段,不延續前一張卡片的狀態', async () => {
    const { rerender } = renderStrict(
      <GeoOutlinePhoneInfoSheet
        content={null}
        attraction={themeAttraction({ name: '清水寺' })}
        cfg={cfg}
        onClose={() => {}}
      />,
    )
    await waitFor(() => expect(getPanel()).toBeInTheDocument())
    expect(isCollapsedToMinSnap()).toBe(true)

    rerender(
      <StrictMode>
        <GeoOutlinePhoneInfoSheet
          content={null}
          attraction={themeAttraction({ name: '八坂神社' })}
          cfg={cfg}
          onClose={() => {}}
        />
      </StrictMode>,
    )
    await waitFor(() => expect(isCollapsedToMinSnap()).toBe(true))
  })

  it('同一個掛載中的元件從主題卡換成精選點卡(attraction 變 null、改傳 content)時,改套用中間段', async () => {
    const { rerender } = renderStrict(
      <GeoOutlinePhoneInfoSheet
        content={null}
        attraction={themeAttraction()}
        cfg={cfg}
        onClose={() => {}}
      />,
    )
    await waitFor(() => expect(getPanel()).toBeInTheDocument())
    expect(isCollapsedToMinSnap()).toBe(true)

    rerender(
      <StrictMode>
        <GeoOutlinePhoneInfoSheet
          content={poiContent()}
          attraction={null}
          cfg={cfg}
          onClose={() => {}}
        />
      </StrictMode>,
    )
    await waitFor(() => expect(isCollapsedToMinSnap()).toBe(false))
  })
})
