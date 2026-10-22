// placeDetailsCache:共用快取與 in-flight 去重。fetchPlaceDetailsCachedVia 的查詢函式由呼叫端傳入(光暈走資料存取層
// 實例),舊介面 fetchPlaceDetailsCached 依 usePublic 選端點後轉給它。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ClientConfig, GeoPlaceDetails } from '../api'

const internal = vi.fn()
const pub = vi.fn()
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchGeoPlaceDetails: (...a: unknown[]) => internal(...a),
    fetchPublicGeoPlaceDetails: (...a: unknown[]) => pub(...a),
  }
})

import {
  clearPlaceDetailsCacheForTests,
  fetchPlaceDetailsCached,
  fetchPlaceDetailsCachedVia,
  getCachedPlaceDetails,
} from './placeDetailsCache'

const cfg: ClientConfig = { baseURL: 'http://x', token: null }
const details = (name: string) => ({ name, googlePhotoUrls: [] }) as unknown as GeoPlaceDetails

beforeEach(() => {
  clearPlaceDetailsCacheForTests()
  internal.mockReset()
  pub.mockReset()
})

describe('fetchPlaceDetailsCachedVia', () => {
  it('用呼叫端傳入的查詢函式,結果進共用快取', async () => {
    const fetchDetails = vi.fn().mockResolvedValue(details('A'))
    await expect(fetchPlaceDetailsCachedVia(fetchDetails, 'p1')).resolves.toEqual(details('A'))
    expect(fetchDetails).toHaveBeenCalledWith('p1')
    expect(getCachedPlaceDetails('p1')).toEqual(details('A'))
  })

  it('同一個 placeId 同時查詢只送出一次;已快取後不再查', async () => {
    const fetchDetails = vi.fn().mockResolvedValue(details('A'))
    const [a, b] = await Promise.all([
      fetchPlaceDetailsCachedVia(fetchDetails, 'p1'),
      fetchPlaceDetailsCachedVia(fetchDetails, 'p1'),
    ])
    expect(a).toBe(b)
    await fetchPlaceDetailsCachedVia(fetchDetails, 'p1')
    expect(fetchDetails).toHaveBeenCalledTimes(1)
  })

  it('查詢失敗不快取,下次重新查', async () => {
    const fetchDetails = vi.fn().mockRejectedValueOnce(new Error('429')).mockResolvedValue(details('A'))
    await expect(fetchPlaceDetailsCachedVia(fetchDetails, 'p1')).rejects.toThrow('429')
    await expect(fetchPlaceDetailsCachedVia(fetchDetails, 'p1')).resolves.toEqual(details('A'))
    expect(fetchDetails).toHaveBeenCalledTimes(2)
  })
})

describe('fetchPlaceDetailsCached(舊介面)', () => {
  it('usePublic 決定打登入版或免登入版端點,與 Via 共用同一份快取', async () => {
    internal.mockResolvedValue(details('I'))
    pub.mockResolvedValue(details('P'))
    await fetchPlaceDetailsCached(cfg, 'a', false)
    await fetchPlaceDetailsCached(cfg, 'b', true)
    expect(internal).toHaveBeenCalledWith(cfg, 'a')
    expect(pub).toHaveBeenCalledWith(cfg, 'b')
    const fetchDetails = vi.fn()
    await expect(fetchPlaceDetailsCachedVia(fetchDetails, 'a')).resolves.toEqual(details('I'))
    expect(fetchDetails).not.toHaveBeenCalled()
  })
})
