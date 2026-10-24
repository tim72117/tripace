// 「新行程」換草稿時對話清空:對話是純記憶體(usePlanConversation),跟著 TripPlanPage 的生命週期,
// LivePlanLayer 用 key={activeDraftId} 讓換草稿時整個重新掛載,所以對話跟著歸零。
// 這裡用 mock 的 PlanPanelContent(內部持有真的 usePlanConversation)固定這條連動,不必掛整個 TripPlanPage。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { usePlanConversation } from '../conversation/usePlanConversation'

let onNewDraft: (() => void) | undefined
let appendFromPanel: ((text: string) => void) | undefined
let mountCount = 0

vi.mock('../../DesktopShared', () => ({ NEW_TRIP_DRAFT_ENABLED: true }))
vi.mock('../panel/PlanPanelContent', async () => {
  const React = await import('react')
  return {
    PlanPanelContent: (props: { onNewDraft?: () => void }) => {
      const { messages, appendMessage } = usePlanConversation()
      React.useEffect(() => {
        mountCount += 1
      }, [])
      onNewDraft = props.onNewDraft
      appendFromPanel = (text) => appendMessage({ id: `m-${text}`, text })
      return <div data-testid="panel">{messages.map((m) => m.text).join('|')}</div>
    },
  }
})

import { LivePlanLayer } from './LivePlanLayer'

const noCbs = {
  onStopsChange: vi.fn(),
  onRouteSegmentsChange: vi.fn(),
  onSelectedStopChange: vi.fn(),
  onHoverStopChange: vi.fn(),
  onHoverTransitChange: vi.fn(),
}

beforeEach(() => {
  localStorage.clear()
  onNewDraft = undefined
  appendFromPanel = undefined
  mountCount = 0
})

describe('LivePlanLayer 換草稿時對話清空', () => {
  it('按「新行程」(activeDraftId 改變)後面板重新掛載,對話歸零', () => {
    const { getByTestId } = render(<LivePlanLayer selectedStopId={null} tripPlanProps={noCbs} />)
    act(() => appendFromPanel!('你好'))
    expect(getByTestId('panel').textContent).toBe('你好')
    expect(mountCount).toBe(1)
    act(() => onNewDraft!())
    expect(mountCount).toBe(2)
    expect(getByTestId('panel').textContent).toBe('')
  })

  it('對話不寫進 localStorage', () => {
    render(<LivePlanLayer selectedStopId={null} tripPlanProps={noCbs} />)
    act(() => appendFromPanel!('你好'))
    expect(Object.keys(localStorage).filter((k) => k.startsWith('tripace.planConversation'))).toEqual([])
  })
})
