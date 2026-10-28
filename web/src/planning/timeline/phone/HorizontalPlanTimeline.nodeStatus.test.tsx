// HorizontalPlanTimeline 讀節點狀態表(nodeStatus)與內部解析的站點照片。
import { describe, it, expect, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { renderWithPlanData as render } from '../../data/fixtures'
import { HorizontalPlanTimeline } from './HorizontalPlanTimeline'
import { EMPTY_NODE_STATUS, setNodeStatus } from '../status'
import type { PlanNode } from '../model'
import { timelineOf } from '../fixtures'
import type { PlanAiDataSource } from '../../data/source'
import styles from './HorizontalPlanTimeline.module.css'

// 狀態骨架(nodeStatus.loading 畫的 SkeletonBlock)——排除 FramedImage 下載中的掃光層(同為 data-skeleton="block",
// 但包在 FramedImage 的 [data-status] 外框裡)。
const statusSkeletons = (root: ParentNode) =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-skeleton="block"]')).filter((el) => !el.closest('[data-status]'))
// stopCard——站點卡(以刪除鈕以外的方式定位:卡片 role=button 且 class 含 styles.card、不是住宿/空天卡)。
const stopCard = (c: HTMLElement) => {
  const cards = Array.from(c.querySelectorAll<HTMLElement>(`.${styles.card}[role="button"]`)).filter(
    (el) => !el.classList.contains(styles.emptyDayCard) && !el.classList.contains(styles.lodgingCard),
  )
  expect(cards).toHaveLength(1)
  return cards[0]
}

// expectLoadingCard——查詢中的卡:照片橫幅位置是 photoBannerPlaceholder 內一塊骨架,站名/描述各一條骨架(卡片內層 .cardSlide 的直屬子元素),
// 沒有 FramedImage、沒有真實名稱/描述。
function expectLoadingCard(card: HTMLElement) {
  const banner = card.querySelector<HTMLElement>(`.${styles.photoBannerPlaceholder}`)!
  expect(banner).not.toBeNull()
  expect(statusSkeletons(banner)).toHaveLength(1)
  expect(Array.from(card.querySelector(`.${styles.cardSlide}`)!.children).filter((el) => el.getAttribute('data-skeleton') === 'block')).toHaveLength(2)
  expect(card.querySelector(`.${styles.photoBanner}, [data-status], img`)).toBeNull()
  expect(card.querySelector(`.${styles.name}, .${styles.desc}`)).toBeNull()
}

const noop = () => {}
const node = (over: Partial<PlanNode> = {}): PlanNode => ({ id: 's1', type: 'stop', name: '赤崁樓', desc: '描述', time: '09:00', day: 1, placeId: 'p1', lat: 1, lng: 2, ...over })

function renderTimeline(n: PlanNode, extra: Partial<React.ComponentProps<typeof HorizontalPlanTimeline>> = {}, dataSource?: PlanAiDataSource) {
  return render(<HorizontalPlanTimeline timeline={timelineOf([n])} selectedStopId={null} onSelectStop={noop} onOpenPhotos={noop} {...extra} />, dataSource)
}

describe('HorizontalPlanTimeline 讀節點狀態表', () => {
  it('狀態表 loading:名稱/描述換成骨架,不顯示真實名稱', () => {
    const { container, queryByText } = renderTimeline(node(), { nodeStatus: setNodeStatus(EMPTY_NODE_STATUS, 's1', { loading: true }) })
    // 橫幅一塊+站名/描述兩條,都是共用 SkeletonBlock
    expectLoadingCard(stopCard(container))
    expect(queryByText('描述')).toBeNull()
  })

  it('狀態表 loading 而資料來源查得到照片:仍是查詢中骨架,不是 FramedImage 的下載掃光', async () => {
    const dataSource = () =>
      ({
        placeDetails: vi.fn(async () => ({ found: true, name: 'N', lat: 1, lng: 2, googlePhotoUrls: ['https://img/p1.jpg'] })),
        transitEstimate: vi.fn(),
      }) as unknown as PlanAiDataSource
    const loadingDs = dataSource()
    const { container } = renderTimeline(node(), { nodeStatus: setNodeStatus(EMPTY_NODE_STATUS, 's1', { loading: true }) }, loadingDs)
    // 對照組:不在查詢中時同一份資料會畫出照片(確認解析確實會完成)
    const { container: idle } = renderTimeline(node(), {}, dataSource())
    await waitFor(() => expect(idle.querySelector('img[src="https://img/p1.jpg"]')).not.toBeNull())
    await waitFor(() => expect(loadingDs.placeDetails).toHaveBeenCalled())
    expectLoadingCard(stopCard(container))
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
