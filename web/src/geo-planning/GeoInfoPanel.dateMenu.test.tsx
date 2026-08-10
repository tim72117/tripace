// GeoInfoPanel「加入 {tripName}」既有日期下拉選單(.dateMenu)的兩個行為:
//   1. 自動翻轉方向——按鈕組所在位置離視窗底部的剩餘空間不足以容納選單
//      估計高度時,改成往上展開(dateMenuOpenUp)。
//   2. 點選單以外的地方自動收合(mousedown 監聽,見 GeoInfoPanel.tsx)。
// 這兩個行為都不在 GeoInfoPanel.test.tsx 涵蓋範圍內(那份測試聚焦在
// onSchedule/onAddCandidate 該不該被呼叫,不驗證選單本身的定位/收合)。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GeoInfoPanel, type GeoInfoContent } from './GeoInfoPanel'
import type { GeoCandidate } from './GeoCandidateSidebar'

const TRIP_NAME = '東京五日遊'
const SCHEDULED_DATES = ['2026-08-16', '2026-08-17']

const hotelCandidate: GeoCandidate = {
  kind: 'hotel',
  name: '海景飯店',
  address: '台北市信義區',
  lat: 25.03,
  lng: 121.56,
  primaryType: 'lodging',
}

function contentWithCandidate(candidate: GeoCandidate): GeoInfoContent {
  return { name: candidate.name, badges: [], candidate }
}

// mockWrapPosition:GeoInfoPanel.tsx 用 addCandidateWrapRef.current.getBoundingClientRect()
// 量測按鈕組(.addCandidateWrap)底部離視窗底部的距離,決定選單要往上還是
// 往下展開。jsdom 預設所有元素的 getBoundingClientRect 都回傳全 0,故這裡
// mock 整個 HTMLElement.prototype.getBoundingClientRect,讓測試能控制
// 「按鈕組底部的 y 座標」這個關鍵輸入。
function mockWrapBottom(bottom: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    bottom,
    top: bottom - 30,
    left: 0,
    right: 0,
    width: 0,
    height: 30,
    x: 0,
    y: bottom - 30,
    toJSON: () => {},
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('GeoInfoPanel 既有日期下拉選單:自動翻轉方向', () => {
  it('按鈕組下方視窗剩餘空間充足時,選單維持預設往下展開(不套 dateMenuOpenUp 對應樣式)', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    mockWrapBottom(100) // 下方剩餘 700px,遠大於估計選單高度

    render(
      <GeoInfoPanel
        content={contentWithCandidate(hotelCandidate)}
        onClose={() => {}}
        scheduledDates={SCHEDULED_DATES}
        tripName={TRIP_NAME}
      />,
    )
    await user.click(screen.getByRole('button', { name: new RegExp(`加入.*${TRIP_NAME}`) }))

    const menuItem = screen.getByRole('button', { name: '8/16' })
    // .dateMenu 容器是選單項目的直接父層。
    const menu = menuItem.parentElement
    expect(menu?.className).not.toMatch(/dateMenuOpenUp/)
  })

  it('按鈕組下方視窗剩餘空間不足時,選單改往上展開(套用 dateMenuOpenUp 對應樣式)', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    mockWrapBottom(790) // 下方只剩 10px,遠小於估計選單高度(至少 3 項*30+8+6)

    render(
      <GeoInfoPanel
        content={contentWithCandidate(hotelCandidate)}
        onClose={() => {}}
        scheduledDates={SCHEDULED_DATES}
        tripName={TRIP_NAME}
      />,
    )
    await user.click(screen.getByRole('button', { name: new RegExp(`加入.*${TRIP_NAME}`) }))

    const menuItem = screen.getByRole('button', { name: '8/16' })
    const menu = menuItem.parentElement
    expect(menu?.className).toMatch(/dateMenuOpenUp/)
  })
})

describe('GeoInfoPanel 既有日期下拉選單:點外部收合', () => {
  it('選單展開時點擊選單以外的地方,選單收合', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    mockWrapBottom(100)

    render(
      <div>
        <div data-testid="outside">外部區域</div>
        <GeoInfoPanel
          content={contentWithCandidate(hotelCandidate)}
          onClose={() => {}}
          scheduledDates={SCHEDULED_DATES}
          tripName={TRIP_NAME}
        />
      </div>,
    )
    await user.click(screen.getByRole('button', { name: new RegExp(`加入.*${TRIP_NAME}`) }))
    expect(screen.getByRole('button', { name: '8/16' })).not.toBeNull()

    await user.click(screen.getByTestId('outside'))
    expect(screen.queryByRole('button', { name: '8/16' })).toBeNull()
  })

  it('選單展開時點擊選單/按鈕組內部,選單不收合', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    mockWrapBottom(100)

    render(
      <GeoInfoPanel
        content={contentWithCandidate(hotelCandidate)}
        onClose={() => {}}
        scheduledDates={SCHEDULED_DATES}
        tripName={TRIP_NAME}
      />,
    )
    await user.click(screen.getByRole('button', { name: new RegExp(`加入.*${TRIP_NAME}`) }))

    // 點選單容器本身(非選單項目按鈕),不應觸發收合。
    const menuItem = screen.getByRole('button', { name: '8/16' })
    const menu = menuItem.parentElement as HTMLElement
    await user.click(menu)

    expect(screen.getByRole('button', { name: '8/16' })).not.toBeNull()
  })
})
