// AttractionInfoPanel 的「周邊同標籤地點」:只有資料庫景點(有 id)且資料存取層實作
// attractionTagNeighbors 時才顯示可點擊的標籤;點標籤查詢並列出結果,清單項目沿用
// 附近景點的 onSelectNearby/onHoverNearby。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, fireEvent, screen } from '@testing-library/react'
import { AttractionInfoPanel } from './AttractionInfoPanel'
import { clearPlaceDetailsCacheForTests } from '../data/cache'
import type { PlanAiDataSource } from '../data/source'
import type { GeoAttraction, GeoAttractionTagNeighbor } from '../../api'

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

const attraction = {
  id: 'a1',
  name: '清水寺',
  lat: 34.9948,
  lng: 135.785,
  isTheme: true,
  tags: ['寺廟', '世界遺產'],
} as GeoAttraction
const neighbor = {
  id: 'a2',
  name: '地主神社',
  lat: 34.9951,
  lng: 135.7855,
  isTheme: false,
  distanceKm: 0.1,
} as GeoAttractionTagNeighbor

describe('AttractionInfoPanel 周邊同標籤地點', () => {
  it('資料存取層沒有實作 attractionTagNeighbors 時不顯示標籤', () => {
    render(<AttractionInfoPanel attraction={attraction} dataSource={{} as PlanAiDataSource} onClose={() => {}} />)
    expect(screen.queryByText('#寺廟')).toBeNull()
  })

  it('點標籤查詢並列出結果,點擊與 hover 沿用附近景點的回呼', async () => {
    const query = vi.fn().mockResolvedValue([neighbor])
    const ds = { attractionTagNeighbors: query } as unknown as PlanAiDataSource
    const onSelect = vi.fn()
    const onHover = vi.fn()
    render(
      <AttractionInfoPanel
        attraction={attraction}
        dataSource={ds}
        onClose={() => {}}
        onSelectNearby={onSelect}
        onHoverNearby={onHover}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByText('#寺廟'))
    })
    expect(query).toHaveBeenCalledWith('a1', '寺廟')
    const item = screen.getByText('地主神社')
    expect(screen.getByText('0.1 公里')).toBeTruthy()
    fireEvent.mouseEnter(item.closest('button')!)
    expect(onHover).toHaveBeenLastCalledWith(neighbor)
    fireEvent.click(item)
    expect(onSelect).toHaveBeenCalledWith(neighbor)
  })

  it('查無結果顯示空狀態;再點一次同一個標籤收合', async () => {
    const ds = { attractionTagNeighbors: vi.fn().mockResolvedValue([]) } as unknown as PlanAiDataSource
    render(<AttractionInfoPanel attraction={attraction} dataSource={ds} onClose={() => {}} />)
    await act(async () => {
      fireEvent.click(screen.getByText('#世界遺產'))
    })
    expect(screen.getByText('附近沒有其他「世界遺產」地點。')).toBeTruthy()
    fireEvent.click(screen.getByText('#世界遺產'))
    expect(screen.queryByText('附近沒有其他「世界遺產」地點。')).toBeNull()
  })
})
