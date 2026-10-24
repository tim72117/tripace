// placeDetailsDedupe 契約測試——規則與理由見 placeDetailsDedupe.ts 檔頭。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const apiMock = vi.hoisted(() => ({
  fetchPlanAiPlaceDetailsAny: vi.fn(),
  fetchGeoPlacePhotoAssets: vi.fn(),
  fetchPublicGeoPlacePhotoAssets: vi.fn(),
  fetchPlanAiTransitEstimate: vi.fn(),
  fetchPlanAiPlaceSearch: vi.fn(),
  fetchPlanAiAttractionSearch: vi.fn(),
}))
vi.mock('../../api', () => apiMock)

import {
  PlaceDetailsDedupe,
  PLACE_DETAILS_TTL_MS,
  resetSharedPlaceDetailsDedupe,
} from './placeDetailsDedupe'
import { createPlanAiApiDataSource } from './planAiApiDataSource'
import { createPlanAiPublicDataSource } from './planAiPublicDataSource'

type Details = { found: boolean; name?: string; googlePhotoUrls?: string[]; photoRefreshPending?: boolean; lat?: number; lng?: number }
// 會被記憶的結果必須帶可用座標(規則第 6 點),測試資料一律附上。
const COORDS = { lat: 25, lng: 121 }

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers()
  resetSharedPlaceDetailsDedupe()
  Object.values(apiMock).forEach((f) => f.mockReset())
})
afterEach(() => {
  vi.useRealTimers()
})

