// PlanTimelineView 讀節點狀態表(nodeStatus)與解析結果(PlanDataProvider 的 store):查詢中、失敗重試、移除淡出、照片。
import { describe, it, expect, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { dataSourceFromRefs, renderWithPlanData as render } from '../data/fixtures'
import { PlanTimelineView } from './PlanTimelineView'
import { EMPTY_NODE_STATUS, setNodeStatus } from './status'
import type { PlanNode, PlanThemeChild, PlanTimeline } from './model'

const stop = (over: Partial<PlanNode> = {}): PlanNode => ({ id: 's', type: 'stop', name: '赤崁樓', time: '10:00', duration: '1 小時', kind: '景點', desc: '描述', placeId: 'p1', lat: 1, lng: 2, ...over })
const tl = (n: PlanNode): PlanTimeline => ({ days: [{ id: 'd', nodes: [n] }] })

// resolved——站點 placeId 的解析結果(照片等):視圖向 PlanDataProvider 的 store 取,用回答這些 id 的資料來源提供。
function renderView(node: PlanNode, extra: Partial<React.ComponentProps<typeof PlanTimelineView>> = {}, resolved?: ReadonlyMap<string, PlanThemeChild>) {
  return render(
    <PlanTimelineView
      timeline={tl(node)}
      isThinking={false}
      emptyStateMessage=""
      selectedStopId={null}
      showJumpPill={false}
      onJumpToLatest={() => {}}
      onPanToStop={() => {}}
      onOpenPhotos={() => {}}
      mountedIdsRef={{ current: new Set() }}
      {...extra}
    />,
    resolved ? dataSourceFromRefs(resolved) : undefined,
  )
}

describe('PlanTimelineView 讀節點狀態表', () => {
  it('狀態表 loading:顯示查詢中轉圈與標籤', () => {
    const { container } = renderView(stop(), { nodeStatus: setNodeStatus(EMPTY_NODE_STATUS, 's', { loading: true }) })
    expect(container.querySelector('[class*="thumbSpinner"]')).toBeTruthy()
    expect(container.textContent).toContain('查詢地點中')
  })

  it('狀態表 failed:顯示錯誤文字與重試鈕,點重試帶節點 id', () => {
    const onRetryStop = vi.fn()
    const { container, getByText } = renderView(stop(), { nodeStatus: setNodeStatus(EMPTY_NODE_STATUS, 's', { failed: true }), onRetryStop })
    expect(container.textContent).toContain('未能取得地點資料')
    getByText('重試').click()
    expect(onRetryStop).toHaveBeenCalledWith('s')
  })

  it('沒有狀態表、有 placeId 沒座標:重整後的孤兒節點仍顯示失敗(資料本身判斷)', () => {
    const { container } = renderView(stop({ lat: undefined, lng: undefined, name: '查詢中…' }))
    expect(container.textContent).toContain('未能取得地點資料')
  })

  it('狀態表 removing:套淡出 class', () => {
    const { container } = renderView(stop(), { nodeStatus: setNodeStatus(EMPTY_NODE_STATUS, 's', { removing: true }) })
    expect(container.querySelector('[class*="removingFade"]')).toBeTruthy()
    const { container: c2 } = renderView(stop())
    expect(c2.querySelector('[class*="removingFade"]')).toBeFalsy()
  })

  it('照片來自 store 的解析結果(以 placeId 為 key),節點上沒有照片', async () => {
    const resolved = new Map([['p1', { id: 'p1', placeId: 'p1', googlePhotoUrls: ['https://img/a.jpg', 'https://img/b.jpg'] }]])
    const { container } = renderView(stop(), {}, resolved)
    await waitFor(() => expect(container.querySelector('img')).toBeTruthy())
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://img/a.jpg')
    expect(container.textContent).toContain('2')
    const { container: none } = renderView(stop())
    expect(none.querySelector('img')).toBeFalsy()
  })
})
