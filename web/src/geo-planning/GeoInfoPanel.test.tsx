// GeoInfoPanel「加入行程」按鈕的日期選擇行為——這是尚未實作的新需求,先寫測試
// 定義預期契約,再動手改 GeoInfoPanel.tsx(TDD:紅燈在先)。目前這支測試會
// FAIL,因為 GeoInfoPanel.tsx 還沒有 onSchedule prop 也沒有日曆 UI。
//
// 需求(使用者原話):「加入行程的按鈕按下時,如果沒有已安排的時間,則要跳出
// 日歷選擇」——換句話說:
//   - 候選本身已經有排定日期(目前只有 kind==='entry' 且 start 有值的候選
//     才可能符合,見 GeoCandidate 型別定義,entry 是「返回候選」後暫時退回
//     候選籃、但仍保留原本 start/startTime 的項目)→ 按下「加入 {tripName}」
//     維持現有行為,直接呼叫 onAddCandidate,不彈日曆。
//   - 候選沒有已排定日期(hotel/attraction/place 三種來源天生沒有日期概念,
//     或 entry 候選但 start 是空字串)→ 按下「加入 {tripName}」不直接呼叫
//     onAddCandidate,而是原地展開一個日期選擇 UI(比照 GeoCandidateSidebar.tsx
//     的 NoDateDayHead 既有樣式慣例:一個 <input type="date"> + 一顆「確定」
//     按鈕),選好日期按確定後改呼叫新的 onSchedule(candidate, date) 回報
//     使用者選定的日期,不呼叫 onAddCandidate(這個新流程完全取代原本的
//     一鍵加入,不是先加入候選籃、之後才補日期——因為候選籃裡的「已排入
//     行程」分組本來就要有日期才有意義,見 GeoCandidateSidebar.tsx 的
//     dayGroupKey/NO_DATE_GROUP 分組邏輯)。
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
    // 日期選擇 UI 比照 GeoCandidateSidebar.tsx NoDateDayHead 的既有樣式:
    // 一個原生 <input type="date"> + 一顆「確定」按鈕。
    expect(document.querySelector('input[type="date"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: '確定' })).not.toBeNull()
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
    expect(document.querySelector('input[type="date"]')).toBeNull()
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
    expect(document.querySelector('input[type="date"]')).not.toBeNull()
  })

  it('日期選擇 UI 選好日期按「確定」後,呼叫 onSchedule(candidate, date),不呼叫 onAddCandidate', async () => {
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

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement
    await user.type(dateInput, '2026-09-01')
    await user.click(screen.getByRole('button', { name: '確定' }))

    expect(onSchedule).toHaveBeenCalledTimes(1)
    expect(onSchedule).toHaveBeenCalledWith(hotelCandidate, '2026-09-01')
    expect(onAddCandidate).not.toHaveBeenCalled()
  })

  it('沒有選日期就按「確定」不會呼叫 onSchedule(比照 NoDateDayHead 既有的 disabled 慣例)', async () => {
    const user = userEvent.setup()
    const onSchedule = vi.fn()
    render(
      <GeoInfoPanel
        content={contentWithCandidate(hotelCandidate)}
        onClose={() => {}}
        onSchedule={onSchedule}
        tripName={TRIP_NAME}
      />,
    )

    await user.click(screen.getByRole('button', { name: new RegExp(`加入.*${TRIP_NAME}`) }))
    await user.click(screen.getByRole('button', { name: '確定' }))

    expect(onSchedule).not.toHaveBeenCalled()
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
    expect(document.querySelector('input[type="date"]')).toBeNull()
  })
})

// ---- 行程已有排定日期時,「加入 {tripName}」先跳日期下拉選單 ----
//
// 這是上面那組測試的延伸(同一輪 TDD 討論,先寫測試再實作):使用者原話
// 「當已有安排行程時,加入行程按鈕按下後先出現日期選單,就是已經有排入的
// 日期清單,下面還有其他日期」。完整分岔邏輯(候選沒有自己排定日期時):
//   - 行程本身完全沒有已排定日期(scheduledDates 是空陣列/未傳入)→ 維持
//     上面那組測試的行為,直接展開日曆(input[type="date"] + 確定),不跳
//     下拉選單——沒有任何既有日期可以列,選單只會是空的,沒有意義。
//   - 行程本身已有排定日期(scheduledDates 非空)→ 按下按鈕先展開一個下拉
//     選單,列出 scheduledDates 每一天(用跟 GeoCandidateSidebar.tsx
//     dayGroupLabel 一致的「M/D」格式顯示),選單最下面多一個「其他日期」
//     選項:
//       - 點選單裡的某一天 → 直接呼叫 onSchedule(candidate, 那一天的
//         ISO 日期字串),選單收合,不會再跳日曆。
//       - 點「其他日期」→ 選單收合、改展開日曆(跟原本沒有既有日期時同一份
//         UI),選好日期按確定才呼叫 onSchedule。
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
    expect(document.querySelector('input[type="date"]')).toBeNull()
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
    expect(document.querySelector('input[type="date"]')).toBeNull()
  })

  it('下拉選單裡點「其他日期」,選單收合、改展開日曆;選好日期按確定才呼叫 onSchedule', async () => {
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
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement
    expect(dateInput).not.toBeNull()
    expect(onSchedule).not.toHaveBeenCalled()

    await user.type(dateInput, '2026-09-01')
    await user.click(screen.getByRole('button', { name: '確定' }))

    expect(onSchedule).toHaveBeenCalledTimes(1)
    expect(onSchedule).toHaveBeenCalledWith(hotelCandidate, '2026-09-01')
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

    expect(document.querySelector('input[type="date"]')).not.toBeNull()
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
    expect(document.querySelector('input[type="date"]')).toBeNull()
  })
})
