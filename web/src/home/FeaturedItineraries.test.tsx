// 首頁精選行程:資料來源 useListItineraries(mock),驗證前 3 筆、骨架、整節隱藏、連結與點擊事件。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { SampleItinerary } from '../itineraries/types'

let state: { items: SampleItinerary[]; loading: boolean } = { items: [], loading: false }
vi.mock('../itineraries/useListItineraries', () => ({ useListItineraries: () => state }))
const track = vi.fn()
vi.mock('../analytics', () => ({ trackEvent: (...a: unknown[]) => track(...a) }))

import { FeaturedItineraries, FEATURED_MAX } from './FeaturedItineraries'

const it_ = (id: string, over: Partial<SampleItinerary> = {}): SampleItinerary => ({
  id,
  title: `行程 ${id}`,
  region: '日本・北海道',
  categories: [],
  summary: `簡介 ${id}`,
  addedAt: '2026-10-01',
  timeline: {
    days: [
      { id: `${id}-d1`, nodes: [{ id: `${id}-a`, type: 'stop', name: 'A' }, { id: `${id}-b`, type: 'stop', name: 'B' }] },
      { id: `${id}-d2`, nodes: [{ id: `${id}-c`, type: 'stop', name: 'C' }] },
    ],
  },
  ...over,
})

beforeEach(() => {
  track.mockClear()
  state = { items: [], loading: false }
})

describe('FeaturedItineraries', () => {
  it('載入完成且沒有行程:整節不畫', () => {
    const { container } = render(<FeaturedItineraries />)
    expect(container).toBeEmptyDOMElement()
  })

  it('載入中且沒有行程:畫一列骨架,「載入中」只由外層容器宣告一次(單一 role=status),沒有連結項目', () => {
    state = { items: [], loading: true }
    const { container } = render(<FeaturedItineraries />)
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status', { name: '精選行程載入中' }).getAttribute('aria-busy')).toBe('true')
    expect(container.querySelectorAll('.featured-itinerary-skeleton')).toHaveLength(1)
    expect(container.querySelector('a.destination-item')).toBeNull()
    expect(container.querySelector('#featured-itineraries')).not.toBeNull()
  })

  it('最多顯示 FEATURED_MAX 筆,依傳入順序;每筆連到 /itineraries/{id},顯示標題、天數與站數、簡介', () => {
    state = { items: ['a', 'b', 'c', 'd'].map((id) => it_(id)), loading: false }
    const { container } = render(<FeaturedItineraries />)
    const links = [...container.querySelectorAll<HTMLAnchorElement>('a.destination-item')]
    expect(links).toHaveLength(FEATURED_MAX)
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/itineraries/a', '/itineraries/b', '/itineraries/c'])
    expect(links[0].textContent).toContain('行程 a')
    expect(links[0].textContent).toContain('2 天 · 3 站')
    expect(links[0].textContent).toContain('簡介 a')
  })

  it('「看全部精選行程」連到 /itineraries,點擊與項目點擊各自送出事件', () => {
    state = { items: [it_('a')], loading: false }
    const { container } = render(<FeaturedItineraries />)
    const all = screen.getByRole('link', { name: '看全部精選行程' })
    expect(all.getAttribute('href')).toBe('/itineraries')
    fireEvent.click(container.querySelector('a.destination-item')!)
    expect(track).toHaveBeenCalledWith('landing_featured_itinerary_click', { itinerary: 'a' })
    fireEvent.click(all)
    expect(track).toHaveBeenCalledWith('landing_featured_itinerary_all_click')
  })

  it('已有資料時即使仍在載入也顯示內容(不退回骨架)', () => {
    state = { items: [it_('a')], loading: true }
    const { container } = render(<FeaturedItineraries />)
    expect(container.querySelector('a.destination-item')).not.toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
