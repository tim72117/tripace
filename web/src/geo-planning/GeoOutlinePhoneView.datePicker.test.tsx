// GeoOutlinePhoneView 的「加入行程」日期選擇流程——2026-08 把原本內嵌在
// GeoOutlinePhoneInfoSheet.tsx `.dateEdit` 區塊裡的日期選擇 UI,拆成兩層
// 獨立的 bottom sheet(GeoOutlinePhoneDatePickerSheet/
// GeoOutlinePhoneDateCalendarSheet,由 sheetStack 管理,見
// GeoOutlinePhoneView.tsx 開頭 SheetEntry 型別的完整說明)之後新增的行為
// 路徑:
//   1. 候選沒有排定日期、行程本身也沒有排定日期(scheduledDates 為空)——
//      「加入行程」直接開日曆 sheet,跳過日期清單 sheet。
//   2. 候選沒有排定日期、行程已有排定日期——先開日期清單 sheet;點某個
//      日期項目後兩層 sheet 都關閉、回到資訊卡。
//   3. 日期清單 sheet 點「其他日期」,日曆 sheet 疊上來(兩層同時存在);
//      日曆 sheet 選定日期後兩層都關閉。
//   4. 加入成功後打勾提示(Check icon)不論走哪條路徑都正常運作。
//
// mock 掉 ExploreMap(理由同其餘 GeoOutlinePhoneView.*.test.tsx——這批
// 測試不驗證地圖/查詢本身怎麼運作),直接暴露 onSearchResultSelect 讓
// 測試手動選中一個候選。GeoOutlinePanel.tsx 已退役(見
// useGeoOutlineMapState.ts 的完整說明),onSearchResultSelect 現在是
// ExploreMap 的直接 prop(接的是 outlineMapState.onSearchResultSelect,
// 即 hook 內部的 handleGeocodeCandidateSelect)——但 onTripEntriesChange
// 不再流向 ExploreMap,它是 useGeoOutlineMapState 的輸入參數,在 hook
// 內部的 useEffect 裡被呼叫(查 tripID 對應的 entries 時,見該檔案的
// 完整說明),故無法再用同一招從 ExploreMap 的 props 攔截。改成 mock
// fetchEntries(這個 hook 真正發出查詢的 API 函式),讓它回傳假資料,
// 驅動真實的「查詢完成 → onTripEntriesChange → geo 寫入 candidates」
// 完整鏈路,而不是繞過 hook 直接呼叫 callback——這樣才能讓
// geo.scheduledDates(這批測試要操控的目標)反映測試想要的既有排定
// 日期。同時 mock ../api 的 recordEntry/setEntryLatLng
// (createEntryFromCandidate 底層呼叫的兩支 API),讓
// geo.handleScheduleCandidate 這條 async 寫入路徑不需要真的打後端。
//
// 日曆 sheet 改用 DatePickerPopover(react-day-picker 月曆格線 UI,對齊
// 桌面版 PlacePanel.tsx 的既有升級,見該檔案 PlacePanel.test.tsx 的
// pickCalendarDate 輔助函式)——沿用同一套「用 aria-label 定位日期格子」
// 的既有測試手法,不是原生 <input type="date">。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GeoOutlinePhoneView } from './GeoOutlinePhoneView'
import type { ClientConfig, GeoSearchResult } from '../api'
import type { User } from '../user/types'

const recordEntryMock = vi.fn(() => Promise.resolve({ entryID: 'entry_new' }))
const setEntryLatLngMock = vi.fn(() => Promise.resolve())
const fetchEntriesMock = vi.fn((): Promise<Awaited<ReturnType<typeof import('../api').fetchEntries>>> => Promise.resolve([]))

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    recordEntry: (...args: unknown[]) => recordEntryMock(...(args as [])),
    setEntryLatLng: (...args: unknown[]) => setEntryLatLngMock(...(args as [])),
    fetchEntries: (...args: unknown[]) => fetchEntriesMock(...(args as [])),
  }
})

let capturedOnSearchResultSelect: ((r: GeoSearchResult) => void) | undefined

vi.mock('./ExploreMap', () => ({
  ExploreMap: (props: {
    onSearchResultSelect?: (r: GeoSearchResult) => void
    children?: React.ReactNode
  }) => {
    capturedOnSearchResultSelect = props.onSearchResultSelect
    // children(GeoOutlinePhoneInfoSheet)改掛入 ExploreMap 後(見
    // GeoOutlinePhoneView.tsx 的完整說明),這個 mock 必須真的渲染
    // children,否則資訊卡永遠不會出現在測試的 DOM 樹裡。
    return props.children ?? null
  },
}))

