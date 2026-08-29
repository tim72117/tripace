// GeoOutlinePhoneView 的「查詢完成後自動打開地點清單抽屜」這個複合互動
// 行為——mock 掉 GeoOutlinePanel(這個測試不驗證地圖/查詢本身怎麼運作,
// 只驗證 GeoOutlinePhoneView 收到 onSearchResultsChange 回呼後,
// listDrawerOpen 有沒有正確變成 true),讓測試能直接觸發這個 callback、
// 不需要 render 真正的地圖(GeoOutlineMap 依賴 @googlemaps/js-api-loader、
// 建圖流程複雜,見 GeoOutlineMap.poiClick.test.tsx 的既有先例)。
//
// 背景:2026-08 三個地點搜尋入口(城市搜尋框/類別標籤/搜尋這個區域按鈕)
// 統一改走 fetchGeoGeocode 後,類別標籤/搜尋這個區域改成直接呼叫
// GeoOutlineMap 內部的 runPlacesQuery,不再經過 GeoOutlinePanel 的
// onSearch prop——而「查詢觸發時開啟清單抽屜並顯示載入中」這個副作用
// 原本寫在 onSearch 裡(見 GeoOutlinePhoneView.tsx 的說明),繞開
// onSearch 的入口因此連帶漏掉了「打開清單」這個隱藏副作用,使用者實測
// 回報「點類別標籤查到地點後,清單沒有自動打開」。
//
// 這個測試涵蓋兩種觸發來源(城市搜尋框走的 onSearch、類別標籤/搜尋這個
// 區域走的 onSearchResultsChange 單獨觸發,不經過 onSearch),確保清單
// 打開這個行為不再只綁在某一個特定入口上——修復後的正確設計應該是
// 「查詢結果回來就打開清單」,不管查詢是哪個入口觸發的。
//
// 開關狀態的斷言錨點:components/PhoneBottomSheet.tsx 的 panel div 有
// 固定的 data-testid="phone-bottom-sheet",且 shouldRender 為 false 時
// 整個元件不渲染(見該檔案的說明)——這個 testid 存在與否直接等同於
// open 狀態,不需要猜呼叫端的文案內容(標題之類的字串日後可能會改)。
import { describe, it, expect, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { GeoOutlinePhoneView } from './GeoOutlinePhoneView'
import type { ClientConfig, GeoSearchResult } from '../api'
import type { User } from '../user/types'

let capturedOnSearch: (() => void) | undefined
let capturedOnSearchStart: (() => void) | undefined
let capturedOnSearchResultsChange: ((results: GeoSearchResult[]) => void) | undefined

vi.mock('./GeoOutlinePanel', () => ({
  GeoOutlinePanel: (props: {
    onSearch?: () => void
    onSearchStart?: () => void
    onSearchResultsChange?: (results: GeoSearchResult[]) => void
  }) => {
    capturedOnSearch = props.onSearch
    capturedOnSearchStart = props.onSearchStart
    capturedOnSearchResultsChange = props.onSearchResultsChange
    return null
  },
}))

// GeoOutlinePhoneInfoSheet/GeoOutlinePhoneCandidateDrawer/
// GeoOutlinePhoneListDrawer:不 mock——這三個都是純 UI 元件,不涉及地圖
// 建立或真實網路請求,直接渲染即可驗證 listDrawerOpen 反映在
// GeoOutlinePhoneListDrawer 的 open prop 上(透過 data-testid 錨點觀察)。

const cfg: ClientConfig = { baseURL: 'http://localhost', token: 'test-token' }
const user: User = { id: 'usr_1', name: '測試使用者', avatarColor: '#000' }

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

function isListDrawerOpen(container: HTMLElement) {
  return container.querySelector('[data-testid="phone-bottom-sheet"]') !== null
}

describe('GeoOutlinePhoneView：查詢完成後自動打開地點清單抽屜', () => {
  it('城市搜尋框觸發的 onSearch，查詢結果回來後清單應該打開', () => {
    const { container } = renderView()
    expect(capturedOnSearch).toBeTypeOf('function')
    expect(capturedOnSearchResultsChange).toBeTypeOf('function')

    expect(isListDrawerOpen(container)).toBe(false)

    // 模擬使用者在城市搜尋框按下 Enter/送出——onSearch 觸發查詢。
    act(() => capturedOnSearch!())
    // 模擬查詢結果回來——這是「打開清單」這個副作用真正應該發生的時刻。
    act(() => capturedOnSearchResultsChange!([]))

    expect(isListDrawerOpen(container)).toBe(true)
  })

  it('類別標籤/搜尋這個區域按鈕不經過 onSearch，只呼叫 onSearchStart+onSearchResultsChange 時，清單也應該打開', () => {
    const { container } = renderView()
    expect(capturedOnSearchStart).toBeTypeOf('function')
    expect(capturedOnSearchResultsChange).toBeTypeOf('function')

    expect(isListDrawerOpen(container)).toBe(false)

    // 不呼叫 capturedOnSearch()——比照類別標籤/搜尋這個區域按鈕現在的
    // 實際呼叫路徑(GeoOutlineMap 內部的 runPlacesQuery 觸發時呼叫
    // onSearchStart,不經過 GeoOutlinePanel 的 onSearch prop)。2026-08
    // 這次 sheetStack 重構後,「查詢開始」這個時機本身(不是查詢結果回來)
    // 才是清單被 push 進堆疊的時刻(見 GeoOutlinePhoneView.tsx 的
    // onSearchStart 說明)——故這裡要先呼叫 onSearchStart,才能重現
    // 真實的呼叫順序。
    act(() => capturedOnSearchStart!())
    act(() => capturedOnSearchResultsChange!([]))

    expect(isListDrawerOpen(container)).toBe(true)
  })

  it('查詢結果回來後，清單抽屜同時應該結束載入中狀態', () => {
    const { queryByLabelText } = renderView()

    act(() => capturedOnSearchResultsChange!([]))

    // loading 狀態結束的既有行為（onSearchResultsChange 回來就
    // setListSearchLoading(false)）不受這次修復影響，確認沒有連帶壞掉。
    expect(queryByLabelText('載入中')).toBeNull()
  })
})
