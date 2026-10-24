// planDataStore:識別碼 → 解析結果的共用 store。
// 重點:請求去重、狀態轉換(pending/ok/failed)、TTL 過期重取、失敗重試規則、photoRefreshPending 重試、
// 多訂閱者通知、不同資料來源實例各自一份。
import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  createPlanDataStore,
  getPlanDataStore,
  PLAN_DATA_FAILED_RETRY_MS,
  PLAN_DATA_TTL_MS,
} from './planDataStore'
import { PLACE_DETAILS_TTL_MS } from '../home/plan-ai-sim/placeDetailsDedupe'
import type { PlanAiDataSource } from './dataSource'

function makeDs(overrides: Partial<PlanAiDataSource> = {}): PlanAiDataSource {
  return {
    placeDetails: vi.fn(async (id: string) => ({
      found: true,
      name: `名稱-${id}`,
      summary: `摘要-${id}`,
      lat: 1,
      lng: 2,
      googlePhotoUrls: [`https://img/${id}.jpg`],
      thumbBg: 'bg',
      thumbIcon: '📍',
    })),
    transitEstimate: vi.fn(),
    attractionByID: vi.fn(async (id: string) => ({ id, name: `景點-${id}`, lat: 3, lng: 4, summary: 's' })),
    ...overrides,
  } as unknown as PlanAiDataSource
}

const flush = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
  vi.useRealTimers()
})