describe('PlaceDetailsDedupe(隔離)', () => {
  it('進行中請求共用:同 placeId 並發只發 1 次', async () => {
    const d = new PlaceDetailsDedupe()
    const def = deferred<Details>()
    const fetcher = vi.fn(() => def.promise)
    const a = d.get('p1', fetcher)
    const b = d.get('p1', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    def.resolve({ found: true, name: 'X' })
    expect(await a).toBe(await b)
  })

  it('已完成結果記憶:第二次不發請求', async () => {
    const d = new PlaceDetailsDedupe()
    const fetcher = vi.fn(async () => ({ found: true, name: 'X', ...COORDS }))
    await d.get('p1', fetcher)
    const r = await d.get('p1', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(r.name).toBe('X')
  })

  it('失敗不記憶:reject 後重試會真的重發,且能成功', async () => {
    const d = new PlaceDetailsDedupe()
    const fetcher = vi.fn<() => Promise<Details>>()
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce({ found: true, name: 'OK' })
    await expect(d.get('p1', fetcher)).rejects.toThrow('429')
    const r = await d.get('p1', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(r.name).toBe('OK')
  })

  it('失敗時並發的等待者都收到同一個錯誤,之後不殘留 inflight', async () => {
    const d = new PlaceDetailsDedupe()
    const def = deferred<Details>()
    const fetcher = vi.fn(() => def.promise)
    const a = d.get('p1', fetcher)
    const b = d.get('p1', fetcher)
    def.reject(new Error('boom'))
    await expect(a).rejects.toThrow('boom')
    await expect(b).rejects.toThrow('boom')
    const f2 = vi.fn(async () => ({ found: true, ...COORDS }))
    await d.get('p1', f2)
    expect(f2).toHaveBeenCalledTimes(1)
  })

  it('photoRefreshPending:true 只做進行中共用,完成後不記憶(下次查詢拿得到新照片)', async () => {
    const d = new PlaceDetailsDedupe()
    const def = deferred<Details>()
    const f1 = vi.fn(() => def.promise)
    const a = d.get('p1', f1)
    const b = d.get('p1', f1)
    expect(f1).toHaveBeenCalledTimes(1) // 進行中仍共用
    def.resolve({ found: true, googlePhotoUrls: [], photoRefreshPending: true })
    await Promise.all([a, b])

    const f2 = vi.fn(async (): Promise<Details> => ({ found: true, googlePhotoUrls: ['u.jpg'], ...COORDS }))
    const r = await d.get('p1', f2)
    expect(f2).toHaveBeenCalledTimes(1) // 重新發請求
    expect(r.googlePhotoUrls).toEqual(['u.jpg'])
    // 拿到沒有 pending 的結果後才記憶
    await d.get('p1', f2)
    expect(f2).toHaveBeenCalledTimes(1)
  })

  it('photoRefreshPending:false 照常記憶', async () => {
    const d = new PlaceDetailsDedupe()
    const f = vi.fn(async (): Promise<Details> => ({ found: true, photoRefreshPending: false, ...COORDS }))
    await d.get('p1', f)
    await d.get('p1', f)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('found:false 不記憶', async () => {
    const d = new PlaceDetailsDedupe()
    const f = vi.fn(async (): Promise<Details> => ({ found: false }))
    await d.get('p1', f)
    await d.get('p1', f)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('found:true 但沒有可用座標(lat/lng 缺)不記憶:重試能真的重發、拿到有座標的結果', async () => {
    const d = new PlaceDetailsDedupe()
    const f = vi.fn<() => Promise<Details & { lat?: number; lng?: number }>>()
      .mockResolvedValueOnce({ found: true, name: 'X' })
      .mockResolvedValueOnce({ found: true, name: 'X', lat: 1 })
      .mockResolvedValueOnce({ found: true, name: 'X', lat: 1, lng: 2 })
    expect((await d.get('p1', f)).lat).toBeUndefined()
    expect((await d.get('p1', f)).lng).toBeUndefined() // 只有 lat 也不算可用座標
    const r = await d.get('p1', f)
    expect(f).toHaveBeenCalledTimes(3)
    expect(r).toMatchObject({ lat: 1, lng: 2 })
    // 有座標之後才記憶
    await d.get('p1', f)
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('不同 placeId 互不影響', async () => {
    const d = new PlaceDetailsDedupe()
    const f = vi.fn(async () => ({ found: true, ...COORDS }))
    await Promise.all([d.get('a', f), d.get('b', f)])
    expect(f).toHaveBeenCalledTimes(2)
    await Promise.all([d.get('a', f), d.get('b', f)])
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('上限淘汰:超過 maxEntries 淘汰最舊的', async () => {
    const d = new PlaceDetailsDedupe({ maxEntries: 2 })
    const f = vi.fn(async () => ({ found: true, ...COORDS }))
    await d.get('a', f)
    await d.get('b', f)
    await d.get('c', f) // 淘汰 a
    expect(f).toHaveBeenCalledTimes(3)
    await d.get('b', f)
    await d.get('c', f)
    expect(f).toHaveBeenCalledTimes(3) // b、c 仍在
    await d.get('a', f)
    expect(f).toHaveBeenCalledTimes(4) // a 被淘汰,重發
  })

  it('有效期過期後重發', async () => {
    const d = new PlaceDetailsDedupe()
    const f = vi.fn(async () => ({ found: true, ...COORDS }))
    await d.get('a', f)
    vi.advanceTimersByTime(PLACE_DETAILS_TTL_MS - 1)
    await d.get('a', f)
    expect(f).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2)
    await d.get('a', f)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('clear() 清掉記憶與進行中;clear 前發出的請求完成後不寫回', async () => {
    const d = new PlaceDetailsDedupe()
    const f = vi.fn(async () => ({ found: true, ...COORDS }))
    await d.get('a', f)
    d.clear()
    await d.get('a', f)
    expect(f).toHaveBeenCalledTimes(2)

    const def = deferred<Details>()
    const slow = vi.fn(() => def.promise)
    const p = d.get('z', slow)
    d.clear()
    def.resolve({ found: true })
    await p
    const f3 = vi.fn(async () => ({ found: true, ...COORDS }))
    await d.get('z', f3)
    expect(f3).toHaveBeenCalledTimes(1)
  })
})

describe('資料來源工廠(隔離)', () => {
  it('其他方法直接透傳,不去重', async () => {
    apiMock.fetchGeoPlacePhotoAssets.mockResolvedValue({ googlePhotoUrls: [] })
    apiMock.fetchPlanAiTransitEstimate.mockResolvedValue({ mode: 'w', icon: '', minutes: 1, distance: '' })
    apiMock.fetchPlanAiPlaceSearch.mockResolvedValue({ found: false })
    const ds = createPlanAiApiDataSource({ baseURL: 'http://x', token: 't' })
    await ds.photoAssets!('p1')
    await ds.photoAssets!('p1')
    await ds.transitEstimate({ lat: 0, lng: 0 }, { lat: 1, lng: 1 })
    await ds.transitEstimate({ lat: 0, lng: 0 }, { lat: 1, lng: 1 })
    await ds.searchNearby!({ query: 'q' })
    await ds.searchNearby!({ query: 'q' })
    expect(apiMock.fetchGeoPlacePhotoAssets).toHaveBeenCalledTimes(2)
    expect(apiMock.fetchPlanAiTransitEstimate).toHaveBeenCalledTimes(2)
    expect(apiMock.fetchPlanAiPlaceSearch).toHaveBeenCalledTimes(2)
  })

  it('不同 token 不共用記憶(換帳號不讀到舊結果)', async () => {
    apiMock.fetchPlanAiPlaceDetailsAny.mockResolvedValue({ found: true })
    await createPlanAiApiDataSource({ baseURL: 'http://x', token: 'a' }).placeDetails('p1')
    await createPlanAiApiDataSource({ baseURL: 'http://x', token: 'b' }).placeDetails('p1')
    expect(apiMock.fetchPlanAiPlaceDetailsAny).toHaveBeenCalledTimes(2)
  })
})

describe('合併情境', () => {
  it('詢問頁並發查 N 個候選,確認後時間軸(另一個實例)再查其中幾個:總請求數 = 不同 placeId 數', async () => {
    apiMock.fetchPlanAiPlaceDetailsAny.mockImplementation(async (_cfg: unknown, id: string) => ({ found: true, name: id, ...COORDS }))
    const askDs = createPlanAiPublicDataSource('http://x')
    const timelineDs = createPlanAiPublicDataSource('http://x') // 不同實例,模擬 plan-ai-sim/Content / LivePlanLayer
    const ids = ['a', 'b', 'c', 'd', 'e']
    await Promise.all(ids.map((id) => askDs.placeDetails(id)))
    await Promise.all(['b', 'd'].map((id) => timelineDs.placeDetails(id)))
    expect(apiMock.fetchPlanAiPlaceDetailsAny).toHaveBeenCalledTimes(ids.length)
  })

  it('第一次 pending、稍後再查拿到照片', async () => {
    apiMock.fetchPlanAiPlaceDetailsAny
      .mockResolvedValueOnce({ found: true, googlePhotoUrls: [], photoRefreshPending: true })
      .mockResolvedValueOnce({ found: true, googlePhotoUrls: ['p.jpg'], ...COORDS })
    const ds = createPlanAiApiDataSource({ baseURL: 'http://x', token: 't' })
    const first = await ds.placeDetails('p1')
    expect((first as Details).photoRefreshPending).toBe(true)
    vi.advanceTimersByTime(3000)
    const second = await ds.placeDetails('p1')
    expect(second.googlePhotoUrls).toEqual(['p.jpg'])
    await ds.placeDetails('p1') // 已無 pending,之後記憶
    expect(apiMock.fetchPlanAiPlaceDetailsAny).toHaveBeenCalledTimes(2)
  })

  it('429 失敗後呼叫端重試能真的重發', async () => {
    apiMock.fetchPlanAiPlaceDetailsAny
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce({ found: true })
    const ds = createPlanAiPublicDataSource('http://x')
    await expect(ds.placeDetails('p1')).rejects.toThrow('429')
    await expect(ds.placeDetails('p1')).resolves.toMatchObject({ found: true })
    expect(apiMock.fetchPlanAiPlaceDetailsAny).toHaveBeenCalledTimes(2)
  })
})

describe('PlaceDetailsDedupe — 地圖光暈共用快取用到的選項', () => {
  it('shouldRemember 可覆寫預設政策;peek 同步讀、replace 只覆寫已記憶的', async () => {
    const d = new PlaceDetailsDedupe({ shouldRemember: () => true })
    const fetcher = vi.fn().mockResolvedValue({ found: false, v: 1 })
    await d.get('p', fetcher)
    expect(d.peek('p')).toEqual({ found: false, v: 1 })
    d.replace('p', { found: false, v: 2 })
    expect(d.peek('p')).toEqual({ found: false, v: 2 })
    d.replace('never', { v: 3 })
    expect(d.peek('never')).toBeUndefined()
  })
})
