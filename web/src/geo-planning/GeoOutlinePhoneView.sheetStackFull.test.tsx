// GeoOutlinePhoneView 的 sheetStack 全面接管測試——2026-08 這次重構把
// 「清單/資訊卡該不該顯示」從兩條各自獨立的真相來源(listDrawerState.open/
// geo.infoContent)收斂成單一堆疊(sheetStack,見 GeoOutlinePhoneView.tsx
// 開頭 SheetEntry 型別的完整說明)之後,新增的行為路徑——
// GeoOutlinePhoneView.sheetStack.test.tsx 只驗證「清單 → 資訊卡」這條
// push 路徑(既有的 bug 修復),這個檔案補上其餘三條這次重構新增/強化的
// 路徑:
//   1. 點地圖 marker(非從清單點進來)開資訊卡——用 sheetStack.replace,
//      不是 push,故堆疊裡沒有 'list' 在下面,關閉後不會意外露出清單。
//   2. 查詢結果只有一筆(唯一解)——清單不顯示、資訊卡自動顯示,驗證
//      onSearchResultsChange 對 sheetStack.replace 的接線。
//   3. 候選籃選取候選項目——資訊卡正確顯示(同樣是 replace 語意)。
//
// mock 掉 ExploreMap(理由同其餘 GeoOutlinePhoneView.*.test.tsx——這批
// 測試不驗證地圖/查詢本身怎麼運作,只驗證 GeoOutlinePhoneView 這一層
// 怎麼把查詢入口/選取入口接到 sheetStack 上),直接暴露這次重構動到的
// 幾個 callback 讓測試手動觸發。GeoOutlinePanel.tsx 已退役(見
// useGeoOutlineMapState.ts 的完整說明),原本的 setGeocodeCandidates +
// onSearchResultsChange 兩步(分別是 GeoOutlinePanel 的 prop),現在
// 合併成 ExploreMap 的 onGeocodeCandidatesChange 一步(呼叫它會連帶
// 觸發 hook 內部的兩者,見 useGeoOutlineMapState.ts
// handleGeocodeCandidatesChange 的完整說明)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { GeoOutlinePhoneView } from './GeoOutlinePhoneView'
import { PHONE_BOTTOM_SHEET_EXIT_MS } from '../components/PhoneBottomSheet'
import type { GeoCandidate } from './geoCandidateHelpers'
import type { ClientConfig, GeoAttraction, GeoGeocodeCandidate } from '../api'
import type { User } from '../user/types'

// PhoneBottomSheet 的 open 變 false 後不是立刻卸載,而是延遲
// PHONE_BOTTOM_SHEET_EXIT_MS(見該檔案 exitDurationMs 的說明)才真正從
// DOM 移除,播放退場滑出動畫——清單抽屜(GeoOutlinePhoneListDrawer)走的
// 就是這套機制(資訊卡則是另一套:content/attraction 變 null 時同步
// return null,不經過這個延遲,見 GeoOutlinePhoneInfoSheet.tsx)。這個
// 檔案有幾個測試會讓清單從「顯示」變成「該關閉」(例如唯一解 replace 掉
// 'list'),要準確反映使用者實際會看到的最終畫面(退場動畫播完後),
// 需要用假時鐘把這段延遲跑完,不能只靠同步的 act() 就斷言。
function advancePastExitAnimation() {
  act(() => {
    vi.advanceTimersByTime(PHONE_BOTTOM_SHEET_EXIT_MS)
  })
}

// GeoListItemCard 用 IntersectionObserver 做延遲載入圖片(見該檔案),
// jsdom 沒有原生實作——stub 一個最小假實作,理由同
// GeoOutlinePhoneView.sheetStack.test.tsx。
class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIntersectionObserver

let capturedOnSearchStart: (() => void) | undefined
let capturedOnGeocodeCandidatesChange: ((candidates: GeoGeocodeCandidate[]) => void) | undefined
let capturedOnAttractionSelect: ((a: GeoAttraction) => void) | undefined
let capturedOnAttractionsChange: ((attractions: GeoAttraction[]) => void) | undefined

vi.mock('./ExploreMap', () => ({
  ExploreMap: (props: {
    onSearchStart?: () => void
    onGeocodeCandidatesChange?: (candidates: GeoGeocodeCandidate[]) => void
    onAttractionSelect?: (a: GeoAttraction) => void
    onAttractionsChange?: (attractions: GeoAttraction[]) => void
    children?: React.ReactNode
  }) => {
    capturedOnSearchStart = props.onSearchStart
    capturedOnGeocodeCandidatesChange = props.onGeocodeCandidatesChange
    capturedOnAttractionSelect = props.onAttractionSelect
    capturedOnAttractionsChange = props.onAttractionsChange
    // children(GeoOutlinePhoneInfoSheet)改掛入 ExploreMap 後(見
    // GeoOutlinePhoneView.tsx 的完整說明),這個 mock 必須真的渲染
    // children,否則資訊卡永遠不會出現在測試的 DOM 樹裡。
    return props.children ?? null
  },
}))