describe('planDataStore', () => {
  it('TTL 與資料存取層去重快取對齊', () => {
    expect(PLAN_DATA_TTL_MS).toBe(PLACE_DETAILS_TTL_MS)
  })

  it('place 走 placeDetails、attraction 走 attractionByID,結果含名稱/摘要/座標/照片;pending → ok', async () => {
    const ds = makeDs()
    const store = createPlanDataStore(ds)
    store.request('place', 'p1')
    store.request('attraction', 'lmk_1')
    expect(store.getEntry('place', 'p1')?.state).toBe('pending')
    expect(store.getSnapshot().size).toBe(0)
    await flush()
    expect(store.getEntry('place', 'p1')?.state).toBe('ok')
    expect(store.getSnapshot().get('p1')).toMatchObject({ id: 'p1', placeId: 'p1', name: '名稱-p1', desc: '摘要-p1', lat: 1, lng: 2, googlePhotoUrls: ['https://img/p1.jpg'], thumbIcon: '📍' })
    expect(store.getSnapshot().get('lmk_1')).toMatchObject({ id: 'lmk_1', attractionId: 'lmk_1', name: '景點-lmk_1', lat: 3, lng: 4 })
  })

  it('請求去重:進行中與已成功的 id 重複 request 不再發查詢', async () => {
    const ds = makeDs()
    const store = createPlanDataStore(ds)
    store.request('place', 'p')
    store.request('place', 'p')
    await flush()
    store.request('place', 'p')
    expect(ds.placeDetails).toHaveBeenCalledTimes(1)
  })

  it('snapshot 只在有新結果時換參照;訂閱者每次變動都被通知,取消訂閱後不再通知', async () => {
    const store = createPlanDataStore(makeDs())
    const a = vi.fn()
    const b = vi.fn()
    const offA = store.subscribe(a)
    store.subscribe(b)
    const s0 = store.getSnapshot()
    store.request('place', 'p1')
    expect(store.getSnapshot()).toBe(s0)
    await flush()
    const s1 = store.getSnapshot()
    expect(s1).not.toBe(s0)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    offA()
    store.request('place', 'p2')
    await flush()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot()).not.toBe(s1)
  })

  it('查詢失敗(拋例外、found:false、沒實作 attractionByID)→ failed,只有 id 的最小項目,不丟例外、不進 snapshot', async () => {
    const ds = makeDs({
      placeDetails: vi.fn(async (id: string) => {
        if (id === 'boom') throw new Error('network')
        return { found: false }
      }),
      attractionByID: undefined,
    })
    const store = createPlanDataStore(ds)
    store.request('place', 'boom')
    store.request('place', 'gone')
    store.request('attraction', 'lmk_x')
    await flush()
    expect(store.getEntry('place', 'boom')).toMatchObject({ state: 'failed', child: { id: 'boom', placeId: 'boom' } })
    expect(store.getEntry('place', 'gone')?.state).toBe('failed')
    expect(store.getEntry('attraction', 'lmk_x')).toMatchObject({ state: 'failed', child: { id: 'lmk_x', attractionId: 'lmk_x' } })
    expect(store.getSnapshot().size).toBe(0)
  })

  it('失敗重試規則:間隔內 request 不重查;超過間隔才重查;retryFailedNow 與 retry() 立即重查', async () => {
    let t = 1000
    let fail = true
    const ds = makeDs({
      placeDetails: vi.fn(async () => {
        if (fail) throw new Error('429')
        return { found: true, name: 'N', lat: 1, lng: 2 }
      }),
    })
    const store = createPlanDataStore(ds, { now: () => t })
    store.request('place', 'p')
    await flush()
    expect(ds.placeDetails).toHaveBeenCalledTimes(1)
    // 間隔內:不重查(避免無限重試)
    t += PLAN_DATA_FAILED_RETRY_MS - 1
    store.request('place', 'p')
    await flush()
    expect(ds.placeDetails).toHaveBeenCalledTimes(1)
    // retryFailedNow:有「現在查得到了」的證據時立即重查
    store.request('place', 'p', { retryFailedNow: true })
    await flush()
    expect(ds.placeDetails).toHaveBeenCalledTimes(2)
    expect(store.getEntry('place', 'p')?.state).toBe('failed')
    // 超過間隔:下次有人需要時重查,這次成功
    fail = false
    t += PLAN_DATA_FAILED_RETRY_MS
    store.request('place', 'p')
    await flush()
    expect(ds.placeDetails).toHaveBeenCalledTimes(3)
    expect(store.getEntry('place', 'p')?.state).toBe('ok')
    expect(store.getSnapshot().get('p')?.name).toBe('N')

    // 手動 retry:ok 的也立即重查
    store.retry('place', 'p')
    await flush()
    expect(ds.placeDetails).toHaveBeenCalledTimes(4)
  })

  it('failed 重查成功時通知訂閱者並出現在 snapshot', async () => {
    let fail = true
    const ds = makeDs({
      placeDetails: vi.fn(async () => {
        if (fail) throw new Error('x')
        return { found: true, name: 'N', lat: 1, lng: 2 }
      }),
    })
    const store = createPlanDataStore(ds)
    store.request('place', 'p')
    await flush()
    const fn = vi.fn()
    store.subscribe(fn)
    fail = false
    store.retry('place', 'p')
    await flush()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().get('p')?.name).toBe('N')
  })

  it('TTL 過期:下次 request 在背景重取,重取期間仍顯示舊結果;未過期不重取', async () => {
    let t = 0
    let name = '舊'
    const ds = makeDs({ placeDetails: vi.fn(async () => ({ found: true, name, lat: 1, lng: 2, googlePhotoUrls: ['https://img/x.jpg'] })) })
    const store = createPlanDataStore(ds, { now: () => t })
    store.request('place', 'p')
    await flush()
    t += PLAN_DATA_TTL_MS - 1
    store.request('place', 'p')
    await flush()
    expect(ds.placeDetails).toHaveBeenCalledTimes(1)
    t += 1
    name = '新'
    store.request('place', 'p')
    expect(store.getSnapshot().get('p')?.name).toBe('舊')
    await flush()
    expect(ds.placeDetails).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot().get('p')?.name).toBe('新')
  })

  it('TTL 過期的重取失敗:保留舊結果(不降級),並在失敗重試間隔後才再試', async () => {
    let t = 0
    let fail = false
    const ds = makeDs({
      placeDetails: vi.fn(async () => {
        if (fail) throw new Error('x')
        return { found: true, name: 'N', lat: 1, lng: 2, googlePhotoUrls: ['https://img/x.jpg'] }
      }),
    })
    const store = createPlanDataStore(ds, { now: () => t })
    store.request('place', 'p')
    await flush()
    t += PLAN_DATA_TTL_MS
    fail = true
    store.request('place', 'p')
    await flush()
    expect(store.getEntry('place', 'p')?.state).toBe('ok')
    expect(store.getSnapshot().get('p')?.name).toBe('N')
    store.request('place', 'p')
    await flush()
    expect(ds.placeDetails).toHaveBeenCalledTimes(2)
    t += PLAN_DATA_FAILED_RETRY_MS
    store.request('place', 'p')
    await flush()
    expect(ds.placeDetails).toHaveBeenCalledTimes(3)
  })

  it('詳情沒帶照片且資料來源有 photoAssets 時補一次;補照片失敗不影響其餘欄位', async () => {
    const ds = makeDs({
      placeDetails: vi.fn(async () => ({ found: true, name: 'N', lat: 1, lng: 2 })),
      photoAssets: vi.fn(async () => ({ googlePhotoUrls: ['https://img/extra.jpg'] })),
    })
    const store = createPlanDataStore(ds)
    store.request('place', 'p')
    await flush()
    expect(store.getSnapshot().get('p')?.googlePhotoUrls).toEqual(['https://img/extra.jpg'])

    const ds2 = makeDs({
      placeDetails: vi.fn(async () => ({ found: true, name: 'N2', lat: 1, lng: 2 })),
      photoAssets: vi.fn(async () => {
        throw new Error('x')
      }),
    })
    const store2 = createPlanDataStore(ds2)
    store2.request('place', 'q')
    await flush()
    expect(store2.getSnapshot().get('q')).toMatchObject({ name: 'N2' })
  })

  it('詳情說照片還在背景補(photoRefreshPending)而當下沒照片:稍後用 photoAssets 重試補上並通知;多次 request 只起一個迴圈', async () => {
    vi.useFakeTimers()
    let calls = 0
    const ds = makeDs({
      placeDetails: vi.fn(async () => ({ found: true, name: 'N', lat: 1, lng: 2, photoRefreshPending: true })),
      photoAssets: vi.fn(async () => (++calls < 2 ? {} : { googlePhotoUrls: ['https://img/late.jpg'] })),
    })
    const store = createPlanDataStore(ds)
    const fn = vi.fn()
    store.subscribe(fn)
    store.request('place', 'pend')
    store.request('place', 'pend')
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot().get('pend')?.name).toBe('N')
    expect(store.getSnapshot().get('pend')?.googlePhotoUrls).toBeUndefined()
    // 補不到時 placeDetails 初次的 photoAssets 補查算一次(calls=1),重試第一次(calls=2)才拿到
    await vi.advanceTimersByTimeAsync(10000)
    expect(store.getSnapshot().get('pend')?.googlePhotoUrls).toEqual(['https://img/late.jpg'])
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(ds.placeDetails).toHaveBeenCalledTimes(1)
  })

  it('補照片迴圈進行中遇到 TTL 重取(新 entry 仍 photoPending):照片仍會補上,不必等下個 TTL', async () => {
    vi.useFakeTimers()
    let t = 0
    let photosReady = false
    const ds = makeDs({
      placeDetails: vi.fn(async () => ({ found: true, name: 'N', lat: 1, lng: 2, photoRefreshPending: true })),
      photoAssets: vi.fn(async () => (photosReady ? { googlePhotoUrls: ['https://img/late.jpg'] } : {})),
    })
    const store = createPlanDataStore(ds, { now: () => t })
    store.request('place', 'p')
    await vi.advanceTimersByTimeAsync(0) // 第一次結果:photoPending,起補照片迴圈
    await vi.advanceTimersByTimeAsync(1000) // 迴圈還沒到第一次重試
    t += PLAN_DATA_TTL_MS
    store.request('place', 'p') // TTL 重取:換成新的 entry,仍 photoPending
    await vi.advanceTimersByTimeAsync(0)
    expect(ds.placeDetails).toHaveBeenCalledTimes(2)
    photosReady = true
    await vi.advanceTimersByTimeAsync(10000)
    expect(store.getSnapshot().get('p')?.googlePhotoUrls).toEqual(['https://img/late.jpg'])
    // 舊迴圈被新迴圈取代、補到照片後停止:不無限重試
    const calls = (ds.photoAssets as ReturnType<typeof vi.fn>).mock.calls.length
    await vi.advanceTimersByTimeAsync(60000)
    expect((ds.photoAssets as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls)
  })

  it('補照片迴圈進行中新結果已帶照片:迴圈停止,不覆寫新結果', async () => {
    vi.useFakeTimers()
    let t = 0
    let withPhotos = false
    const ds = makeDs({
      placeDetails: vi.fn(async () =>
        withPhotos
          ? { found: true, name: 'N', lat: 1, lng: 2, googlePhotoUrls: ['https://img/new.jpg'] }
          : { found: true, name: 'N', lat: 1, lng: 2, photoRefreshPending: true },
      ),
      photoAssets: vi.fn(async () => ({})),
    })
    const store = createPlanDataStore(ds, { now: () => t })
    store.request('place', 'p')
    await vi.advanceTimersByTimeAsync(0)
    expect(ds.photoAssets).toHaveBeenCalledTimes(1) // fetchRef 內的補查
    t += PLAN_DATA_TTL_MS
    withPhotos = true
    store.request('place', 'p')
    await vi.advanceTimersByTimeAsync(60000)
    expect(store.getSnapshot().get('p')?.googlePhotoUrls).toEqual(['https://img/new.jpg'])
    expect(ds.photoAssets).toHaveBeenCalledTimes(1)
  })

  it('照片重試達上限仍沒照片就停止(不無限重試)', async () => {
    vi.useFakeTimers()
    const ds = makeDs({
      placeDetails: vi.fn(async () => ({ found: true, name: 'N', lat: 1, lng: 2, photoRefreshPending: true })),
      photoAssets: vi.fn(async () => ({})),
    })
    const store = createPlanDataStore(ds)
    store.request('place', 'pend')
    await vi.advanceTimersByTimeAsync(60000)
    // 1 次補查 + 3 次重試
    expect(ds.photoAssets).toHaveBeenCalledTimes(4)
  })

  it('不同資料來源實例各自一份 store;同一實例取得同一個 store', async () => {
    const ds1 = makeDs()
    const ds2 = makeDs({ placeDetails: vi.fn(async () => ({ found: true, name: '另一份', lat: 9, lng: 9 })) })
    expect(getPlanDataStore(ds1)).toBe(getPlanDataStore(ds1))
    expect(getPlanDataStore(ds1)).not.toBe(getPlanDataStore(ds2))
    getPlanDataStore(ds1).request('place', 'p')
    getPlanDataStore(ds2).request('place', 'p')
    await flush()
    expect(getPlanDataStore(ds1).getSnapshot().get('p')?.name).toBe('名稱-p')
    expect(getPlanDataStore(ds2).getSnapshot().get('p')?.name).toBe('另一份')
  })
})
