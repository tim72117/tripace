import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { dataSourceFromRefs, renderWithPlanData as render } from './planDataTestUtils'
import { PlanTimelineView } from './PlanTimelineView'
import type { PlanLodging, PlanNode, PlanThemeChild } from './planTimeline'
import { timelineOf } from './planTimelineTestUtils'

// 住宿橫幅(PlanTimeline.lodgings):旅館的第一個停留日(入住日)那天最上面畫一條,連住的後續天不重複;
// 名稱依序取 placeId 解析結果、旅館自己的 name、「住宿」;互動(點擊平移、hover 連動)與一般卡片一致。

function stop(id: string, over: Partial<PlanNode> = {}): PlanNode {
  return { id, type: 'stop', name: id, time: '10:00', duration: '1 小時', kind: '景點', desc: `${id}描述`, lat: 1, lng: 2, ...over } as PlanNode
}

// resolved——旅館 placeId 的解析結果:視圖向 PlanDataProvider 的 store 取,這裡用回答這些 id 的資料來源提供(結果在查詢回來後才出現)。
function renderTimeline(lodgings: PlanLodging[], resolved?: ReadonlyMap<string, PlanThemeChild>, extra: Record<string, unknown> = {}) {
  const onPanToStop = vi.fn()
  const onHoverStop = vi.fn()
  const timeline = { ...timelineOf([stop('s1', { day: 1 }), stop('s2', { day: 2 }), stop('s3', { day: 3 })]), lodgings }
  const utils = render(
    <PlanTimelineView
      timeline={timeline}
      isThinking={false}
      emptyStateMessage=""
      selectedStopId={null}
      showJumpPill={false}
      onJumpToLatest={() => {}}
      onPanToStop={onPanToStop}
      onHoverStop={onHoverStop}
      onOpenPhotos={() => {}}
      mountedIdsRef={{ current: new Set() }}
      {...extra}
    />,
    resolved ? dataSourceFromRefs(resolved) : undefined,
  )
  return { ...utils, onPanToStop, onHoverStop }
}

const resolved = (entries: [string, PlanThemeChild][]) => new Map(entries)

describe('PlanTimelineView 住宿橫幅', () => {
  const lodgings: PlanLodging[] = [{ id: 'l1', placeId: 'p1', name: '作者寫的名稱', dayIds: ['d2', 'd3'] }]

  it('只在入住日(第一個停留日)畫一次,連住的後續天不重複;顯示區間文字', () => {
    const { container } = renderTimeline(lodgings)
    expect(container.querySelectorAll('[data-lodging-id="l1"]')).toHaveLength(1)
    expect(screen.getByText('Day 2–3')).toBeTruthy()
    // 橫幅在 Day 2 標題之後、Day 2 第一張卡之前
    const html = container.innerHTML
    expect(html.indexOf('Day 2')).toBeLessThan(html.indexOf('data-lodging-id="l1"'))
    expect(html.indexOf('data-lodging-id="l1"')).toBeLessThan(html.indexOf('s2描述'))
    expect(html.indexOf('data-lodging-id="l1"')).toBeLessThan(html.indexOf('Day 3'))
  })

  it('名稱:placeId 查到的優先,查不到退回 name,再退回「住宿」', async () => {
    const { unmount } = renderTimeline(lodgings, resolved([['p1', { id: 'p1', name: '查到的名稱', lat: 5, lng: 6 }]]))
    expect(await screen.findByText('查到的名稱')).toBeTruthy()
    unmount()
    const second = renderTimeline(lodgings)
    expect(screen.getByText('作者寫的名稱')).toBeTruthy()
    second.unmount()
    renderTimeline([{ id: 'l2', dayIds: ['d1'] }])
    expect(screen.getByText('住宿')).toBeTruthy()
  })

  it('同一天入住兩間(換旅館那天)各畫一條', () => {
    const { container } = renderTimeline([
      { id: 'a', name: 'A', dayIds: ['d1', 'd2'] },
      { id: 'b', name: 'B', dayIds: ['d2', 'd3'] },
    ])
    expect(container.querySelectorAll('[data-lodging-id]')).toHaveLength(2)
    expect(screen.getByText('Day 1–2')).toBeTruthy()
    expect(screen.getByText('Day 2–3')).toBeTruthy()
  })

  it('有座標時點橫幅會選取並平移(收到旅館 id 與座標),hover 回報旅館 id', async () => {
    const { onPanToStop, onHoverStop } = renderTimeline(lodgings, resolved([['p1', { id: 'p1', name: '查到的名稱', lat: 5, lng: 6 }]]))
    const banner = (await screen.findByText('查到的名稱')).closest('[role="button"]') as HTMLElement
    fireEvent.mouseEnter(banner)
    expect(onHoverStop).toHaveBeenCalledWith('l1')
    fireEvent.click(banner)
    expect(onPanToStop).toHaveBeenCalledWith(expect.objectContaining({ id: 'l1', lat: 5, lng: 6 }))
  })

  it('沒有座標(沒查到)時不可點、不平移', () => {
    const { onPanToStop } = renderTimeline(lodgings)
    const banner = screen.getByText('作者寫的名稱').closest('[data-lodging-id]') as HTMLElement
    expect(banner.getAttribute('role')).toBeNull()
    fireEvent.click(banner)
    expect(onPanToStop).not.toHaveBeenCalled()
  })

  it('沒有住宿時不畫橫幅;kind 為「住宿」的站不再有特殊畫法(普通景點卡)', () => {
    const timeline = timelineOf([stop('x', { kind: '住宿', desc: '一般描述' })])
    const { container } = render(
      <PlanTimelineView
        timeline={timeline}
        isThinking={false}
        emptyStateMessage=""
        selectedStopId={null}
        showJumpPill={false}
        onJumpToLatest={() => {}}
        onPanToStop={() => {}}
        onOpenPhotos={() => {}}
        mountedIdsRef={{ current: new Set() }}
      />,
    )
    expect(container.querySelector('[data-lodging-id]')).toBeNull()
    expect(screen.getByText('一般描述')).toBeTruthy()
  })
})
