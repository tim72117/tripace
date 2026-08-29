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
// mock 掉 GeoOutlinePanel(理由同其餘 GeoOutlinePhoneView.*.test.tsx——
// 這批測試不驗證地圖/查詢本身怎麼運作),直接暴露 onSearchResultSelect/
// onTripEntriesChange 讓測試手動選中一個候選、寫入既有排定日期。同時
// mock ../api 的 recordEntry/setEntryLatLng(createEntryFromCandidate
// 底層呼叫的兩支 API),讓 geo.handleScheduleCandidate 這條 async 寫入
// 路徑不需要真的打後端。
//
// 日曆 sheet 改用 DatePickerPopover(react-day-picker 月曆格線 UI,對齊
// 桌面版 GeoInfoPanel.tsx 的既有升級,見該檔案 GeoInfoPanel.test.tsx 的
// pickCalendarDate 輔助函式)——沿用同一套「用 aria-label 定位日期格子」
// 的既有測試手法,不是原生 <input type="date">。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GeoOutlinePhoneView } from './GeoOutlinePhoneView'
import type { ClientConfig, GeoSearchResult } from '../api'
import type { User } from '../user/types'

const recordEntryMock = vi.fn(() => Promise.resolve({ entryID: 'entry_new' }))
const setEntryLatLngMock = vi.fn(() => Promise.resolve())

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    recordEntry: (...args: unknown[]) => recordEntryMock(...(args as [])),
    setEntryLatLng: (...args: unknown[]) => setEntryLatLngMock(...(args as [])),
  }
})

let capturedOnSearchResultSelect: ((r: GeoSearchResult) => void) | undefined
let capturedOnTripEntriesChange: ((entries: unknown[]) => void) | undefined

vi.mock('./GeoOutlinePanel', () => ({
  GeoOutlinePanel: (props: {
    onSearchResultSelect?: (r: GeoSearchResult) => void
    onTripEntriesChange?: (entries: unknown[]) => void
  }) => {
    capturedOnSearchResultSelect = props.onSearchResultSelect
    capturedOnTripEntriesChange = props.onTripEntriesChange
    return null
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

// pickCalendarDate:比照 GeoInfoPanel.test.tsx 的既有輔助函式——
// react-day-picker 的日期格子沒有穩定的 test id,只有 aria-label(格式
// 「YYYY年M月D日 星期X」,若該格剛好是「今天」還會多出「今天,」前綴,
// 見下方 pickThisMonthDay 特意避開今天的說明)可以精確定位,只在同一個
// 月份內選日期,不處理跨月換頁。這裡不用 `^` 錨定開頭(GeoInfoPanel.test.tsx
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
    const { container } = renderView()

    // 先建立一筆已排入行程的 entry(讓 geo.scheduledDates 非空)——透過
    // onTripEntriesChange 這個 callback,理由同其餘測試檔案 mock
    // GeoOutlinePanel 暴露內部查詢結果的既有模式。
    act(() => {
      capturedOnTripEntriesChange?.([
        { id: 'entry_1', title: '既有安排', start: '2026-09-05', kind: 'activity' },
      ])
    })

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
    const { container } = renderView()

    act(() => {
      capturedOnTripEntriesChange?.([
        { id: 'entry_1', title: '既有安排', start: '2026-09-05', kind: 'activity' },
      ])
    })

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
