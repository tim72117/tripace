// GeoInfoPanel「加入行程」按鈕的日期選擇行為。
//
// 需求(使用者原話):「加入行程的按鈕按下時,如果沒有已安排的時間,則要跳出
// 日歷選擇」——換句話說:
//   - 候選本身已經有排定日期(目前只有 kind==='entry' 且 start 有值的候選
//     才可能符合,見 GeoCandidate 型別定義,entry 是「返回候選」後暫時退回
//     候選籃、但仍保留原本 start/startTime 的項目)→ 按下「加入 {tripName}」
//     維持現有行為,直接呼叫 onAddCandidate,不彈日曆。
//   - 候選沒有已排定日期(hotel/attraction/place 三種來源天生沒有日期概念,
//     或 entry 候選但 start 是空字串)→ 按下「加入 {tripName}」不直接呼叫
//     onAddCandidate,而是展開一個日曆浮動匡(見 DatePickerPopover.tsx),
//     點選日期格子即視為確定,改呼叫新的 onSchedule(candidate, date) 回報
//     使用者選定的日期,不呼叫 onAddCandidate(這個流程完全取代原本的
//     一鍵加入,不是先加入候選籃、之後才補日期——因為候選籃裡的「已排入
//     行程」分組本來就要有日期才有意義,見 GeoCandidateSidebar.tsx 的
//     dayGroupKey/NO_DATE_GROUP 分組邏輯)。日曆 UI 原本是原生
//     <input type="date"> + 「確定」按鈕,使用者明確要求改成月曆格線浮動匡
//     (react-day-picker),點日期格子直接生效,不再需要「確定」按鈕/日期
//     文字輸入這兩個中介步驟。
//   - 右半邊複合按鈕(onAddAndReveal,PanelLeft icon)不受這個需求影響,
//     維持現有的「直接加入候選籃 + 側欄 highlight」行為不變——這顆按鈕的
//     語意本來就是「先丟進候選籃,之後再從候選籃那邊處理日期」(見
//     GeoCandidateSidebar.tsx 的「從候選加入」/NoDateDayHead 入口),不需要
//     在這裡也跳日曆。
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GeoInfoPanel, type GeoInfoContent } from './GeoInfoPanel'
import type { GeoCandidate } from './GeoCandidateSidebar'

const TRIP_NAME = '東京五日遊'

// pickCalendarDate:react-day-picker 的日期格子沒有穩定的 test id,只有
// aria-label(格式「YYYY年M月D日 星期X」,見 DatePickerPopover 渲染出的
// 實際 DOM)可以精確定位——月份/星期文字用正則比對,避免每次測試都要
// 手動組出完整字串(尤其星期幾隨日期變動,測試不該關心這個)。只在同一個
// 月份內選日期,測試資料刻意避開跨月換頁的情況,不需要額外處理上一頁/
// 下一頁導覽。
async function pickCalendarDate(user: ReturnType<typeof userEvent.setup>, year: number, month: number, day: number) {
  const label = new RegExp(`^${year}年${month}月${day}日`)
  await user.click(screen.getByRole('button', { name: label }))
}

function contentWithCandidate(candidate: GeoCandidate): GeoInfoContent {
  return {
    name: candidate.name,
    badges: [],
    candidate,
  }
}

const hotelCandidate: GeoCandidate = {
  kind: 'hotel',
  name: '海景飯店',
  address: '台北市信義區',
  lat: 25.03,
  lng: 121.56,
  primaryType: 'lodging',
}

function entryCandidateWithDate(): GeoCandidate {
  return {
    kind: 'entry',
    inTrip: false,
    entryKind: 'activity',
    id: 'ent_1',
    name: '已排定的景點',
    lat: 25.03,
    lng: 121.56,
    location: '台北市',
    start: '2026-08-20',
    startTime: '',
  }
}

function entryCandidateWithoutDate(): GeoCandidate {
  return {
    kind: 'entry',
    inTrip: false,
    entryKind: 'activity',
    id: 'ent_2',
    name: '還沒排定的景點',
    lat: 25.03,
    lng: 121.56,
    location: '台北市',
    start: '',
    startTime: '',
  }
}

