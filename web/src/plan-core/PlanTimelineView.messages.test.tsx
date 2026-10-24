// PlanTimelineView 的 messages prop:對話訊息(獨立於時間軸,見 planConversation.ts)一律渲染在時間軸最下方。
import { describe, it, expect } from 'vitest'
import { renderWithPlanData as render } from './planDataTestUtils'
import { PlanTimelineView } from './PlanTimelineView'
import type { PlanMessage } from './planConversation'
import type { PlanNode, PlanTimeline } from './planTimeline'

const stop = (id: string): PlanNode => ({ id, type: 'stop', name: id, time: '10:00', duration: '1 小時', kind: '景點', desc: `${id}描述` })

function renderView(timeline: PlanTimeline, messages?: PlanMessage[], over: { isThinking?: boolean } = {}) {
  return render(
    <PlanTimelineView
      timeline={timeline}
      messages={messages}
      isThinking={over.isThinking ?? false}
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

const twoDays: PlanTimeline = { days: [{ id: 'x', nodes: [stop('a')] }, { id: 'y', nodes: [stop('b')] }] }
const bubbles = (c: HTMLElement) => Array.from(c.querySelectorAll('[class*="messageBubble"]'))

describe('PlanTimelineView 對話訊息', () => {
  it('不傳或傳空陣列時不渲染任何訊息列', () => {
    expect(bubbles(renderView(twoDays).container)).toHaveLength(0)
    expect(bubbles(renderView(twoDays, []).container)).toHaveLength(0)
  })

  it('訊息渲染在所有天與站點之後(時間軸最下方),依傳入順序由上到下', () => {
    const { container } = renderView(twoDays, [
      { id: 'm1', text: '第一句' },
      { id: 'm2', text: '第二句' },
    ])
    const text = container.textContent ?? ''
    expect(text.indexOf('b描述')).toBeLessThan(text.indexOf('第一句'))
    expect(text.indexOf('第一句')).toBeLessThan(text.indexOf('第二句'))
    expect(container.querySelectorAll('[data-tl-message]')).toHaveLength(2)
  })

  it('stale 的訊息淡化(帶 messageBubbleStale 且是純文字),新鮮的用 markdown 完整渲染', () => {
    const { container } = renderView(twoDays, [
      { id: 'old', text: '舊的 **粗體**', stale: true },
      { id: 'new', text: '新的 **粗體**' },
    ])
    const [oldBubble, newBubble] = bubbles(container)
    expect(oldBubble.className).toContain('messageBubbleStale')
    expect(oldBubble.textContent).toBe('舊的 **粗體**')
    expect(oldBubble.querySelector('strong')).toBeNull()
    expect(newBubble.className).not.toContain('messageBubbleStale')
    expect(newBubble.querySelector('strong')?.textContent).toBe('粗體')
  })

  it('完全沒有行程但有訊息:訊息照常顯示,不再疊上空狀態引導文字', () => {
    const { container, queryByText } = renderView({ days: [] }, [{ id: 'm', text: '你好,想去哪?' }])
    expect(container.textContent).toContain('你好,想去哪?')
    expect(queryByText('還沒有行程')).toBeNull()
  })

  it('有訊息時最後一個站點的軸線往下接到訊息列(不算最後一列)', () => {
    const withoutMsg = renderView(twoDays).container
    const withMsg = renderView(twoDays, [{ id: 'm', text: 'hi' }]).container
    const lines = (c: HTMLElement) => c.querySelectorAll('[class*="axisLineBelow"]').length
    expect(lines(withMsg)).toBe(lines(withoutMsg) + 1)
  })

  it('推論中時呼吸點在訊息之後', () => {
    const { container } = renderView(twoDays, [{ id: 'm', text: '訊息文字' }], { isThinking: true })
    const msg = container.querySelector('[data-tl-message]')!
    const tip = container.querySelector('[data-tl-tip]')!
    expect(msg.compareDocumentPosition(tip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
