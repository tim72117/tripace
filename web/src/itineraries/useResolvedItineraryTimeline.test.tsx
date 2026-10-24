// useResolvedItineraryTimeline——行程詳情頁唯一一份時間軸:站點座標從 PlanDataProvider 的共用 store 取(placeDetails),
// 名稱與說明維持行程作者寫的;照片不寫進節點。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { PlanDataProvider } from '../planning/data/PlanDataProvider'
import type { PlanAiDataSource } from '../planning/data/source'
import type { ReactNode } from 'react'
import { listNodes } from '../planning/timeline/model'
import { makeItinerary as make, stop as baseStop } from './testUtils'

const placeDetails = vi.fn()
import { useResolvedItineraryTimeline } from './useResolvedItineraryTimeline'

// 每個測試一份新的資料來源實例(各自一份 store,不互相沿用結果)。
let ds: PlanAiDataSource
const wrapper = ({ children }: { children: ReactNode }) => <PlanDataProvider dataSource={ds}>{children}</PlanDataProvider>

const stop = (over: Parameters<typeof baseStop>[0]) => baseStop({ desc: `${over.name}說明`, ...over })

beforeEach(() => {
  placeDetails.mockReset()
  ds = { placeDetails: (id: string) => placeDetails(id), transitEstimate: vi.fn() } as unknown as PlanAiDataSource
})

const stopsOf = (timeline: ReturnType<typeof useResolvedItineraryTimeline>) => listNodes(timeline).filter((n) => n.type === 'stop')

describe('useResolvedItineraryTimeline', () => {
  it('起點是行程檔案的座標;帶 placeId 的站查到後座標以資料存取層為準,名稱與說明不變', async () => {
    placeDetails.mockResolvedValue({
      found: true, name: 'Google 上的名字', summary: 'Google 摘要', lat: 10, lng: 20, googlePhotoUrls: ['https://x/p.jpg'],
    })
    const it = make([stop({ name: 'A', placeId: 'pid_a', lat: 1, lng: 2 }), stop({ time: '10:00', name: 'B', lat: 3, lng: 4 })])
    const { result } = renderHook(() => useResolvedItineraryTimeline(it), { wrapper })
    expect(stopsOf(result.current)[0]).toMatchObject({ lat: 1, lng: 2 })
    await waitFor(() => expect(stopsOf(result.current)[0]).toMatchObject({ lat: 10, lng: 20 }))
    // 照片不寫回節點(視圖以 placeId 向 store 取)。
    expect(stopsOf(result.current)[0]).not.toHaveProperty('googlePhotoUrls')
    expect(stopsOf(result.current)[0]).toMatchObject({ name: 'A', desc: 'A說明', placeId: 'pid_a' })
    expect(stopsOf(result.current)[1]).toMatchObject({ name: 'B', lat: 3, lng: 4 })
    expect(placeDetails).toHaveBeenCalledTimes(1)
    expect(placeDetails).toHaveBeenCalledWith('pid_a')
  })

  it('查不到(found: false)或查詢丟例外:維持行程檔案的內容,不標 failed(否則卡片名稱會被換成「未能取得地點資料」)', async () => {
    placeDetails.mockResolvedValueOnce({ found: false }).mockRejectedValueOnce(new Error('boom'))
    const it = make([
      stop({ name: 'A', placeId: 'pid_a', lat: 1, lng: 2 }),
      stop({ time: '10:00', name: 'B', placeId: 'pid_b', lat: 3, lng: 4 }),
    ])
    const { result } = renderHook(() => useResolvedItineraryTimeline(it), { wrapper })
    await waitFor(() => expect(placeDetails).toHaveBeenCalledTimes(2))
    await new Promise((r) => setTimeout(r, 20))
    const s = stopsOf(result.current)
    expect(s[0]).toMatchObject({ name: 'A', lat: 1, lng: 2 })
    expect(s[1]).toMatchObject({ name: 'B', lat: 3, lng: 4 })
  })

  it('同 id 的內容換版(靜態版換成資料庫版):時間軸跟著換,重新解析', async () => {
    placeDetails.mockResolvedValue({ found: true, name: 'X', lat: 10, lng: 20, googlePhotoUrls: [] })
    const v1 = make([stop({ name: 'A', lat: 1, lng: 2 })])
    const v2 = make([stop({ name: 'A2', placeId: 'pid_new', lat: 3, lng: 4 })])
    const { result, rerender } = renderHook(({ it }) => useResolvedItineraryTimeline(it), { initialProps: { it: v1 }, wrapper })
    expect(stopsOf(result.current)[0]).toMatchObject({ name: 'A', lat: 1, lng: 2 })
    rerender({ it: v2 })
    await waitFor(() => expect(stopsOf(result.current)[0]).toMatchObject({ name: 'A2', lat: 10, lng: 20 }))
    expect(placeDetails).toHaveBeenCalledWith('pid_new')
  })

  it('內容換版時,舊內容還沒回來的解析結果不會蓋到新內容(新內容的站沒有那個 placeId)', async () => {
    let resolveOld: (v: unknown) => void = () => {}
    placeDetails.mockImplementationOnce(() => new Promise((r) => { resolveOld = r }))
    const v1 = make([stop({ name: 'A', placeId: 'pid_old', lat: 1, lng: 2 })])
    const v2 = make([stop({ name: 'A', lat: 3, lng: 4 })])
    const { result, rerender } = renderHook(({ it }) => useResolvedItineraryTimeline(it), { initialProps: { it: v1 }, wrapper })
    rerender({ it: v2 })
    resolveOld({ found: true, name: 'OLD', lat: 99, lng: 99, googlePhotoUrls: ['https://x/old.jpg'] })
    await new Promise((r) => setTimeout(r, 20))
    expect(stopsOf(result.current)[0]).toMatchObject({ lat: 3, lng: 4 })
    expect(stopsOf(result.current)[0]).not.toHaveProperty('googlePhotoUrls')
  })

  it('查詢結果沒有座標時維持行程檔案的座標;itinerary 為 undefined 回空時間軸', async () => {
    placeDetails.mockResolvedValue({ found: true, name: 'X', googlePhotoUrls: [] })
    const it = make([stop({ name: 'A', placeId: 'pid_a', lat: 1, lng: 2 })])
    const { result } = renderHook(() => useResolvedItineraryTimeline(it), { wrapper })
    await waitFor(() => expect(placeDetails).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(stopsOf(result.current)[0]).toMatchObject({ lat: 1, lng: 2 })
    const empty = renderHook(() => useResolvedItineraryTimeline(undefined), { wrapper })
    expect(listNodes(empty.result.current)).toEqual([])
  })

  it('store 其他無關的 id 變動時,時間軸參照不變(下游 memo 不重算)', async () => {
    placeDetails.mockResolvedValue({ found: true, name: 'X', lat: 10, lng: 20 })
    const it = make([stop({ name: 'A', placeId: 'pid_a', lat: 1, lng: 2 })])
    const { result } = renderHook(() => ({ tl: useResolvedItineraryTimeline(it), ds }), { wrapper })
    await waitFor(() => expect(stopsOf(result.current.tl)[0]).toMatchObject({ lat: 10, lng: 20 }))
    const before = result.current.tl
    const { getPlanDataStore } = await import('../planning/data/store')
    getPlanDataStore(ds).request('place', 'someone_else')
    await new Promise((r) => setTimeout(r, 20))
    expect(result.current.tl).toBe(before)
  })
})
