// HorizontalPlanTimeline 的主題點 chip 與候選卡小格:節點只存 id(attractions/places/farFromNext),
// 名稱/縮圖是執行時經資料存取層解析出來的;查詢完成前以 id 當名稱,farFromNext 的候選顯示警示徽章。
import { beforeAll, describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { dataSourceFromRefs, renderWithPlanData } from '../../data/fixtures'
import { HorizontalPlanTimeline } from './HorizontalPlanTimeline'
import { planAiFakeDataSource } from '../../data/fake'
import type { PlanNode, PlanThemeChild } from '../model'
import { timelineOf } from '../fixtures'

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

  it('候選小格縮圖:FramedImage 載入中掃光、載入完成淡入;網址失效時退回 thumbIcon 佔位,不顯示破圖', async () => {
    const refs = new Map<string, PlanThemeChild>([
      ['x1', { id: 'x1', name: '甲', thumbIcon: '🍜', googlePhotoUrls: ['https://img/x1.jpg'] }],
      ['x2', { id: 'x2', name: '乙', thumbIcon: '🍡', googlePhotoUrls: ['https://img/x2.jpg'] }],
    ])
    const { container } = renderWithPlanData(
      <HorizontalPlanTimeline
        timeline={timelineOf([{ id: 'c', type: 'stop', name: '候選', time: '11:30', duration: '停留 1h', day: 1, candidateCards: true, places: ['x1', 'x2'] }])}
        selectedStopId={null}
        onSelectStop={noop}
        onOpenPhotos={noop}
      />,
      dataSourceFromRefs(refs),
    )
    await waitFor(() => expect(container.querySelectorAll('[class*="candidateTile"] img')).toHaveLength(2))
    const tile = (name: string) => screen.getByText(name).closest('[class*="candidateTile"]')!
    const frame1 = tile('甲').querySelector<HTMLElement>('[data-status]')!
    expect(frame1.dataset.status).toBe('loading')
    expect(frame1.className).toContain('candidateThumb')
    fireEvent.load(tile('甲').querySelector('img')!)
    expect(frame1.dataset.status).toBe('loaded')
    fireEvent.error(tile('乙').querySelector('img')!)
    await waitFor(() => expect(tile('乙').querySelector('img')).toBeNull())
    // 退回原本的 thumbBg/thumbIcon 佔位格(不是 FramedImage 的失敗圖示)
    expect(tile('乙').querySelector('[class*="candidateThumb"]:not([data-status])')).toBeTruthy()
  })

  it('照片橫幅:FramedImage 鋪滿 .photoBanner,載入完成淡入;失效時退回 thumbIcon 佔位橫幅', async () => {
    const refs = new Map<string, PlanThemeChild>([['p1', { id: 'p1', placeId: 'p1', googlePhotoUrls: ['https://img/b.jpg'] }]])
    const { container } = renderWithPlanData(
      <HorizontalPlanTimeline
        timeline={timelineOf([{ id: 's', type: 'stop', name: '赤崁樓', time: '09:00', duration: '停留 1h', day: 1, placeId: 'p1', lat: 1, lng: 2, thumbIcon: '🏯' }])}
        selectedStopId={null}
        onSelectStop={noop}
        onOpenPhotos={noop}
      />,
      dataSourceFromRefs(refs),
    )
    await waitFor(() => expect(container.querySelector('[class*="photoBanner"] img')).toBeTruthy())
    const frame = container.querySelector<HTMLElement>('[class*="photoBanner"] [data-status]')!
    expect(frame.dataset.status).toBe('loading')
    fireEvent.load(container.querySelector('[class*="photoBanner"] img')!)
    expect(frame.dataset.status).toBe('loaded')
  })

  it('照片橫幅失效:退回 thumbIcon 佔位橫幅', async () => {
    const refs = new Map<string, PlanThemeChild>([['p1', { id: 'p1', placeId: 'p1', googlePhotoUrls: ['https://img/b.jpg'] }]])
    const { container } = renderWithPlanData(
      <HorizontalPlanTimeline
        timeline={timelineOf([{ id: 's', type: 'stop', name: '赤崁樓', time: '09:00', duration: '停留 1h', day: 1, placeId: 'p1', lat: 1, lng: 2, thumbIcon: '🏯' }])}
        selectedStopId={null}
        onSelectStop={noop}
        onOpenPhotos={noop}
      />,
      dataSourceFromRefs(refs),
    )
    await waitFor(() => expect(container.querySelector('[class*="photoBanner"] img')).toBeTruthy())
    fireEvent.error(container.querySelector('[class*="photoBanner"] img')!)
    await waitFor(() => expect(container.querySelector('img')).toBeNull())
    expect(container.querySelector('[class*="photoBannerPlaceholder"]')?.textContent).toBe('🏯')
  })
})
