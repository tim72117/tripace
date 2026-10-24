// 點選住宿橫幅與安排點(站點卡)都要把地圖移動到那個點(各入口注入的 pan 是依安全區算中心的 panToWithinSafeArea)。
//
// 這裡把真正的 PlanTimelineView 與真正的 useStopCardClick(planning/map/useStopPan.ts)接起來,接法與各頁面一致
// (視圖的 onPanToStop = useStopCardClick({ select, pan }) 回傳的函式),驗證「點下去 → 選取該項 + pan 收到該項的座標」。
// pan 用 mock 取代,不碰 Google Maps;實際「落在安全區中心」的計算是 useMapSafeArea 的職責,不在這個測試範圍。
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { dataSourceFromRefs, renderWithPlanData as render } from '../data/fixtures'
import { useState } from 'react'
import { PlanTimelineView } from './PlanTimelineView'
import { useStopCardClick } from '../map/useStopPan'
import type { PlanLodging, PlanNode, PlanThemeChild } from './model'
import { timelineOf } from './fixtures'

function stop(id: string, over: Partial<PlanNode> = {}): PlanNode {
  return { id, type: 'stop', name: id, time: '10:00', duration: '1 小時', kind: '景點', desc: `${id}描述`, ...over } as PlanNode
}

// Harness——和頁面一樣:選取狀態由外層持有,點卡片 → useStopCardClick(select + pan)。
function Harness({
  pan,
  lodgings,
  nodes,
}: {
  pan: (target: { lat: number; lng: number }) => void
  lodgings: PlanLodging[]
  nodes: PlanNode[]
}) {
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)
  const onPanToStop = useStopCardClick({ select: setSelectedStopId, pan })
  return (
    <>
      <span data-testid="selected">{selectedStopId ?? ''}</span>
      <PlanTimelineView
        timeline={{ ...timelineOf(nodes), lodgings }}
        isThinking={false}
        emptyStateMessage=""
        selectedStopId={selectedStopId}
        showJumpPill={false}
        onJumpToLatest={() => {}}
        onPanToStop={onPanToStop}
        onOpenPhotos={() => {}}
        mountedIdsRef={{ current: new Set() }}
      />
    </>
  )
}

const lodgingResolved = new Map<string, PlanThemeChild>([['hotel-place', { id: 'hotel-place', name: '查到的旅館', lat: 24.5, lng: 121.5 }]])

function setup(opts: { lodgings?: PlanLodging[]; resolved?: ReadonlyMap<string, PlanThemeChild>; nodes?: PlanNode[] } = {}) {
  const pan = vi.fn()
  const utils = render(
    <Harness
      pan={pan}
      lodgings={opts.lodgings ?? [{ id: 'hotel', placeId: 'hotel-place', name: '作者寫的旅館', dayIds: ['d1', 'd2'] }]}
      nodes={opts.nodes ?? [stop('s1', { day: 1, lat: 23.1, lng: 120.1 }), stop('s2', { day: 2, lat: 23.2, lng: 120.2 })]}
    />,
    // 旅館 placeId 的解析結果:視圖向 PlanDataProvider 的 store 取,用回答這些 id 的資料來源提供。
    dataSourceFromRefs(opts.resolved ?? lodgingResolved),
  )
  return { ...utils, pan }
}

describe('點選住宿與安排點都會移動地圖', () => {
  it('點安排點(站點卡):選取該站,並把地圖移到該站的座標', () => {
    const { pan } = setup()
    fireEvent.click(screen.getByText('s2描述'))
    expect(screen.getByTestId('selected').textContent).toBe('s2')
    expect(pan).toHaveBeenCalledTimes(1)
    expect(pan).toHaveBeenCalledWith({ lat: 23.2, lng: 120.2 })
  })

  it('點住宿橫幅:選取該旅館,並把地圖移到由 placeId 查到的座標', async () => {
    const { pan, container } = setup()
    await screen.findByText('查到的旅館')
    fireEvent.click(container.querySelector('[data-lodging-id="hotel"]') as HTMLElement)
    expect(screen.getByTestId('selected').textContent).toBe('hotel')
    expect(pan).toHaveBeenCalledTimes(1)
    expect(pan).toHaveBeenCalledWith({ lat: 24.5, lng: 121.5 })
  })

  it('鍵盤(Enter)點住宿橫幅也會移動;安排點與住宿輪流點,每次都各自移動', async () => {
    const { pan, container } = setup()
    await screen.findByText('查到的旅館')
    const banner = container.querySelector('[data-lodging-id="hotel"]') as HTMLElement
    fireEvent.keyDown(banner, { key: 'Enter' })
    fireEvent.click(screen.getByText('s1描述'))
    fireEvent.click(banner)
    expect(pan.mock.calls.map((c) => c[0])).toEqual([
      { lat: 24.5, lng: 121.5 },
      { lat: 23.1, lng: 120.1 },
      { lat: 24.5, lng: 121.5 },
    ])
  })

  it('旅館還沒查到座標(沒有 placeId,或查詢尚未回來)時,點了不選取也不移動', () => {
    const { pan, container } = setup({ lodgings: [{ id: 'hotel', name: '只有名稱', dayIds: ['d1'] }], resolved: new Map() })
    const banner = container.querySelector('[data-lodging-id="hotel"]') as HTMLElement
    fireEvent.click(banner)
    expect(screen.getByTestId('selected').textContent).toBe('')
    expect(pan).not.toHaveBeenCalled()
  })

  it('安排點還沒有座標(查詢中的佔位卡)時,點了不選取也不移動', () => {
    const { pan } = setup({ nodes: [stop('pending', { day: 1, lat: undefined, lng: undefined })] })
    fireEvent.click(screen.getByText('pending描述'))
    expect(screen.getByTestId('selected').textContent).toBe('')
    expect(pan).not.toHaveBeenCalled()
  })
})
