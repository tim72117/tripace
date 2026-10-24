// HorizontalPlanTimeline 讀節點狀態表(nodeStatus)與內部解析的站點照片。
import { describe, it, expect, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { renderWithPlanData as render } from '../../data/fixtures'
import { HorizontalPlanTimeline } from './HorizontalPlanTimeline'
import { EMPTY_NODE_STATUS, setNodeStatus } from '../status'
import type { PlanNode } from '../model'
import { timelineOf } from '../fixtures'
import type { PlanAiDataSource } from '../../data/source'

const noop = () => {}
const node = (over: Partial<PlanNode> = {}): PlanNode => ({ id: 's1', type: 'stop', name: '赤崁樓', desc: '描述', time: '09:00', day: 1, placeId: 'p1', lat: 1, lng: 2, ...over })

function renderTimeline(n: PlanNode, extra: Partial<React.ComponentProps<typeof HorizontalPlanTimeline>> = {}, dataSource?: PlanAiDataSource) {
  return render(<HorizontalPlanTimeline timeline={timelineOf([n])} selectedStopId={null} onSelectStop={noop} onOpenPhotos={noop} {...extra} />, dataSource)
}

describe('HorizontalPlanTimeline 讀節點狀態表', () => {
  it('狀態表 loading:名稱/描述換成骨架,不顯示真實名稱', () => {
    const { container, queryByText } = renderTimeline(node(), { nodeStatus: setNodeStatus(EMPTY_NODE_STATUS, 's1', { loading: true }) })
    expect(container.querySelector('[class*="skeletonLine"]')).toBeTruthy()
    expect(queryByText('描述')).toBeNull()
  })

  it('狀態表 failed:顯示失敗文案與重試鈕', () => {
    const onRetryStop = vi.fn()
    const { container, getByText } = renderTimeline(node(), { nodeStatus: setNodeStatus(EMPTY_NODE_STATUS, 's1', { failed: true }), onRetryStop })
    expect(container.textContent).toContain('未能取得地點資料')
    getByText('重試').click()
    expect(onRetryStop).toHaveBeenCalledWith('s1')
  })

  it('沒有狀態:顯示真實名稱描述,不是失敗', () => {
    const { container } = renderTimeline(node())
    expect(container.textContent).toContain('描述')
    expect(container.textContent).not.toContain('未能取得地點資料')
  })

  it('站點照片由 placeId 經資料來源解析(節點上沒有照片)', async () => {
    const dataSource = {
      placeDetails: vi.fn(async () => ({ found: true, name: 'N', lat: 1, lng: 2, googlePhotoUrls: ['https://img/p1.jpg'] })),
      transitEstimate: vi.fn(),
    } as unknown as PlanAiDataSource
    const { container } = renderTimeline(node(), {}, dataSource)
    await waitFor(() => expect(container.querySelector('img[src="https://img/p1.jpg"]')).toBeTruthy())
  })
})
