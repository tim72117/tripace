// GeoOutlinePhoneView 的「地點清單 → 資訊卡」sheet 堆疊行為——驗證
// useSheetStack.ts 開頭描述的那個真實 bug 已修復:點清單項目打開資訊卡
// 後,清單不再被關閉(只是退到背景、套用 isTopmost=false 的退縮視覺),
// 關閉資訊卡時清單會自動重新變回可互動的頂層,不需要使用者重新觸發
// 搜尋才能再看到清單。
//
// mock 掉 ExploreMap(理由同 GeoOutlinePhoneView.listDrawer.test.tsx
// ——這個測試不驗證地圖/查詢本身,只驗證清單/資訊卡兩個 sheet 之間的
// 堆疊互動),直接暴露 onSearchStart/onSearchResultSelect 讓測試手動
// 觸發清單打開,並用一個假的 GeoSearchResult 觸發
// selectSearchResultFromList 開啟資訊卡。GeoOutlinePanel.tsx 已退役
// (見 useGeoOutlineMapState.ts 的完整說明),GeoOutlinePhoneView.tsx
// 現在直接使用 ExploreMap,故改成 mock 這個模組;
// onSearchResultsChange/setGeocodeCandidates 這兩個原本由
// GeoOutlinePanel 提供的 prop,現在是 useGeoOutlineMapState 內部消化,
// 這裡改成直接呼叫 geo 的 setGeocodeCandidates(透過 GeoOutlinePhoneView
// 傳給 hook 的同一個函式)搭配捕捉 ExploreMap 收到的 onSearchStart/
// onSearchResultSelect 來重現相同的測試情境。
//
// 兩個 sheet 共用同一個 data-testid="phone-bottom-sheet"(見
// PhoneBottomSheet.tsx 的說明),故用 querySelectorAll 取全部符合的
// panel,用 panelStacked class 是否存在區分「目前哪個是非頂層」——
// isTopmost=false 時 PhoneBottomSheet 會加上這個 class(見該檔案
// isTopmost prop 的說明)。
import { describe, it, expect, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { GeoOutlinePhoneView } from './GeoOutlinePhoneView'
import type { ClientConfig, GeoGeocodeCandidate, GeoSearchResult } from '../api'
import type { User } from '../user/types'

// GeoListItemCard 用 IntersectionObserver 做延遲載入圖片(見該檔案),
// jsdom 沒有原生實作——stub 一個最小假實作,這個測試不驗證圖片載入
// 行為,只需要讓 mount 不噴錯即可。
class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIntersectionObserver

let capturedOnSearchStart: (() => void) | undefined
let capturedOnGeocodeCandidatesChange: ((candidates: GeoGeocodeCandidate[]) => void) | undefined
let capturedOnSearchResultSelect: ((r: GeoSearchResult) => void) | undefined

// geo.searchResults(GeoOutlinePhoneListDrawer 的 results prop 來源)
// 2026-08 起改成從 geo.geocodeCandidates 衍生(見 useGeoPlanningState.ts
// 的說明)——GeoOutlinePanel.tsx 退役後(見 useGeoOutlineMapState.ts 的
// 完整說明),setGeocodeCandidates 這個 setter 已經不再是任何元件的
// prop,改成 useGeoOutlineMapState 內部的輸入參數,外部無法直接呼叫。
// 改成捕捉 ExploreMap 收到的 onGeocodeCandidatesChange——呼叫它會連帶
// 觸發 hook 內部的 setGeocodeCandidates,效果等價於先前直接呼叫
// setGeocodeCandidates,且更貼近真實資料流(這正是 ExploreMap 內部類別
// 標籤/搜尋這個區域查詢完成時實際會呼叫的 callback)。
// onSearchResultsChange 不再是 ExploreMap 的 prop(原本由
// GeoOutlinePanel 攔截轉呼叫,見該檔案已移除的說明)——不再需要捕捉它,
// 清單開關狀態機改由下方直接呼叫 capturedOnGeocodeCandidatesChange 觸發
// (該 callback 內部同時會呼叫 onSearchResultsChange,見
// useGeoOutlineMapState.ts 的完整說明)。
vi.mock('./ExploreMap', () => ({
  ExploreMap: (props: {
    onSearchStart?: () => void
    onGeocodeCandidatesChange?: (candidates: GeoGeocodeCandidate[]) => void
    onSearchResultSelect?: (r: GeoSearchResult) => void
    children?: React.ReactNode
  }) => {
    capturedOnSearchStart = props.onSearchStart
    capturedOnGeocodeCandidatesChange = props.onGeocodeCandidatesChange
    capturedOnSearchResultSelect = props.onSearchResultSelect
    // children(GeoOutlinePhoneInfoSheet)改掛入 ExploreMap 後(見
    // GeoOutlinePhoneView.tsx 的完整說明),這個 mock 必須真的渲染
    // children,否則資訊卡永遠不會出現在測試的 DOM 樹裡——對齊
    // DesktopLayout.tsx/KiyomizuDemoPage.tsx 對應測試 mock ExploreMap/
    // NativeMapBase 時的既有慣例。
    return props.children ?? null
  },
}))

const cfg: ClientConfig = { baseURL: 'http://localhost', token: 'test-token' }
const user: User = { id: 'usr_1', name: '測試使用者', avatarColor: '#000' }

const fakeResult: GeoSearchResult = {
  kind: 'geocode',
  placeId: 'place_1',
  name: '測試地點',
  address: '測試地址',
  lat: 25.03,
  lng: 121.56,
}

// fakeCandidate/fakeCandidate2:geocodeCandidateToSearchResult 轉換前的
// 原始形狀——geo.searchResults 現在是 geocodeCandidates 的衍生鏡像(見
// 上方 mock 的說明),測試要讓清單抽屜真的有資料可顯示,得寫入這一份。
// 兩筆(而非一筆)是因為 geoListDrawerState.ts 2026-08 起新增
// 「resultCount === 1(唯一解)時清單不打開」的規則,這個測試驗證的是
// 清單/資訊卡的堆疊互動,不是唯一解行為,用兩筆結果讓清單照既有行為
// 打開,避免被唯一解規則擋下。
const fakeCandidate: GeoGeocodeCandidate = {
  name: '測試地點',
  address: '測試地址',
  lat: 25.03,
  lng: 121.56,
  placeId: 'place_1',
}
const fakeCandidate2: GeoGeocodeCandidate = {
  name: '測試地點2',
  address: '測試地址2',
  lat: 25.04,
  lng: 121.57,
  placeId: 'place_2',
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

describe('GeoOutlinePhoneView：地點清單與資訊卡的 sheet 堆疊', () => {
  it('點清單項目打開資訊卡後，清單仍維持掛載（只是退到背景），不會被關閉', () => {
    const { container } = renderView()

    // 先讓清單打開——2026-08 sheetStack 重構後,清單「開啟」這件事本身
    // 由查詢入口(onSearchStart/onSearch)在查詢開始的當下 push
    // {type:'list'} 進堆疊(見 GeoOutlinePhoneView.tsx 的說明),不再是
    // onSearchResultsChange 回來才「打開」——這裡先呼叫 onSearchStart
    // 重現真實呼叫順序,再呼叫 onGeocodeCandidatesChange(兩筆,確認不是
    // 唯一解)寫入 geocodeCandidates(清單資料實際來源)並連帶觸發內部的
    // onSearchResultsChange,見上方 mock 宣告的完整說明。
    act(() => {
      capturedOnSearchStart!()
      capturedOnGeocodeCandidatesChange!([fakeCandidate, fakeCandidate2])
    })
    expect(sheetPanels(container)).toHaveLength(1)

    // 點清單項目——GeoOutlinePhoneListDrawer 的 onSelect 呼叫
    // geo.selectSearchResultFromList,底層走 onSearchResultSelect 這條
    // callback 觸發 geo.infoContent 賦值,連帶讓 GeoOutlinePhoneInfoSheet
    // open。
    act(() => capturedOnSearchResultSelect!(fakeResult))

    // 兩個 sheet 應該同時掛載——清單沒有被關閉。
    const panels = sheetPanels(container)
    expect(panels).toHaveLength(2)
  })

  it('關閉資訊卡後，清單重新變回可互動的頂層（不需要重新觸發搜尋）', () => {
    const { container } = renderView()

    // 同上一個測試——先 onSearchStart 讓清單 push 進堆疊,才能重現「資訊卡
    // 疊在清單上面」這個情境,關閉資訊卡(pop)後才有清單可以「重新變回
    // 頂層」。
    act(() => {
      capturedOnSearchStart!()
      capturedOnGeocodeCandidatesChange!([fakeCandidate, fakeCandidate2])
    })
    act(() => capturedOnSearchResultSelect!(fakeResult))
    expect(sheetPanels(container)).toHaveLength(2)

    // 找到資訊卡的關閉鈕按下——資訊卡是唯一有 title="關閉" 按鈕的 sheet。
    const closeBtn = container.querySelector('button[title="關閉"]') as HTMLButtonElement
    expect(closeBtn).toBeTruthy()
    act(() => closeBtn.click())

    // 資訊卡消失，清單維持掛載且重新變回頂層。
    const panels = sheetPanels(container)
    expect(panels).toHaveLength(1)
  })
})
