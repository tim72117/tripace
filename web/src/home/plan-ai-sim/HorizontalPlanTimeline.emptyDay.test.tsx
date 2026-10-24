// HorizontalPlanTimeline 的空天佔位卡:沒有任何站點的天(PlanDay.nodes 為空),要有一張可以滑到、可以選取的卡片。
// 佔位卡的站點 id 就是那一天的 PlanDay.id。
// jsdom 沒有 scrollIntoView(見 HorizontalPlanTimeline.test.tsx 的處理),測試前補一個空實作。
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { renderWithPlanData as render } from '../../plan-core/planDataTestUtils'
import { HorizontalPlanTimeline } from './HorizontalPlanTimeline'
import type { PlanNode, PlanTimeline } from '../../plan-core/planTimeline'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

const stop = (id: string): PlanNode => ({ type: 'stop', id, name: id, time: '09:00', duration: '1h', kind: '景點' })
const noop = () => {}
// 第 1 天一站、第 2 天空的;第 2 天的 id 是 'day-2'
const emptySecondDay: PlanTimeline = { days: [{ id: 'day-1', nodes: [stop('a')] }, { id: 'day-2', nodes: [] }] }

describe('HorizontalPlanTimeline 空天佔位卡', () => {
  it('Day 2 沒有站點時,卷軸列有一張「這一天還沒有行程」的佔位卡,排在 Day 1 的卡片後面', () => {
    const { container, getByText } = render(
      <HorizontalPlanTimeline timeline={emptySecondDay} selectedStopId={null} onSelectStop={noop} onOpenPhotos={noop} />,
    )
    expect(getByText('這一天還沒有行程')).toBeTruthy()
    const cards = container.querySelectorAll('[class*="card"][role="button"]')
    expect(cards.length).toBeGreaterThanOrEqual(2)
    expect(container.querySelectorAll('[class*="emptyDayCard"]')).toHaveLength(1)
    expect(getByText('Day 2')).toBeTruthy()
  })

  it('點佔位卡會以那一天的 day.id 呼叫 onSelectStop(讓呼叫端知道選到了第幾天)', () => {
    const onSelectStop = vi.fn()
    const { container } = render(
      <HorizontalPlanTimeline timeline={emptySecondDay} selectedStopId={null} onSelectStop={onSelectStop} onOpenPhotos={noop} />,
    )
    fireEvent.click(container.querySelector('[class*="emptyDayCard"]') as HTMLElement)
    expect(onSelectStop).toHaveBeenCalledWith('day-2')
  })

  it('有站點的天不會多出佔位卡', () => {
    const timeline: PlanTimeline = { days: [{ id: 'day-1', nodes: [stop('a')] }, { id: 'day-2', nodes: [stop('b')] }] }
    const { container } = render(
      <HorizontalPlanTimeline timeline={timeline} selectedStopId={null} onSelectStop={noop} onOpenPhotos={noop} />,
    )
    expect(container.querySelectorAll('[class*="emptyDayCard"]')).toHaveLength(0)
  })

  it('選到空天(selectedStopId 是 day.id)時,aria-current 標在佔位卡上', () => {
    const { container } = render(
      <HorizontalPlanTimeline timeline={emptySecondDay} selectedStopId="day-2" onSelectStop={noop} onOpenPhotos={noop} />,
    )
    expect(container.querySelector('[class*="emptyDayCard"]')?.getAttribute('aria-current')).toBe('true')
  })
})
