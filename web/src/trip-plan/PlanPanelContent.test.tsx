// PlanPanelContent:規劃疊加面板裡的內容(TripPlanPage)與它的共同設定。
// /ai-plan 的 LivePlanLayer 與登入後的 phone/Content 原本各自傳同一組設定給 TripPlanPage(靠註解維持一致),
// 現在收在這一個元件。mock 掉 TripPlanPage,只驗證它收到什麼。
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

let received: Record<string, unknown> = {}
vi.mock('./TripPlanPage', () => ({
  TripPlanPage: (props: Record<string, unknown>) => {
    received = props
    return <div data-testid="trip-plan-page" />
  },
}))

let desktop = false
vi.mock('../hooks/useIsDesktop', () => ({ useIsDesktop: () => desktop }))

import { PlanPanelContent } from './PlanPanelContent'
import type { PlanAiDataSource } from '../home/plan-ai-sim/planAiDataSource'
import type { PlanTimelineStore } from '../plan-core/planTimelineStorage'

const cfg = { baseURL: 'http://localhost', token: null }
const store = {} as unknown as PlanTimelineStore
const dataSource = { placeDetails: vi.fn(), transitEstimate: vi.fn() } as unknown as PlanAiDataSource

describe('PlanPanelContent', () => {
  it('固定帶上共同設定:compact、透明背景、不顯示空狀態、詢問頁從「全部國家」開始', () => {
    render(<PlanPanelContent cfg={cfg} dataSource={dataSource} store={store} />)
    expect(received.compact).toBe(true)
    expect(received.transparentBackground).toBe(true)
    expect(received.hideEmptyState).toBe(true)
    expect(received.initialAskPage).toEqual({ country: {} })
    expect(received.cfg).toBe(cfg)
  })

  it('其餘 prop 原樣轉給 TripPlanPage(各邊特有的設定:橫向時間軸、儲存、資料來源、選取、回呼)', () => {
    const onStopsChange = vi.fn()
    const store = { id: 'store' }
    render(
      <PlanPanelContent
        cfg={cfg} dataSource={dataSource}
        horizontalTimeline
        selectedStopId="a"
        onStopsChange={onStopsChange}
        store={store as never}
      />,
    )
    expect(received.horizontalTimeline).toBe(true)
    expect(received.selectedStopId).toBe('a')
    expect(received.onStopsChange).toBe(onStopsChange)
    expect(received.store).toBe(store)
  })

  it('呼叫端可以覆寫詢問頁設定', () => {
    render(<PlanPanelContent cfg={cfg} dataSource={dataSource} store={store} initialAskPage={{ country: { code: 'JP' } } as never} />)
    expect(received.initialAskPage).toEqual({ country: { code: 'JP' } })
  })

  it('不能用 prop 關掉共同設定中的 compact、透明背景、不顯示空狀態', () => {
    render(<PlanPanelContent cfg={cfg} dataSource={dataSource} store={store} {...({ compact: false, transparentBackground: false, hideEmptyState: false } as object)} />)
    expect(received.compact).toBe(true)
    expect(received.transparentBackground).toBe(true)
    expect(received.hideEmptyState).toBe(true)
  })

  it('渲染 TripPlanPage', () => {
    const { getByTestId } = render(<PlanPanelContent cfg={cfg} dataSource={dataSource} store={store} />)
    expect(getByTestId('trip-plan-page')).toBeTruthy()
  })

  it('horizontalTimeline 預設依螢幕:手機橫向、桌面直向;呼叫端明確傳值時以呼叫端為準', () => {
    desktop = false
    render(<PlanPanelContent cfg={cfg} dataSource={dataSource} store={store} />)
    expect(received.horizontalTimeline).toBe(true)
    desktop = true
    render(<PlanPanelContent cfg={cfg} dataSource={dataSource} store={store} />)
    expect(received.horizontalTimeline).toBe(false)
    render(<PlanPanelContent cfg={cfg} dataSource={dataSource} store={store} horizontalTimeline />)
    expect(received.horizontalTimeline).toBe(true)
    desktop = false
  })
})