const cfg: ClientConfig = { baseURL: 'http://localhost', token: 'test-token' }
const user: User = { id: 'usr_1', name: '測試使用者', avatarColor: '#000' }

// fakeResult:kind 用 'place'(而非 'geocode')——見 geoInfoContent.ts
// 的 searchResultInfoContent 說明,geocode 類型純定位用途,不會帶
// candidate 欄位(不能加入候選籃),資訊卡因此不會顯示「加入行程」按鈕。
// 這批測試要驗證的正是「加入行程」按鈕按下後的行為,必須用 place/hotel
// 其中一種才會有 candidate。
const fakeResult: GeoSearchResult = {
  kind: 'place',
  placeId: 'place_1',
  name: '測試地點',
  address: '測試地址',
  lat: 25.03,
  lng: 121.56,
  category: 'tourist_attraction',
}

function renderView() {
  return render(
    <GeoOutlinePhoneView
      cfg={cfg}
      tripID="trip_1"
      activeTrip={{ id: 'trip_1', name: '測試旅程' } as never}
      user={user}
      onOpenSettings={() => {}}
      onOpenTrips={() => {}}
    />,
  )
}

function sheetPanels(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-testid="phone-bottom-sheet"]'))
}

// openInfoSheet:透過 onSearchResultSelect 選中一個候選(GeoSearchResult
// 轉成的候選天生沒有排定日期,見 geoCandidateHelpers.ts 的
// candidateHasScheduledDate 說明——kind !== 'entry' 一律視為沒有日期),
// 讓資訊卡開啟並顯示「加入行程」按鈕。
function openInfoSheet(container: HTMLElement) {
  act(() => capturedOnSearchResultSelect!(fakeResult))
  expect(sheetPanels(container)).toHaveLength(1)
}

// pickCalendarDate:比照 PlacePanel.test.tsx 的既有輔助函式——
// react-day-picker 的日期格子沒有穩定的 test id,只有 aria-label(格式
// 「YYYY年M月D日 星期X」,若該格剛好是「今天」還會多出「今天,」前綴,
// 見下方 pickThisMonthDay 特意避開今天的說明)可以精確定位,只在同一個
// 月份內選日期,不處理跨月換頁。這裡不用 `^` 錨定開頭(PlacePanel.test.tsx
// 原本的寫法),改用不錨定的子字串比對,對「今天」那格的「今天,」前綴
// 更寬容,不影響其餘日期格的精確比對(月份/日期組合在同一個月內不會
// 重複)。
async function pickCalendarDate(u: ReturnType<typeof userEvent.setup>, year: number, month: number, day: number) {
  const label = new RegExp(`${year}年${month}月${day}日`)
  await u.click(screen.getByRole('button', { name: label }))
}

// pickThisMonthDay:選一個保證不是「今天」的日子讓 pickCalendarDate 使用
// ——react-day-picker 會在「今天」那一格的 aria-label 多加「今天,」前綴
// (見上方 pickCalendarDate 的說明),為了不讓測試依賴執行當下的日期是
// 幾號而出現不穩定的字串比對結果,固定選當月 1 號(若今天剛好是 1 號,
// 則退而求其次選 2 號,避免月初執行測試時剛好選到「今天」)。
function pickThisMonthDay(): { year: number; month: number; day: number } {
  const now = new Date()
  const day = now.getDate() === 1 ? 2 : 1
  return { year: now.getFullYear(), month: now.getMonth() + 1, day }
}

