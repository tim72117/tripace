// HorizontalPlanTimeline 的空天佔位卡:沒有任何站點的天(PlanDay.nodes 為空),要有一張可以滑到、可以選取的卡片。
// 佔位卡的站點 id 就是那一天的 PlanDay.id。
// jsdom 沒有 scrollIntoView(見 HorizontalPlanTimeline.test.tsx 的處理),測試前補一個空實作。
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { renderWithPlanData as render } from '../../data/fixtures'
import { HorizontalPlanTimeline } from './HorizontalPlanTimeline'
import type { PlanNode, PlanTimeline } from '../model'
import styles from './HorizontalPlanTimeline.module.css'

// cardSequence——卷軸列上所有卡片依 DOM 順序的代號:站點卡用站名,空天佔位卡記為「(空天)」,住宿卡記為「(住宿)」。
function cardSequence(c: HTMLElement): string[] {
  return Array.from(c.querySelectorAll<HTMLElement>(`.${styles.card}`)).map((card) => {
    if (card.classList.contains(styles.emptyDayCard)) return '(空天)'
    if (card.classList.contains(styles.lodgingCard)) return '(住宿)'
    return card.querySelector(`.${styles.name}`)?.textContent ?? '?'
  })
}
const emptyCard = (c: HTMLElement) => c.querySelector<HTMLElement>(`.${styles.emptyDayCard}`)
const badgeTexts = (root: ParentNode) => Array.from(root.querySelectorAll(`.${styles.dayBadge}`)).map((e) => e.textContent?.trim())

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
    const placeholderText = getByText('這一天還沒有行程')
    // 卡片順序:Day 1 的站點卡在前,空天佔位卡緊接在後(而且只有這兩張)
    expect(cardSequence(container)).toEqual(['a', '(空天)'])
    const empty = emptyCard(container)!
    expect(empty.getAttribute('role')).toBe('button')
    expect(empty.contains(placeholderText)).toBe(true)
    const stopA = getByText('a').closest<HTMLElement>(`.${styles.card}`)!
    expect(stopA.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(badgeTexts(empty)).toEqual(['Day 2'])
  })

  it('點佔位卡會以那一天的 day.id 呼叫 onSelectStop(讓呼叫端知道選到了第幾天)', () => {
    const onSelectStop = vi.fn()
    const { container } = render(
      <HorizontalPlanTimeline timeline={emptySecondDay} selectedStopId={null} onSelectStop={onSelectStop} onOpenPhotos={noop} />,
    )
    fireEvent.click(emptyCard(container)!)
    expect(onSelectStop).toHaveBeenCalledWith('day-2')
  })

  it('有站點的天不會多出佔位卡', () => {
    const timeline: PlanTimeline = { days: [{ id: 'day-1', nodes: [stop('a')] }, { id: 'day-2', nodes: [stop('b')] }] }
    const { container } = render(
      <HorizontalPlanTimeline timeline={timeline} selectedStopId={null} onSelectStop={noop} onOpenPhotos={noop} />,
    )
    expect(emptyCard(container)).toBeNull()
    expect(cardSequence(container)).toEqual(['a', 'b'])
  })

  it('選到空天(selectedStopId 是 day.id)時,aria-current 標在佔位卡上', () => {
    const { container } = render(
      <HorizontalPlanTimeline timeline={emptySecondDay} selectedStopId="day-2" onSelectStop={noop} onOpenPhotos={noop} />,
    )
    expect(emptyCard(container)?.getAttribute('aria-current')).toBe('true')
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
  })

  it('旅館入住日剛好是空天:Day 標籤只出現一次(畫在該天第一張的住宿卡上,佔位卡不再重複畫)', () => {
    const timeline: PlanTimeline = {
      days: [{ id: 'd1', nodes: [stop('a')] }, { id: 'd2', nodes: [stop('b')] }, { id: 'd3', nodes: [stop('c')] }, { id: 'd4', nodes: [] }],
      lodgings: [{ id: 'L1', name: '溫泉旅館', dayIds: ['d4'] }],
    }
    const { container } = render(
      <HorizontalPlanTimeline timeline={timeline} selectedStopId={null} onSelectStop={noop} onOpenPhotos={noop} />,
    )
    expect(badgeTexts(container)).toEqual(['Day 1', 'Day 2', 'Day 3', 'Day 4'])
    expect(cardSequence(container)).toEqual(['a', 'b', 'c', '(住宿)', '(空天)'])
    expect(badgeTexts(container.querySelector('[data-lodging-id="L1"]')!)).toEqual(['Day 4'])
    expect(badgeTexts(emptyCard(container)!)).toEqual([])
  })

  it('空天前面沒有住宿卡時,佔位卡自己就是該天第一張,照樣畫 Day 標籤', () => {
    const { container } = render(
      <HorizontalPlanTimeline timeline={emptySecondDay} selectedStopId={null} onSelectStop={noop} onOpenPhotos={noop} />,
    )
    expect(badgeTexts(emptyCard(container)!)).toEqual(['Day 2'])
  })
})