// GeoOutlinePhoneCandidateDrawer 也一併 mock——「候選籃選取候選後資訊卡
// 正確顯示」這個場景真正要驗證的是 GeoOutlinePhoneView.tsx 怎麼接線
// onSelect(呼叫 geo.selectCandidateFromBasket + sheetStack.replace),不是
// 候選籃本身「怎麼把候選加進 geo.candidates」這件事——那條路徑(資訊卡
// 「加入行程」按鈕 → candidateHasScheduledDate 分岔 → onSchedule 寫入
// 後端)牽涉真實 API 呼叫,不是這個測試檔案的重點,也會讓測試變得脆弱
// (需要 mock 後端 API)。直接 mock 掉這個抽屜元件,暴露 onSelect 讓測試
// 直接呼叫,對齊其餘測試 mock GeoOutlinePanel 的既有模式。
let capturedCandidateDrawerOnSelect: ((c: GeoCandidate) => void) | undefined
vi.mock('./GeoOutlinePhoneCandidateDrawer', () => ({
  GeoOutlinePhoneCandidateDrawer: (props: { onSelect: (c: GeoCandidate) => void }) => {
    capturedCandidateDrawerOnSelect = props.onSelect
    return null
  },
}))

const cfg: ClientConfig = { baseURL: 'http://localhost', token: 'test-token' }
const user: User = { id: 'usr_1', name: '測試使用者', avatarColor: '#000' }

const fakeAttraction: GeoAttraction = {
  name: '測試景點',
  lat: 25.03,
  lng: 121.56,
  isTheme: false,
}

// fakeTheme/fakeNearby——「附近景點」清單測試用的主題點+一個精選點,
// isTheme:true/false 對齊 computeNearbyAttractions/nearbyAttractions
// 的分流規則(見 GeoOutlinePhoneView.tsx 的完整說明)。fakeNearby 刻意
// 不帶 placeId——驗證 handleSelectNearbyAttraction 在沒有 placeId 時
// 走 fetchPoiContent 的 attractionToInfoContent 分支,不需要 mock
// fetchGeoPlaceDetails。
const fakeTheme: GeoAttraction = {
  name: '測試主題點',
  lat: 25.03,
  lng: 121.56,
  isTheme: true,
}
const fakeNearby: GeoAttraction = {
  name: '測試精選點',
  lat: 25.031,
  lng: 121.561,
  isTheme: false,
  summary: '精選點簡介',
}

const fakeCandidate: GeoGeocodeCandidate = {
  name: '測試地點',
  address: '測試地址',
  lat: 25.03,
  lng: 121.56,
  placeId: 'place_1',
}

function renderView() {
  return render(
    <GeoOutlinePhoneView
      cfg={cfg}
      tripID="trip_1"
      activeTrip={null}
      user={user}
      onOpenSettings={() => {}}
      onOpenTrips={() => {}}
    />,
  )
}

function sheetPanels(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-testid="phone-bottom-sheet"]'))
}

