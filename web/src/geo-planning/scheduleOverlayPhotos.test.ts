// scheduleOverlayPhotos:已快取的立刻套用、沒快取的依序錯峰查詢、取消後不再發出/套用。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GeoPlaceDetails } from '../api'
import { clearPlaceDetailsCacheForTests, fetchPlaceDetailsCachedVia } from './placeDetailsCache'
import { scheduleOverlayPhotos } from './scheduleOverlayPhotos'

const details = (urls: string[]) => ({ name: 'x', googlePhotoUrls: urls }) as unknown as GeoPlaceDetails

beforeEach(() => {
  clearPlaceDetailsCacheForTests()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('scheduleOverlayPhotos', () => {
  it('已在共用快取的:立刻套用,不查詢', async () => {
    await fetchPlaceDetailsCachedVia(() => Promise.resolve(details(['c'])), 'p1')
    const fetchDetails = vi.fn()
    const setA = vi.fn()
    scheduleOverlayPhotos([{ placeId: 'p1', setPhotoUrls: setA }], fetchDetails)
    expect(setA).toHaveBeenCalledWith(['c'])
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchDetails).not.toHaveBeenCalled()
  })

  it('沒快取的:依序錯峰(每個間隔 250ms)發出查詢並套用結果', async () => {
    const fetchDetails = vi.fn((id: string) => Promise.resolve(details([`url-${id}`])))
    const setA = vi.fn()
    const setB = vi.fn()
    scheduleOverlayPhotos(
      [
        { placeId: 'a', setPhotoUrls: setA },
        { placeId: 'b', setPhotoUrls: setB },
      ],
      fetchDetails,
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchDetails).toHaveBeenCalledTimes(1)
    expect(setA).toHaveBeenCalledWith(['url-a'])
    expect(setB).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(250)
    expect(fetchDetails).toHaveBeenCalledTimes(2)
    expect(setB).toHaveBeenCalledWith(['url-b'])
  })

  it('取消後:尚未發出的查詢不再發出', async () => {
    const fetchDetails = vi.fn((id: string) => Promise.resolve(details([id])))
    const cancel = scheduleOverlayPhotos(
      [
        { placeId: 'a', setPhotoUrls: vi.fn() },
        { placeId: 'b', setPhotoUrls: vi.fn() },
      ],
      fetchDetails,
    )
    await vi.advanceTimersByTimeAsync(0)
    cancel()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchDetails).toHaveBeenCalledTimes(1)
  })

  it('查詢失敗:靜默維持沒有照片,不丟例外', async () => {
    const fetchDetails = vi.fn(() => Promise.reject(new Error('429')))
    const set = vi.fn()
    scheduleOverlayPhotos([{ placeId: 'a', setPhotoUrls: set }], fetchDetails)
    await vi.advanceTimersByTimeAsync(10)
    expect(set).not.toHaveBeenCalled()
  })
})