describe('GeoInfoPanel「加入 {tripName}」按鈕的日期選擇', () => {
  it('候選沒有已排定日期(hotel/attraction/place 天生沒有日期)時,按下按鈕不會直接呼叫 onAddCandidate,而是展開日期選擇 UI', async () => {
    const user = userEvent.setup()
    const onAddCandidate = vi.fn()
    render(
      <GeoInfoPanel
        content={contentWithCandidate(hotelCandidate)}
        onClose={() => {}}
        onAddCandidate={onAddCandidate}
        tripName={TRIP_NAME}
      />,
    )

    await user.click(screen.getByRole('button', { name: new RegExp(`加入.*${TRIP_NAME}`) }))

    expect(onAddCandidate).not.toHaveBeenCalled()
    // 日期選擇 UI 改用日曆浮動匡(react-day-picker,見 DatePickerPopover.tsx)
    // ——用 grid role 確認月曆格線本身有渲染出來,不再檢查原生 date input。
    expect(screen.getByRole('grid')).not.toBeNull()
  })

  it('候選是 entry 且已有 start(已排定日期)時,按下按鈕直接呼叫 onAddCandidate,不展開日期選擇 UI', async () => {
    const user = userEvent.setup()
    const onAddCandidate = vi.fn()
    const candidate = entryCandidateWithDate()
    render(
      <GeoInfoPanel
        content={contentWithCandidate(candidate)}
        onClose={() => {}}
        onAddCandidate={onAddCandidate}
        tripName={TRIP_NAME}
      />,
    )

    await user.click(screen.getByRole('button', { name: new RegExp(`加入.*${TRIP_NAME}`) }))

    expect(onAddCandidate).toHaveBeenCalledTimes(1)
    expect(onAddCandidate).toHaveBeenCalledWith(candidate)
    expect(screen.queryByRole('grid')).toBeNull()
  })

  it('候選是 entry 但 start 是空字串(尚未排定日期)時,行為比照沒有日期的候選,展開日期選擇 UI', async () => {
    const user = userEvent.setup()
    const onAddCandidate = vi.fn()
    render(
      <GeoInfoPanel
        content={contentWithCandidate(entryCandidateWithoutDate())}
        onClose={() => {}}
        onAddCandidate={onAddCandidate}
        tripName={TRIP_NAME}
      />,
    )

    await user.click(screen.getByRole('button', { name: new RegExp(`加入.*${TRIP_NAME}`) }))

    expect(onAddCandidate).not.toHaveBeenCalled()
    expect(screen.getByRole('grid')).not.toBeNull()
  })

  it('日曆浮動匡點選日期格子後,直接呼叫 onSchedule(candidate, date),不呼叫 onAddCandidate', async () => {
    const user = userEvent.setup()
    const onAddCandidate = vi.fn()
    const onSchedule = vi.fn()
    render(
      <GeoInfoPanel
        content={contentWithCandidate(hotelCandidate)}
        onClose={() => {}}
        onAddCandidate={onAddCandidate}
        onSchedule={onSchedule}
        tripName={TRIP_NAME}
      />,
    )

    await user.click(screen.getByRole('button', { name: new RegExp(`加入.*${TRIP_NAME}`) }))
    await pickCalendarDate(user, 2026, 8, 27)

    expect(onSchedule).toHaveBeenCalledTimes(1)
    expect(onSchedule).toHaveBeenCalledWith(hotelCandidate, '2026-08-27')
    expect(onAddCandidate).not.toHaveBeenCalled()
  })

  it('複合按鈕右半邊(加入候選並顯示候選籃)不受影響:即使候選沒有日期,按下仍直接呼叫 onAddAndReveal,不展開日期選擇 UI', async () => {
    const user = userEvent.setup()
    const onAddAndReveal = vi.fn()
    render(
      <GeoInfoPanel
        content={contentWithCandidate(hotelCandidate)}
        onClose={() => {}}
        onAddAndReveal={onAddAndReveal}
        tripName={TRIP_NAME}
      />,
    )

    await user.click(screen.getByRole('button', { name: '加入候選並顯示候選籃' }))

    expect(onAddAndReveal).toHaveBeenCalledTimes(1)
    expect(onAddAndReveal).toHaveBeenCalledWith(hotelCandidate)
    expect(screen.queryByRole('grid')).toBeNull()
  })
})

// ---- 行程已有排定日期時,「加入 {tripName}」先跳日期下拉選單 ----
//
// 使用者原話:「當已有安排行程時,加入行程按鈕按下後先出現日期選單,就是
// 已經有排入的日期清單,下面還有其他日期」。完整分岔邏輯(候選沒有自己
// 排定日期時):
//   - 行程本身完全沒有已排定日期(scheduledDates 是空陣列/未傳入)→ 維持
//     上面那組測試的行為,直接展開日曆浮動匡,不跳下拉選單——沒有任何
//     既有日期可以列,選單只會是空的,沒有意義。
//   - 行程本身已有排定日期(scheduledDates 非空)→ 按下按鈕先展開一個下拉
//     選單,列出 scheduledDates 每一天(用跟 GeoCandidateSidebar.tsx
//     dayGroupLabel 一致的「M/D」格式顯示),選單最下面多一個「其他日期」
//     選項:
//       - 點選單裡的某一天 → 直接呼叫 onSchedule(candidate, 那一天的
//         ISO 日期字串),選單收合,不會再跳日曆。
//       - 點「其他日期」→ 選單收合、改展開日曆浮動匡(跟原本沒有既有日期
//         時同一份 UI),點選日期格子直接呼叫 onSchedule。
// scheduledDates 由呼叫端(DesktopLayout.tsx)傳入,格式為 YYYY-MM-DD 字串
// 陣列,這個元件不需要知道這些日期是怎麼算出來的。
const SCHEDULED_DATES = ['2026-08-16', '2026-08-17']