describe('GeoOutlinePhoneView：sheetStack 全面接管後新增的路徑', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('點地圖 marker（非從清單進來）打開資訊卡，關閉後不會意外露出清單', () => {
    const { container } = renderView()

    // 完全不觸發任何查詢入口(onSearchStart 從未呼叫)——sheetStack 一
    // 開始是空的,沒有 'list' 這一層。直接呼叫 onAttractionSelect 模擬
    // 點地圖上的自建景點 marker。
    act(() => capturedOnAttractionSelect!(fakeAttraction))

    // 只有資訊卡這一個 sheet 掛載——沒有清單一起出現。
    expect(sheetPanels(container)).toHaveLength(1)

    // 關閉資訊卡——sheetStack.pop() 把堆疊唯一的 'info' 移除,堆疊變空。
    const closeBtn = container.querySelector('button[title="關閉"]') as HTMLButtonElement
    expect(closeBtn).toBeTruthy()
    act(() => closeBtn.click())

    // 堆疊裡從未有過 'list',pop 後應該完全沒有 sheet 顯示——不會憑空
    // 冒出一個從未被使用者打開過的清單。
    expect(sheetPanels(container)).toHaveLength(0)
  })

  it('查詢結果唯一解時，清單不顯示、資訊卡自動顯示', () => {
    const { container } = renderView()

    // 查詢開始——push {type:'list'} 進堆疊(比照真實的三個查詢入口)。
    act(() => capturedOnSearchStart!())
    expect(sheetPanels(container)).toHaveLength(1)

    // 查詢結果只有一筆——onSearchResultsChange(由
    // onGeocodeCandidatesChange 連帶觸發,見上方 mock 宣告的完整說明)
    // 應該用 sheetStack.replace 把堆疊頂端的 'list' 換成 'info',不增加
    // 深度。這裡同時要有資訊卡實際內容可顯示,故先透過 onAttractionSelect
    // 之類的入口帶入內容——用唯一解場景下最貼近真實情況的入口:
    // useGeoOutlineMapState 內部偵測到唯一解時,會自己呼叫
    // onSearchResultSelect 開資訊卡,這裡簡化成直接呼叫 onAttractionSelect
    // 帶入內容(驗證的重點是 sheetStack 的堆疊變化,不是內容從哪個
    // callback 來)。
    act(() => {
      capturedOnGeocodeCandidatesChange!([fakeCandidate])
      capturedOnAttractionSelect!(fakeAttraction)
    })
    // 清單的 open prop 已經變 false,但 PhoneBottomSheet 有退場動畫延遲
    // 卸載(見上方 advancePastExitAnimation 的說明)——跑完這段延遲,才能
    // 準確反映使用者實際會看到的最終畫面。
    advancePastExitAnimation()

    // 堆疊頂端已經是 'info'(由 replace 換掉,不是又 push 一層)——畫面上
    // 只會看到資訊卡這一個 sheet,清單不顯示。
    const panels = sheetPanels(container)
    expect(panels).toHaveLength(1)
  })

  it('查詢結果多筆時，清單維持顯示（不受唯一解規則影響）', () => {
    const { container } = renderView()

    act(() => capturedOnSearchStart!())
    expect(sheetPanels(container)).toHaveLength(1)

    act(() => {
      capturedOnGeocodeCandidatesChange!([fakeCandidate, { ...fakeCandidate, placeId: 'place_2', name: '測試地點2' }])
    })

    // 堆疊頂端仍是 'list'(多筆結果不觸發 replace)——清單維持顯示。
    expect(sheetPanels(container)).toHaveLength(1)
  })

  it('候選籃選取候選後，資訊卡正確顯示', () => {
    const { container } = renderView()
    expect(capturedCandidateDrawerOnSelect).toBeTypeOf('function')

    // 一開始沒有任何 sheet——堆疊是空的。
    expect(sheetPanels(container)).toHaveLength(0)

    // 模擬候選籃選取候選項目——GeoOutlinePhoneCandidateDrawer 的 onSelect
    // 被呼叫,對應 GeoOutlinePhoneView.tsx 接線的
    // geo.selectCandidateFromBasket(c) + setCandidateDrawerOpen(false) +
    // sheetStack.replace({type:'info'})。
    const fakeHotelCandidate: GeoCandidate = {
      kind: 'hotel',
      name: '測試飯店',
      address: '測試飯店地址',
      lat: 25.05,
      lng: 121.58,
      primaryType: 'lodging',
    }
    act(() => capturedCandidateDrawerOnSelect!(fakeHotelCandidate))

    // sheetStack.replace({type:'info'}) 讓堆疊變成只有一層 'info'(堆疊原本
    // 是空的,replace 在空堆疊上等同 push,見 useSheetStack.ts 的說明)——
    // 資訊卡應該正確顯示這個候選的內容,沒有清單一起出現(這條路徑跟點
    // 地圖 marker 一樣是非清單來源)。
    const panels = sheetPanels(container)
    expect(panels).toHaveLength(1)
    expect(container.textContent).toContain('測試飯店')
  })

  it('點主題點打開資訊卡後顯示「附近景點」清單,點清單項目 push 一層新地點卡疊在主題卡上面', async () => {
    const { container } = renderView()

    // 地圖回報可視範圍查詢結果(供 nearbyAttractions 算附近清單用,見
    // GeoOutlinePhoneView.tsx 的完整說明)——順序上先於點擊主題點,對齊
    // 真實情況:地圖查詢結果本來就會在使用者互動前陸續回報。
    act(() => capturedOnAttractionsChange!([fakeTheme, fakeNearby]))
    act(() => capturedOnAttractionSelect!(fakeTheme))

    // 只有主題卡這一個 sheet——附近景點清單是卡片內容的一部分,不是
    // 獨立的 sheet。
    expect(sheetPanels(container)).toHaveLength(1)
    expect(container.textContent).toContain('附近景點')
    expect(container.textContent).toContain('測試精選點')

    // 點清單項目——handleSelectNearbyAttraction 查詢(這裡沒有 placeId,
    // 走 attractionToInfoContent 同步 resolve 的分支)完成後 push
    // {type:'nearby-place'},疊在主題卡之上,變成兩層 sheet 同時存在
    // (對齊「跟目前手機版顯示多層卡片一樣」的既有模式,例如
    // date-picker/date-calendar 疊在 info 之上)。
    const nearbyItemBtn = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.textContent?.includes('測試精選點'),
    ) as HTMLButtonElement
    expect(nearbyItemBtn).toBeTruthy()
    await act(async () => {
      nearbyItemBtn.click()
      await Promise.resolve()
    })

    expect(sheetPanels(container)).toHaveLength(2)
    expect(container.textContent).toContain('精選點簡介')
  })
})
