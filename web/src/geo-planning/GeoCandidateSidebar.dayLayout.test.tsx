// GeoCandidateSidebar 日層架的天數顯示邏輯——涵蓋這次新增的兩個行為:
//   1. 已排入行程的日期之間若有完全空白的中間天(例如已排 1/1、1/3,
//      中間的 1/2 沒有任何項目),自動常駐顯示,不需要拖曳或任何觸發。
//   2. 「新增前一天」/「新增隔天」按鈕:按下後在對應日期產生一個常駐
//      顯示的空白分組,取代原本「拖曳時才浮現的臨時佔位區」設計(那個
//      設計已知會讓下方元素位移、有中斷拖曳的風險,見 GeoCandidateSidebar.tsx
//      的說明)。
// 「已排入行程 · N」標題文字已依使用者要求移除,故這裡不驗證任何標題
// 文案,只驗證天數分組本身。
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GeoCandidateSidebar } from './GeoCandidateSidebar'
import type { GeoCandidate } from './geoCandidateHelpers'
import type { ClientConfig } from '../api'

const cfg: ClientConfig = { baseURL: 'http://localhost:8080', token: null }

function entryOnDate(id: string, date: string): GeoCandidate {
  return {
    kind: 'entry',
    inTrip: true,
    entryKind: 'activity',
    id,
    name: `項目 ${id}`,
    lat: 25.03,
    lng: 121.56,
    location: '',
    start: date,
    startTime: '',
  } as GeoCandidate
}

function renderSidebar(candidates: GeoCandidate[]) {
  return render(
    <GeoCandidateSidebar
      cfg={cfg}
      tripID="trip_1"
      candidates={candidates}
      draggingCandidate={null}
      onDraggingCandidateChange={() => {}}
    />,
  )
}

describe('GeoCandidateSidebar:已排日期之間的空白天自動顯示', () => {
  it('已排 1/1、1/3 兩天時,中間完全空白的 1/2 自動常駐顯示', () => {
    renderSidebar([
      entryOnDate('e1', '2026-01-01'),
      entryOnDate('e2', '2026-01-03'),
    ])

    expect(screen.getByText('1/1')).not.toBeNull()
    expect(screen.getByText('1/2')).not.toBeNull()
    expect(screen.getByText('1/3')).not.toBeNull()
  })

  it('只有一天有項目時,不會自動補出任何空白天(沒有頭尾可以計算中間)', () => {
    renderSidebar([entryOnDate('e1', '2026-01-01')])

    expect(screen.getByText('1/1')).not.toBeNull()
    expect(screen.queryByText('1/2')).toBeNull()
  })

  it('已排日期彼此相鄰(無缺口)時,不會多出任何空白天', () => {
    renderSidebar([
      entryOnDate('e1', '2026-01-01'),
      entryOnDate('e2', '2026-01-02'),
    ])

    expect(screen.getByText('1/1')).not.toBeNull()
    expect(screen.getByText('1/2')).not.toBeNull()
    expect(screen.queryByText('1/3')).toBeNull()
  })
})

describe('GeoCandidateSidebar:「新增前一天」/「新增隔天」按鈕', () => {
  it('已排入行程時顯示「新增前一天」與「新增隔天」按鈕,標示正確日期', () => {
    renderSidebar([entryOnDate('e1', '2026-01-05')])

    expect(screen.getByRole('button', { name: /新增.*1\/4.*前一天/ })).not.toBeNull()
    expect(screen.getByRole('button', { name: /新增.*1\/6.*隔天/ })).not.toBeNull()
  })

  it('按下「新增隔天」後,對應日期變成常駐顯示的分組', async () => {
    const user = userEvent.setup()
    renderSidebar([entryOnDate('e1', '2026-01-05')])

    await user.click(screen.getByRole('button', { name: /新增.*1\/6.*隔天/ }))

    // 1/6 現在是常駐分組(文字存在)。nextDayKey 的計算只依賴真正的
    // entry 資料(lastDatedDayKey),不受 manualBlankDayKeys 影響
    // (見 GeoCandidateSidebar.tsx 的說明),故「新增隔天」按鈕仍停在
    // 1/6——這是刻意的行為,讓使用者能重複點擊連續往後新增多個空白天,
    // 不是 bug。
    expect(screen.getByText('1/6')).not.toBeNull()
    expect(screen.getByRole('button', { name: /新增.*1\/6.*隔天/ })).not.toBeNull()
  })

  it('按下「新增前一天」後,對應日期變成常駐顯示的分組', async () => {
    const user = userEvent.setup()
    renderSidebar([entryOnDate('e1', '2026-01-05')])

    await user.click(screen.getByRole('button', { name: /新增.*1\/4.*前一天/ }))

    // 同上,prevDayKey 只依賴真正的 entry 資料,按鈕仍停在 1/4,可重複
    // 點擊連續往前新增。
    expect(screen.getByText('1/4')).not.toBeNull()
    expect(screen.getByRole('button', { name: /新增.*1\/4.*前一天/ })).not.toBeNull()
  })

  it('沒有任何已排入行程項目時,不顯示「新增前一天」/「新增隔天」按鈕(無頭尾可計算)', () => {
    renderSidebar([])

    expect(screen.queryByRole('button', { name: /新增.*前一天/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /新增.*隔天/ })).toBeNull()
  })
})
