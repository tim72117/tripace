// PlanTimelineView 直接吃 PlanTimeline:依 days 畫「Day N」標題(含 Day 1 與空的天),再畫該天的節點。
import { describe, it, expect } from 'vitest'
import { renderWithPlanData as render } from '../data/fixtures'
import { PlanTimelineView } from './PlanTimelineView'
import type { PlanNode, PlanTimeline } from './model'

const stop = (id: string): PlanNode => ({ id, type: 'stop', name: id, time: '10:00', duration: '1 小時', kind: '景點', desc: `${id}描述` })

function renderView(timeline: PlanTimeline) {
  return render(
    <PlanTimelineView
      timeline={timeline}
      isThinking={false}
      emptyStateMessage="還沒有行程"
      selectedStopId={null}
      showJumpPill={false}
      onJumpToLatest={() => {}}
      onPanToStop={() => {}}
      onOpenPhotos={() => {}}
      mountedIdsRef={{ current: new Set() }}
    />,
  )
}

const labels = (c: HTMLElement) => Array.from(c.querySelectorAll('[class*="sectionLabel"]')).map((e) => e.textContent)

describe('PlanTimelineView 依天畫標題', () => {
  it('每一天(含 Day 1)先畫一個「Day N」標題,標題在該天的節點之前', () => {
    const { container } = renderView({ days: [{ id: 'x', nodes: [stop('a')] }, { id: 'y', nodes: [stop('b')] }] })
    expect(labels(container)).toEqual(['Day 1', 'Day 2'])
    const text = container.textContent ?? ''
    expect(text.indexOf('Day 1')).toBeLessThan(text.indexOf('a描述'))
    expect(text.indexOf('a描述')).toBeLessThan(text.indexOf('Day 2'))
    expect(text.indexOf('Day 2')).toBeLessThan(text.indexOf('b描述'))
  })

  it('空的天只畫標題,沒有卡片', () => {
    const { container } = renderView({ days: [{ id: 'x', nodes: [stop('a')] }, { id: 'y', nodes: [] }] })
    expect(labels(container)).toEqual(['Day 1', 'Day 2'])
    expect(container.textContent).not.toContain('Day 2描述')
    expect(container.querySelectorAll('[class*="stopRow"]').length).toBe(1)
  })

  it('標題的編號依天在 days 裡的位置,與 day.id 無關', () => {
    const { container } = renderView({ days: [{ id: 'zzz', nodes: [] }, { id: 'aaa', nodes: [] }] })
    expect(labels(container)).toEqual(['Day 1', 'Day 2'])
  })

  it('完全沒有天時顯示空狀態、沒有標題', () => {
    const { container, getByText } = renderView({ days: [] })
    expect(labels(container)).toEqual([])
    expect(getByText('還沒有行程')).toBeTruthy()
  })
})
