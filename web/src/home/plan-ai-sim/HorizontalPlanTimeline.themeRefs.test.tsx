// HorizontalPlanTimeline 的主題點 chip 與候選卡小格:節點只存 id(attractions/places/farFromNext),
// 名稱/縮圖是執行時經資料存取層解析出來的;查詢完成前以 id 當名稱,farFromNext 的候選顯示警示徽章。
import { beforeAll, describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithPlanData } from '../../plan-core/planDataTestUtils'
import { HorizontalPlanTimeline } from './HorizontalPlanTimeline'
import { planAiFakeDataSource } from './planAiFakeDataSource'
import type { PlanNode } from '../../plan-core/planTimeline'
import { timelineOf } from '../../plan-core/planTimelineTestUtils'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

const noop = () => {}
const renderTimeline = (steps: PlanNode[]) =>
  renderWithPlanData(
    <HorizontalPlanTimeline
      timeline={timelineOf(steps)}
      selectedStopId={null}
      onSelectStop={noop}
      onOpenPhotos={noop}
    />,
    planAiFakeDataSource,
  )

describe('HorizontalPlanTimeline 子景點(只存 id,執行時解析)', () => {
  it('主題點:chip 先以 id 顯示,假資料來源回答後換成名稱', async () => {
    const { container } = renderTimeline([
      { id: 't', type: 'stop', name: '孔廟周邊', time: '09:00', duration: '停留 2h', day: 1, places: ['attr-confucius-temple', 'attr-confucius-temple-cultural-zone'] },
    ])
    expect(container.querySelectorAll('[class*="themeChildChip"]')).toHaveLength(2)
    expect(screen.getByText('attr-confucius-temple')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('孔廟商圈')).toBeTruthy())
    expect(screen.getByText('孔廟')).toBeTruthy()
  })

  it('候選卡:每個 id 一個小格,只有 farFromNext 清單內的候選有警示徽章', async () => {
    const { container } = renderTimeline([
      { id: 'c', type: 'stop', name: '午餐候選', time: '11:30', duration: '停留 1h', day: 1, candidateCards: true, places: ['attr-atang', 'attr-fuji-meatball'], farFromNext: ['attr-fuji-meatball'] },
    ])
    await waitFor(() => expect(screen.getByText('福記肉圓')).toBeTruthy())
    const tiles = container.querySelectorAll('[class*="candidateTile"]')
    expect(tiles).toHaveLength(2)
    const badge = '[aria-label*="距離下一站較遠"]'
    expect(screen.getByText('福記肉圓').closest('[class*="candidateTile"]')?.querySelector(badge)).toBeTruthy()
    expect(screen.getByText('阿堂鹹粥').closest('[class*="candidateTile"]')?.querySelector(badge)).toBeNull()
  })
})