describe('GeoInfoPanel「加入 {tripName}」按鈕:行程已有排定日期時先跳下拉選單', () => {
  it('候選沒有日期、但行程已有排定日期時,按下按鈕展開下拉選單(列出既有日期 + 其他日期),不直接展開日曆', async () => {
    const user = userEvent.setup()
    render(
      <GeoInfoPanel
        content={contentWithCandidate(hotelCandidate)}
        onClose={() => {}}
        scheduledDates={SCHEDULED_DATES}
        tripName={TRIP_NAME}
      />,
    )

    await user.click(screen.getByRole('button', { name: new RegExp(`加入.*${TRIP_NAME}`) }))

    expect(screen.getByRole('button', { name: '8/16' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '8/17' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '其他日期' })).not.toBeNull()
    // 還沒點「其他日期」之前不該直接看到日曆。
    expect(screen.queryByRole('grid')).toBeNull()
  })

  it('下拉選單裡點選某個既有日期,直接呼叫 onSchedule(candidate, 該日期),不展開日曆', async () => {
    const user = userEvent.setup()
    const onSchedule = vi.fn()
    render(
      <GeoInfoPanel
        content={contentWithCandidate(hotelCandidate)}
        onClose={() => {}}
        onSchedule={onSchedule}
        scheduledDates={SCHEDULED_DATES}
        tripName={TRIP_NAME}
      />,
    )

    await user.click(screen.getByRole('button', { name: new RegExp(`加入.*${TRIP_NAME}`) }))
    await user.click(screen.getByRole('button', { name: '8/17' }))

    expect(onSchedule).toHaveBeenCalledTimes(1)
    expect(onSchedule).toHaveBeenCalledWith(hotelCandidate, '2026-08-17')
    expect(screen.queryByRole('grid')).toBeNull()
  })

  it('下拉選單裡點「其他日期」,選單收合、改展開日曆浮動匡;點選日期格子才呼叫 onSchedule', async () => {
    const user = userEvent.setup()
    const onSchedule = vi.fn()
    render(
      <GeoInfoPanel
        content={contentWithCandidate(hotelCandidate)}
        onClose={() => {}}
        onSchedule={onSchedule}
        scheduledDates={SCHEDULED_DATES}
        tripName={TRIP_NAME}
      />,
    )

    await user.click(screen.getByRole('button', { name: new RegExp(`加入.*${TRIP_NAME}`) }))
    await user.click(screen.getByRole('button', { name: '其他日期' }))

    // 選單應該收合(既有日期選項不再出現),改成看到日曆。
    expect(screen.queryByRole('button', { name: '8/16' })).toBeNull()
    expect(screen.getByRole('grid')).not.toBeNull()
    expect(onSchedule).not.toHaveBeenCalled()

    await pickCalendarDate(user, 2026, 8, 27)

    expect(onSchedule).toHaveBeenCalledTimes(1)
    expect(onSchedule).toHaveBeenCalledWith(hotelCandidate, '2026-08-27')
  })

  it('scheduledDates 是空陣列時,行為比照完全沒有既有日期:直接展開日曆,不跳下拉選單', async () => {
    const user = userEvent.setup()
    render(
      <GeoInfoPanel
        content={contentWithCandidate(hotelCandidate)}
        onClose={() => {}}
        scheduledDates={[]}
        tripName={TRIP_NAME}
      />,
    )

    await user.click(screen.getByRole('button', { name: new RegExp(`加入.*${TRIP_NAME}`) }))

    expect(screen.getByRole('grid')).not.toBeNull()
    expect(screen.queryByRole('button', { name: '其他日期' })).toBeNull()
  })

  it('候選本身已有排定日期時,即使行程也有其他排定日期,仍直接呼叫 onAddCandidate,不跳下拉選單也不展開日曆', async () => {
    const user = userEvent.setup()
    const onAddCandidate = vi.fn()
    const candidate = entryCandidateWithDate()
    render(
      <GeoInfoPanel
        content={contentWithCandidate(candidate)}
        onClose={() => {}}
        onAddCandidate={onAddCandidate}
        scheduledDates={SCHEDULED_DATES}
        tripName={TRIP_NAME}
      />,
    )

    await user.click(screen.getByRole('button', { name: new RegExp(`加入.*${TRIP_NAME}`) }))

    expect(onAddCandidate).toHaveBeenCalledTimes(1)
    expect(onAddCandidate).toHaveBeenCalledWith(candidate)
    expect(screen.queryByRole('button', { name: '其他日期' })).toBeNull()
    expect(screen.queryByRole('grid')).toBeNull()
  })
})