describe('GeoOutlinePhoneView：加入行程的日期選擇 sheet 流程', () => {
  beforeEach(() => {
    recordEntryMock.mockClear()
    setEntryLatLngMock.mockClear()
  })

  it('候選沒有排定日期、行程本身也沒有排定日期時，點「加入行程」直接開日曆 sheet（跳過日期清單 sheet）', async () => {
    const u = userEvent.setup()
    const { container } = renderView()
    openInfoSheet(container)

    await u.click(screen.getByRole('button', { name: '加入行程' }))

    // 資訊卡 + 日曆 sheet 共兩層,沒有日期清單 sheet(scheduledDates 為空
    // ——這個測試沒有觸發任何「已排入行程」的 entry,geo.scheduledDates
    // 天生是空陣列)。用月曆格線(react-day-picker 的 grid role)確認真的
    // 是日曆 sheet,而不是日期清單 sheet(沒有「其他日期」按鈕)。
    expect(sheetPanels(container)).toHaveLength(2)
    expect(screen.getByRole('grid')).not.toBeNull()
    expect(screen.queryByRole('button', { name: '其他日期' })).toBeNull()
  })

  it('日曆 sheet 點選日期格子後，兩層 sheet 都關閉、回到資訊卡，且打勾提示正常運作', async () => {
    const u = userEvent.setup()
    const { container } = renderView()
    openInfoSheet(container)
    await u.click(screen.getByRole('button', { name: '加入行程' }))

    expect(screen.getByRole('grid')).not.toBeNull()

    const { year, month, day } = pickThisMonthDay()
    await pickCalendarDate(u, year, month, day)

    // closeAll() 讓日曆 sheet(以及原本就不存在的日期清單 sheet)一起
    // 關閉,只剩資訊卡。
    expect(sheetPanels(container)).toHaveLength(1)

    // 打勾提示:「加入行程」按鈕變成「已加入」(title/aria-label 屬性由
    // GeoOutlinePhoneInfoSheet.tsx 的 addUi.mode==='added' 決定)。
    const addBtn = screen.getByRole('button', { name: '已加入' }) as HTMLButtonElement
    expect(addBtn.disabled).toBe(true)

    expect(recordEntryMock).toHaveBeenCalledTimes(1)
  })

  it('候選沒有排定日期、行程已有排定日期時，先開日期清單 sheet；點日期項目後兩層都關閉、回到資訊卡', async () => {
    const u = userEvent.setup()

    // 先讓 fetchEntries 回傳一筆已排入行程、帶座標的 entry(讓
    // geo.scheduledDates 非空)——useGeoOutlineMapState 內部的 tripID
    // effect 在元件掛載時就會呼叫這支函式,mock 要在 renderView() 之前
    // 設定好回傳值,才能讓掛載當下的第一次查詢直接帶出這批資料(理由見
    // 上方檔案開頭的完整說明:onTripEntriesChange 已不再是 ExploreMap
    // 的 prop,必須透過這支底層 API 函式驅動真實的資料流)。
    fetchEntriesMock.mockResolvedValueOnce([
      { id: 'entry_1', title: '既有安排', lat: 25.05, lng: 121.58, location: '', start: '2026-09-05', startTime: '', kind: 'activity' } as never,
    ])
    const { container } = renderView()
    await waitFor(() => expect(fetchEntriesMock).toHaveBeenCalled())

    openInfoSheet(container)
    await u.click(screen.getByRole('button', { name: '加入行程' }))

    // 兩層:資訊卡 + 日期清單 sheet(沒有日曆 sheet)。用「其他日期」按鈕
    // 存在與否確認這是日期清單 sheet。
    expect(sheetPanels(container)).toHaveLength(2)
    expect(screen.getByRole('button', { name: '其他日期' })).not.toBeNull()

    // 點既有日期項目(9/5,dayGroupLabel 格式化結果)。
    await u.click(screen.getByRole('button', { name: '9/5' }))

    // 兩層 sheet 都關閉(sheetStack.closeAll()),只剩資訊卡。
    expect(sheetPanels(container)).toHaveLength(1)
    expect(screen.getByRole('button', { name: '已加入' })).not.toBeNull()
    expect(recordEntryMock).toHaveBeenCalledTimes(1)
  })

  it('日期清單 sheet 點「其他日期」，日曆 sheet 疊上來（兩層同時存在）；日曆 sheet 選定日期後兩層都關閉', async () => {
    const u = userEvent.setup()

    // 理由同上一個測試——先設定好 fetchEntries 的回傳值再掛載元件。
    fetchEntriesMock.mockResolvedValueOnce([
      { id: 'entry_1', title: '既有安排', lat: 25.05, lng: 121.58, location: '', start: '2026-09-05', startTime: '', kind: 'activity' } as never,
    ])
    const { container } = renderView()
    await waitFor(() => expect(fetchEntriesMock).toHaveBeenCalled())

    openInfoSheet(container)
    await u.click(screen.getByRole('button', { name: '加入行程' }))
    expect(sheetPanels(container)).toHaveLength(2)

    await u.click(screen.getByRole('button', { name: '其他日期' }))

    // 三層同時存在:資訊卡 + 日期清單 sheet + 日曆 sheet。
    expect(sheetPanels(container)).toHaveLength(3)
    expect(screen.getByRole('grid')).not.toBeNull()

    const { year, month, day } = pickThisMonthDay()
    await pickCalendarDate(u, year, month, day)

    // closeAll() 一次收掉整段日期選擇流程,只剩資訊卡。
    expect(sheetPanels(container)).toHaveLength(1)
    expect(screen.getByRole('button', { name: '已加入' })).not.toBeNull()
  })
})
