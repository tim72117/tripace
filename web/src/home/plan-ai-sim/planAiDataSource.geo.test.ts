// 地圖與規劃用到的資料存取層方法(photoAssets、geoPlaceDetails、placePhoto、placeText、geocode、
// attractionsByCity、attractionByID):登入版打 /internal 系列、訪客版打免登入的 /public 系列,由實例決定端點;
// 只有登入端點的方法(placePhoto、placeText、geocode)訪客版不實作。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = {
  internalNearby: vi.fn(),
  internalPhotos: vi.fn(),
  internalDetails: vi.fn(),
  publicPhotos: vi.fn(),
  publicDetails: vi.fn(),
  internalPhoto: vi.fn(),
  internalText: vi.fn(),
  internalGeocode: vi.fn(),
  internalCity: vi.fn(),
  publicCity: vi.fn(),
  publicById: vi.fn(),
}
vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>()
  return {
    ...actual,
    fetchGeoAttractionsOnlyNearby: (...a: unknown[]) => m.internalNearby(...a),
    fetchGeoPlacePhotoAssets: (...a: unknown[]) => m.internalPhotos(...a),
    fetchGeoPlaceDetails: (...a: unknown[]) => m.internalDetails(...a),
    fetchPublicGeoPlacePhotoAssets: (...a: unknown[]) => m.publicPhotos(...a),
    fetchPublicGeoPlaceDetails: (...a: unknown[]) => m.publicDetails(...a),
    fetchGeoPlacePhoto: (...a: unknown[]) => m.internalPhoto(...a),
    fetchGeoPlaceText: (...a: unknown[]) => m.internalText(...a),
    fetchGeoGeocode: (...a: unknown[]) => m.internalGeocode(...a),
    fetchGeoAttractions: (...a: unknown[]) => m.internalCity(...a),
    fetchPublicGeoAttractions: (...a: unknown[]) => m.publicCity(...a),
    fetchPublicGeoAttractionByID: (...a: unknown[]) => m.publicById(...a),
  }
})

import { createPlanAiApiDataSource, getPlanAiApiDataSource } from './planAiApiDataSource'
import { createPlanAiPublicDataSource, getPlanAiPublicDataSource } from './planAiPublicDataSource'

beforeEach(() => Object.values(m).forEach((f) => f.mockReset()))

describe('登入版資料存取層(createPlanAiApiDataSource)', () => {
  const cfg = { baseURL: 'http://x', token: 't' }
  it('geoPlaceDetails / photoAssets 打 /internal 系列', async () => {
    m.internalDetails.mockResolvedValue({ name: 'D' })
    m.internalPhotos.mockResolvedValue({ googlePhotoUrls: ['u'] })
    const ds = createPlanAiApiDataSource(cfg)
    await expect(ds.geoPlaceDetails!('p1')).resolves.toEqual({ name: 'D' })
    await expect(ds.photoAssets!('p1')).resolves.toEqual({ googlePhotoUrls: ['u'] })
    expect(m.internalDetails).toHaveBeenCalledWith(cfg, 'p1')
    expect(m.internalPhotos).toHaveBeenCalledWith(cfg, 'p1')
    expect(m.publicDetails).not.toHaveBeenCalled()
  })
})

describe('訪客版資料存取層(createPlanAiPublicDataSource)', () => {
  it('geoPlaceDetails / photoAssets 打 /public 系列', async () => {
    m.publicDetails.mockResolvedValue({ name: 'D' })
    m.publicPhotos.mockResolvedValue({ googlePhotoUrls: [] })
    const ds = createPlanAiPublicDataSource('http://x')
    await ds.geoPlaceDetails!('p1')
    await ds.photoAssets!('p1')
    expect(m.publicDetails).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'http://x' }), 'p1')
    expect(m.publicPhotos).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'http://x' }), 'p1')
    expect(m.internalDetails).not.toHaveBeenCalled()
  })
})

describe('2026-10 補進資料存取層的方法', () => {
  const cfg = { baseURL: 'http://x', token: 't' }

  it('登入版:placePhoto、placeText、geocode 轉給對應的 /internal 函式', async () => {
    m.internalPhoto.mockResolvedValue({ googlePhotoUrls: ['p'] })
    m.internalText.mockResolvedValue({ name: 'T' })
    m.internalGeocode.mockResolvedValue({ query: 'q', candidates: [] })
    const ds = createPlanAiApiDataSource(cfg)
    await ds.placePhoto!('p1', 'N')
    await ds.placeText!('p1')
    await ds.geocode!('京都', { lat: 1, lng: 2 }, 'restrict', 1500)
    expect(m.internalPhoto).toHaveBeenCalledWith(cfg, 'p1', 'N')
    expect(m.internalText).toHaveBeenCalledWith(cfg, 'p1')
    expect(m.internalGeocode).toHaveBeenCalledWith(cfg, '京都', { lat: 1, lng: 2 }, 'restrict', 1500)
  })

  it('訪客版不實作只有登入端點的方法', () => {
    const ds = createPlanAiPublicDataSource('http://x')
    expect(ds.placePhoto).toBeUndefined()
    expect(ds.placeText).toBeUndefined()
    expect(ds.geocode).toBeUndefined()
  })

  it('attractionsByCity:登入版打 /internal、訪客版打 /public,都只回傳 attractions 陣列', async () => {
    m.internalCity.mockResolvedValue({ city: 'c', attractions: [{ name: 'A' }], hotels: [] })
    m.publicCity.mockResolvedValue({ attractions: [{ name: 'B' }] })
    await expect(createPlanAiApiDataSource(cfg).attractionsByCity!('台南')).resolves.toEqual([{ name: 'A' }])
    await expect(createPlanAiPublicDataSource('http://x').attractionsByCity!('台南')).resolves.toEqual([{ name: 'B' }])
    expect(m.internalCity).toHaveBeenCalledWith(cfg, '台南')
    expect(m.publicCity).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'http://x' }), '台南')
  })

  it('attractionByID:兩種實例都打公開端點', async () => {
    m.publicById.mockResolvedValue({ id: 'i', name: 'N' })
    await createPlanAiApiDataSource(cfg).attractionByID!('i')
    await createPlanAiPublicDataSource('http://x').attractionByID!('i')
    expect(m.publicById).toHaveBeenCalledTimes(2)
  })
})

describe('共用實例(getPlanAiApiDataSource / getPlanAiPublicDataSource)', () => {
  it('同一組 baseURL + token 回傳同一個登入版實例;不同 token 是不同實例', () => {
    const a = getPlanAiApiDataSource({ baseURL: 'http://shared', token: 't1' })
    expect(getPlanAiApiDataSource({ baseURL: 'http://shared', token: 't1' })).toBe(a)
    expect(getPlanAiApiDataSource({ baseURL: 'http://shared', token: 't2' })).not.toBe(a)
    expect(getPlanAiApiDataSource({ baseURL: 'http://other', token: 't1' })).not.toBe(a)
  })

  it('同一個 baseURL 回傳同一個訪客版實例', () => {
    const a = getPlanAiPublicDataSource('http://shared')
    expect(getPlanAiPublicDataSource('http://shared')).toBe(a)
    expect(getPlanAiPublicDataSource('http://other')).not.toBe(a)
  })
})
