// LivePlanLayer(登入後桌面版):包 PlanPanelContent,傳桌面特有的設定——登入版資料存取層、visible、onPanToStop、
// 受控 selectedStopId 與四個回報回呼。mock 掉 PlanPanelContent,只驗證它收到什麼。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { getPlanAiApiDataSource } from '../../data/api'
import { localStoragePlanTimelineStore } from '../../timeline/storage'

let received: Record<string, unknown> = {}
vi.mock('../../panel/PlanPanelContent', () => ({
  PlanPanelContent: (props: Record<string, unknown>) => {
    received = props
    return <div data-testid="panel" />
  },
}))

import { LivePlanLayer } from './LivePlanLayer'

const cfg = { baseURL: 'http://x', token: 't' }
const tripPlanProps = {
  onStopsChange: vi.fn(),
  onRouteSegmentsChange: vi.fn(),
  onSelectedStopChange: vi.fn(),
  onHoverStopChange: vi.fn(),
  onHoverTransitChange: vi.fn(),
}

beforeEach(() => {
  received = {}
})

describe('LivePlanLayer(登入後桌面版)', () => {
  it('傳登入版資料存取層、visible、onPanToStop、受控選取;不傳 horizontalTimeline(由 PlanPanelContent 依螢幕決定)', async () => {
    const onPanToStop = vi.fn()
    render(<LivePlanLayer cfg={cfg} visible onPanToStop={onPanToStop} selectedStopId="s1" tripPlanProps={tripPlanProps} />)
    await waitFor(() => expect(received.cfg).toBe(cfg))
    expect(received.dataSource).toBe(getPlanAiApiDataSource(cfg))
    expect(received.store).toBe(localStoragePlanTimelineStore)
    expect('conversationStore' in received).toBe(false) // 對話純記憶體,不再傳 store
    expect(received.visible).toBe(true)
    expect(received.onPanToStop).toBe(onPanToStop)
    expect(received.selectedStopId).toBe('s1')
    expect('horizontalTimeline' in received).toBe(false)
  })

  it('四個回報回呼原樣轉給 PlanPanelContent', async () => {
    render(
      <LivePlanLayer cfg={cfg} visible={false} onPanToStop={() => {}} selectedStopId={null} tripPlanProps={tripPlanProps} />,
    )
    await waitFor(() => expect(received.cfg).toBe(cfg))
    for (const k of Object.keys(tripPlanProps) as (keyof typeof tripPlanProps)[]) expect(received[k]).toBe(tripPlanProps[k])
  })
})
