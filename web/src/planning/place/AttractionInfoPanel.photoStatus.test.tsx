// AttractionInfoPanel 的照片佔位:placeDetails 查詢中才掃光;查詢失敗(或查到
// 沒有照片)是靜態佔位——不再因為「0 張照片」一律掃光而永遠像在載入。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { AttractionInfoPanel } from './AttractionInfoPanel'
import carouselStyles from './PhotoCarousel.module.css'
import { clearPlaceDetailsCacheForTests } from '../data/cache'
import type { PlanAiDataSource } from '../data/source'
import type { GeoAttraction } from '../../api'

class FakeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}
vi.stubGlobal('IntersectionObserver', FakeObserver)
vi.stubGlobal('ResizeObserver', FakeObserver)
window.matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: true,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})) as unknown as typeof window.matchMedia

beforeEach(() => clearPlaceDetailsCacheForTests())

const attraction = { id: 'a1', name: '清水寺', placeId: 'p-kiyomizu', lat: 35, lng: 135.78 } as GeoAttraction
const frameOf = (container: HTMLElement) =>
  container.querySelector(`.${carouselStyles.wrap} > [data-status]`) as HTMLElement

describe('AttractionInfoPanel 照片查詢狀態', () => {
  it('查詢中掃光;失敗後同一個外框改成靜態佔位', async () => {
    let reject: (e: Error) => void = () => {}
    const ds = { geoPlaceDetails: () => new Promise<never>((_, r) => { reject = r }) } as unknown as PlanAiDataSource
    const { container } = render(<AttractionInfoPanel attraction={attraction} dataSource={ds} onClose={() => {}} />)
    const frame = frameOf(container)
    expect(frame.dataset.status).toBe('loading')
    await act(async () => reject(new Error('boom')))
    expect(frameOf(container)).toBe(frame)
    expect(frame.dataset.status).toBe('idle')
  })

  it('查到但沒有照片:靜態佔位', async () => {
    const ds = {
      geoPlaceDetails: () => Promise.resolve({ name: '清水寺', address: 'x', lat: 35, lng: 135.78, googlePhotoUrls: [] }),
    } as unknown as PlanAiDataSource
    const { container } = render(<AttractionInfoPanel attraction={attraction} dataSource={ds} onClose={() => {}} />)
    await act(async () => {})
    expect(frameOf(container).dataset.status).toBe('idle')
  })

  it('沒有 placeId:一開始就是靜態佔位', () => {
    const ds = {} as PlanAiDataSource
    const { container } = render(
      <AttractionInfoPanel attraction={{ ...attraction, placeId: undefined }} dataSource={ds} onClose={() => {}} />,
    )
    expect(frameOf(container).dataset.status).toBe('idle')
  })
})
