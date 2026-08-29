// GeoOutlinePhoneView 的「地點清單 → 資訊卡」sheet 堆疊行為——驗證
// useSheetStack.ts 開頭描述的那個真實 bug 已修復:點清單項目打開資訊卡
// 後,清單不再被關閉(只是退到背景、套用 isTopmost=false 的退縮視覺),
// 關閉資訊卡時清單會自動重新變回可互動的頂層,不需要使用者重新觸發
// 搜尋才能再看到清單。
//
// mock 掉 GeoOutlinePanel(理由同 GeoOutlinePhoneView.listDrawer.test.tsx
// ——這個測試不驗證地圖/查詢本身,只驗證清單/資訊卡兩個 sheet 之間的
// 堆疊互動),直接暴露 onSearchResultsChange 讓測試手動觸發清單打開,
// 並用一個假的 GeoSearchResult 觸發 selectSearchResultFromList 開啟
// 資訊卡。
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
let capturedOnSearchResultsChange: ((results: GeoSearchResult[]) => void) | undefined
let capturedOnSearchResultSelect: ((r: GeoSearchResult) => void) | undefined
let capturedSetGeocodeCandidates: ((candidates: GeoGeocodeCandidate[]) => void) | undefined

// geo.searchResults(GeoOutlinePhoneListDrawer 的 results prop 來源)
// 2026-08 起改成從 geo.geocodeCandidates 衍生(見 useGeoPlanningState.ts
// 的說明),不再由 onSearchResultsChange 的參數直接寫入——這裡的 mock
// 因此也要接住 setGeocodeCandidates,測試呼叫端(下方 renderView 後)
// 觸發清單打開時,要同時呼叫這個 setter 才能讓 geo.searchResults 真的
// 有資料,不只是呼叫 onSearchResultsChange(那個 callback 現在只負責
// dispatch 清單開關狀態機,不再是清單資料的來源)。
vi.mock('./GeoOutlinePanel', () => ({
  GeoOutlinePanel: (props: {
    onSearchStart?: () => void
    onSearchResultsChange?: (results: GeoSearchResult[]) => void
    onSearchResultSelect?: (r: GeoSearchResult) => void
    setGeocodeCandidates?: (candidates: GeoGeocodeCandidate[]) => void
  }) => {
    capturedOnSearchStart = props.onSearchStart
    capturedOnSearchResultsChange = props.onSearchResultsChange
    capturedOnSearchResultSelect = props.onSearchResultSelect
    capturedSetGeocodeCandidates = props.setGeocodeCandidates
    return null
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

// fakeResult2:第二筆假結果——geoListDrawerState.ts 2026-08 起新增
// 「resultCount === 1(唯一解)時清單不打開」的規則,這個測試驗證的是
// 清單/資訊卡的堆疊互動,不是唯一解行為,故用兩筆結果讓清單照既有行為
// 打開,避免被唯一解規則擋下。
const fakeResult2: GeoSearchResult = {
  kind: 'geocode',
  placeId: 'place_2',
  name: '測試地點2',
  address: '測試地址2',
  lat: 25.04,
  lng: 121.57,
}

// fakeCandidate/fakeCandidate2:geocodeCandidateToSearchResult 轉換前的
// 原始形狀,對應上面兩筆 fakeResult——geo.searchResults 現在是
// geocodeCandidates 的衍生鏡像(見上方 mock 的說明),測試要讓清單抽屜
// 真的有資料可顯示,得寫入這一份而不是只呼叫 onSearchResultsChange。
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
    // 重現真實呼叫順序,再寫入 geocodeCandidates(清單資料實際來源)與
    // 呼叫 onSearchResultsChange(結束 loading、確認不是唯一解)。
    act(() => {
      capturedOnSearchStart!()
      capturedSetGeocodeCandidates!([fakeCandidate, fakeCandidate2])
      capturedOnSearchResultsChange!([fakeResult, fakeResult2])
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
      capturedSetGeocodeCandidates!([fakeCandidate, fakeCandidate2])
      capturedOnSearchResultsChange!([fakeResult, fakeResult2])
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
