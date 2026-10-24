// LivePlanLayer:/ai-plan 推論態的規劃面板內容。包 PlanPanelContent,傳 /ai-plan 特有的設定,
// 並把站點、選取、hover、轉乘膠囊 hover 的回報原樣往上轉。mock 掉 PlanPanelContent 與螢幕寬度。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

let received: Record<string, unknown> = {}
const noCbs = {
  onStopsChange: vi.fn(),
  onRouteSegmentsChange: vi.fn(),
  onSelectedStopChange: vi.fn(),
  onHoverStopChange: vi.fn(),
  onHoverTransitChange: vi.fn(),
}
vi.mock('../panel/PlanPanelContent', () => ({
  PlanPanelContent: (props: Record<string, unknown>) => {
    received = props
    return <div data-testid="panel" />
  },
}))

import { LivePlanLayer } from './LivePlanLayer'

beforeEach(() => {
  received = {}
})

describe('LivePlanLayer', () => {
  it('四個回報原樣轉給 PlanPanelContent:站點、選取、hover、轉乘膠囊 hover', () => {
    const cbs = {
      onStopsChange: vi.fn(),
      onRouteSegmentsChange: vi.fn(),
      onSelectedStopChange: vi.fn(),
      onHoverStopChange: vi.fn(),
      onHoverTransitChange: vi.fn(),
    }
    render(<LivePlanLayer selectedStopId={null} tripPlanProps={cbs} />)
    expect(received.onStopsChange).toBe(cbs.onStopsChange)
    expect(received.onSelectedStopChange).toBe(cbs.onSelectedStopChange)
    expect(received.onHoverStopChange).toBe(cbs.onHoverStopChange)
    expect(received.onHoverTransitChange).toBe(cbs.onHoverTransitChange)
  })

  it('回呼是空函式也能渲染', () => {
    const { getByTestId } = render(<LivePlanLayer selectedStopId={null} tripPlanProps={noCbs} />)
    expect(getByTestId('panel')).toBeTruthy()
  })

  it('不傳 horizontalTimeline:由 PlanPanelContent 依螢幕決定(三個入口同一條規則)', () => {
    render(<LivePlanLayer selectedStopId={null} tripPlanProps={noCbs} />)
    expect('horizontalTimeline' in received).toBe(false)
  })

  it('帶上 /ai-plan 特有的設定:訪客 cfg、草稿儲存、公開資料來源', () => {
    render(<LivePlanLayer selectedStopId={null} tripPlanProps={noCbs} />)
    expect(received.cfg).toBeTruthy()
    expect(received.store).toBeTruthy()
    expect('conversationStore' in received).toBe(false) // 對話純記憶體,不再傳 store
    expect(received.dataSource).toBeTruthy()
  })

  it('受控選取:selectedStopId 原樣轉給 PlanPanelContent(時間軸與地圖共用同一份選取,點圓點 → 卡片高亮)', () => {
    render(<LivePlanLayer selectedStopId="s1" tripPlanProps={noCbs} />)
    expect(received.selectedStopId).toBe('s1')
    render(<LivePlanLayer selectedStopId={null} tripPlanProps={noCbs} />)
    // null 仍算受控(沒有選任何一站),不能被轉成 undefined
    expect('selectedStopId' in received && received.selectedStopId === null).toBe(true)
  })
})
