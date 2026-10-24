// SimPlanLayer——/ai-plan 模擬態在第 4 層的呼叫端:桌面渲染縱向時間軸,手機渲染橫向時間軸,劇本播到詢問頁時改渲染詢問頁。
// mock 掉兩個時間軸,只驗證元件把什麼交給誰、選哪一個。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { SimPlanLayer, type SimPlanLayerProps } from './SimPlanLayer'

const verticalProps: Record<string, unknown>[] = []
const horizontalProps: Record<string, unknown>[] = []

vi.mock('../timeline/PlanTimelineView', () => ({
  PlanTimelineView: (p: Record<string, unknown>) => {
    verticalProps.push(p)
    return <div data-testid="vertical" />
  },
}))
vi.mock('../timeline/phone/HorizontalPlanTimeline', () => ({
  HorizontalPlanTimeline: (p: Record<string, unknown>) => {
    horizontalProps.push(p)
    return <div data-testid="horizontal" />
  },
}))

beforeEach(() => {
  verticalProps.length = 0
  horizontalProps.length = 0
})

function props(over: Partial<SimPlanLayerProps> = {}): SimPlanLayerProps {
  return {
    isDesktop: false,
    timeline: { days: [] },
    messages: [],
    isGenerating: false,
    emptyStateMessage: '',
    timelineRef: { current: { nodes: new Map(), headId: null } },
    setStopTime: vi.fn(),
    retryStop: vi.fn(),
    showAskPage: false,
    askPageInput: undefined,
    handleAskPageDone: vi.fn(),
    renderScriptedAskPage: () => <div data-testid="ask" />,
    selectedStopId: null,
    setSelectedStopId: vi.fn(),
    setHoverStopId: vi.fn(),
    panToStop: vi.fn(),
    panToStopId: vi.fn(),
    scrollRef: { current: null },
    handleScroll: vi.fn(),
    showJumpPill: false,
    jumpToLatest: vi.fn(),
    mountedIdsRef: { current: new Set() },
    setLightboxPhotos: vi.fn(),
    ...over,
  } as SimPlanLayerProps
}

describe('SimPlanLayer', () => {
  it('手機:渲染橫向時間軸,選取同時寫選取與 hover,「移動到此」用 panToStopId', () => {
    const p = props()
    const { getByTestId, queryByTestId } = render(<SimPlanLayer {...p} />)
    expect(getByTestId('horizontal')).toBeTruthy()
    expect(queryByTestId('vertical')).toBeNull()
    const h = horizontalProps[0] as { onSelectStop: (id: string) => void; onPanToStop: unknown }
    h.onSelectStop('s1')
    expect(p.setSelectedStopId).toHaveBeenCalledWith('s1')
    expect(p.setHoverStopId).toHaveBeenCalledWith('s1')
    expect(h.onPanToStop).toBe(p.panToStopId)
  })

  it('桌面:渲染縱向時間軸,點卡片用 panToStop,hover 回報給 setHoverStopId', () => {
    const p = props({ isDesktop: true })
    const { getByTestId, queryByTestId } = render(<SimPlanLayer {...p} />)
    expect(getByTestId('vertical')).toBeTruthy()
    expect(queryByTestId('horizontal')).toBeNull()
    const v = verticalProps[0] as { onPanToStop: unknown; onHoverStop: unknown; hideEmptyState: boolean }
    expect(v.onPanToStop).toBe(p.panToStop)
    expect(v.onHoverStop).toBe(p.setHoverStopId)
    expect(v.hideEmptyState).toBe(true)
  })

  it('劇本播到詢問頁:桌面改渲染詢問頁取代縱向時間軸;手機把詢問頁交給橫向時間軸', () => {
    const d = render(<SimPlanLayer {...props({ isDesktop: true, showAskPage: true })} />)
    expect(d.getByTestId('ask')).toBeTruthy()
    expect(d.queryByTestId('vertical')).toBeNull()
    d.unmount()
    const p = props({ showAskPage: true })
    render(<SimPlanLayer {...p} />)
    const h = horizontalProps[0] as { showAskPage: boolean; renderAskPage: unknown }
    expect(h.showAskPage).toBe(true)
    expect(h.renderAskPage).toBe(p.renderScriptedAskPage)
  })

  it('桌面:把對話訊息交給縱向時間軸渲染在最下方;手機橫向時間軸不渲染對話(不收 messages)', () => {
    const messages = [{ id: 'm', text: '劇本旁白' }]
    render(<SimPlanLayer {...props({ isDesktop: true, messages })} />)
    expect(verticalProps[0].messages).toBe(messages)
    render(<SimPlanLayer {...props({ isDesktop: false, messages })} />)
    expect(horizontalProps[0]).not.toHaveProperty('messages')
  })
})
