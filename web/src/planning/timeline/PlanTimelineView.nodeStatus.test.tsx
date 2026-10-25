// PlanTimelineView 讀節點狀態表(nodeStatus)與解析結果(PlanDataProvider 的 store):查詢中、失敗重試、移除淡出、照片。
import { describe, it, expect, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { dataSourceFromRefs, renderWithPlanData as render } from '../data/fixtures'
import { PlanTimelineView } from './PlanTimelineView'
import { EMPTY_NODE_STATUS, setNodeStatus } from './status'
import type { PlanNode, PlanThemeChild, PlanTimeline } from './model'
import styles from './PlanTimelineView.module.css'

// 狀態骨架(nodeStatus.loading 畫的 SkeletonBlock)——排除 FramedImage 下載中的掃光層:那也是 data-skeleton="block",
// 但包在 FramedImage 的 [data-status] 外框裡,混在一起就分不出「查詢中」與「照片下載中」。
const statusSkeletons = (root: ParentNode) =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-skeleton="block"]')).filter((el) => !el.closest('[data-status]'))

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
  it('狀態表 loading:縮圖顯示查詢中骨架與標籤', () => {
    const { container } = renderView(stop(), { nodeStatus: setNodeStatus(EMPTY_NODE_STATUS, 's', { loading: true }) })
    const thumb = container.querySelector<HTMLElement>(`.${styles.stopThumb}`)!
    expect(statusSkeletons(thumb)).toHaveLength(1)
    expect(thumb.querySelector('[data-status]')).toBeNull()
    expect(container.querySelector(`.${styles.stopMeta} .${styles.loadingTag}`)?.textContent).toBe('查詢地點中…')
  })

  it('狀態表 loading 而解析結果已有照片:縮圖仍是查詢中骨架,不是 FramedImage 的下載掃光', async () => {
    const resolved = new Map([['p1', { id: 'p1', placeId: 'p1', googlePhotoUrls: ['https://img/a.jpg'] }]])
    const { container } = renderView(stop(), { nodeStatus: setNodeStatus(EMPTY_NODE_STATUS, 's', { loading: true }) }, resolved)
    // 對照組:同樣的資料不在查詢中時會畫出照片(確認解析確實完成,下面的「沒有照片」不是因為還沒解析)
    const { container: idle } = renderView(stop(), {}, resolved)
    await waitFor(() => expect(idle.querySelector('img')).not.toBeNull())
    const thumb = container.querySelector<HTMLElement>(`.${styles.stopThumb}`)!
    expect(statusSkeletons(thumb)).toHaveLength(1)
    expect(thumb.querySelector('[data-status], img')).toBeNull()
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
    expect(container.querySelector('[data-tl-node]')?.classList.contains(styles.removingFade)).toBe(true)
    const { container: c2 } = renderView(stop())
    expect(c2.querySelector('[data-tl-node]')?.classList.contains(styles.removingFade)).toBe(false)
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
