// LivePlanLayer(登入後桌面版):包 PlanPanelContent,傳桌面特有的設定——登入版資料存取層、visible、onPanToStop、
// 受控 selectedStopId 與四個回報回呼。mock 掉 PlanPanelContent,只驗證它收到什麼。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { getPlanAiApiDataSource } from '../../data/api'
import { PLAN_TIMELINE_STORAGE_KEY } from '../../timeline/storage'
import { LEGACY_TRIP_ID, listTrips } from '../../trip/trips'

const flags = vi.hoisted(() => ({ newTrip: true }))
vi.mock('../../../DesktopShared', () => ({
  get NEW_TRIP_DRAFT_ENABLED() {
    return flags.newTrip
  },
}))

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
  flags.newTrip = true
  localStorage.clear()
})

describe('LivePlanLayer(登入後桌面版)', () => {
  it('傳登入版資料存取層、visible、onPanToStop、受控選取;不傳 horizontalTimeline(由 PlanPanelContent 依螢幕決定)', async () => {
    const onPanToStop = vi.fn()
    render(<LivePlanLayer cfg={cfg} visible onPanToStop={onPanToStop} selectedStopId="s1" tripPlanProps={tripPlanProps} />)
    await waitFor(() => expect(received.cfg).toBe(cfg))
    expect(received.dataSource).toBe(getPlanAiApiDataSource(cfg))
    // 時間軸存在使用中的行程底下;還沒有任何行程時是 legacy 行程,時間軸 key 就是原本固定的那一份。
    const store = received.store as { saveTimeline: (t: unknown, rev: number) => number | null }
    store.saveTimeline({ days: [{ id: 'd', nodes: [{ id: 'n', type: 'stop', name: '赤崁樓' }] }] }, 0)
    expect(localStorage.getItem(PLAN_TIMELINE_STORAGE_KEY)).not.toBeNull()
    expect(listTrips().map((t) => t.id)).toEqual([LEGACY_TRIP_ID])
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

describe('LivePlanLayer(登入後桌面版)的新行程' , () => {
  const renderLayer = () =>
    render(<LivePlanLayer cfg={cfg} visible onPanToStop={() => {}} selectedStopId={null} tripPlanProps={tripPlanProps} />)

  it('目前這一趟是空的:onNewDraft 不建立新行程', async () => {
    renderLayer()
    await waitFor(() => expect(received.onNewDraft).toBeTypeOf('function'))
    ;(received.onNewDraft as () => void)()
    expect(listTrips()).toEqual([])
  })

  it('目前這一趟有內容:onNewDraft 建立新行程並切過去(面板以新的 key 重新掛載),清掉選取', async () => {
    renderLayer()
    await waitFor(() => expect(received.onNewDraft).toBeTypeOf('function'))
    const store = received.store as { saveTimeline: (t: unknown, rev: number) => number | null }
    store.saveTimeline({ days: [{ id: 'd', nodes: [{ id: 'n', type: 'stop', name: '赤崁樓' }] }] }, 0)
    tripPlanProps.onSelectedStopChange.mockClear()
    act(() => {
      ;(received.onNewDraft as () => void)()
    })
    expect(tripPlanProps.onSelectedStopChange).toHaveBeenCalledWith(null)
    expect(listTrips()).toHaveLength(2)
    await waitFor(() => expect((received.store as object)).not.toBe(store))
  })

  it('功能開關(NEW_TRIP_DRAFT_ENABLED)關閉時不傳 onNewDraft,面板就不會渲染「新行程」按鈕', async () => {
    flags.newTrip = false
    renderLayer()
    await waitFor(() => expect(received.cfg).toBe(cfg))
    expect(received.onNewDraft).toBeUndefined()
  })
})
