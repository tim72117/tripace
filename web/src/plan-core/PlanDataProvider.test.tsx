// PlanDataProvider / useResolvedRefs:同頁多消費者只查一次、換資料來源換 store、卸載不報錯、沒有 Provider 丟明確錯誤。
import { afterEach, describe, it, expect, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { PlanDataProvider, usePlanData, useResolvedRefs } from './PlanDataProvider'
import { resolveNodeRefChildren } from './useResolvedNodeRefs'
import { getPlanDataStore, PLAN_DATA_TTL_MS } from './planDataStore'
import type { PlanNode } from './planTimeline'
import type { PlanAiDataSource, PlanAiPlaceDetailsResult } from './dataSource'
import type { ReactNode } from 'react'

function makeDs(overrides: Partial<PlanAiDataSource> = {}): PlanAiDataSource {
  return {
    placeDetails: vi.fn(async (id: string) => ({
      found: true,
      name: `名稱-${id}`,
      summary: `摘要-${id}`,
      lat: 1,
      lng: 2,
      googlePhotoUrls: [`https://img/${id}.jpg`],
    })),
    transitEstimate: vi.fn(),
    attractionByID: vi.fn(async (id: string) => ({ id, name: `景點-${id}`, lat: 3, lng: 4, summary: 's' })),
    ...overrides,
  } as unknown as PlanAiDataSource
}

const node = (extra: Partial<PlanNode>): PlanNode => ({ id: 'n', type: 'stop', ...extra })
const wrapperFor = (ds: PlanAiDataSource) =>
  function W({ children }: { children: ReactNode }) {
    return <PlanDataProvider dataSource={ds}>{children}</PlanDataProvider>
  }

describe('usePlanData', () => {
  it('沒有 Provider:丟明確錯誤(不靜默退路)', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => usePlanData())).toThrow('PlanDataProvider')
    errors.mockRestore()
  })

  it('提供 { dataSource, store },store 就是該資料來源的共用 store', () => {
    const ds = makeDs()
    const { result } = renderHook(() => usePlanData(), { wrapper: wrapperFor(ds) })
    expect(result.current.dataSource).toBe(ds)
    expect(result.current.store).toBe(getPlanDataStore(ds))
  })
})

describe('useResolvedRefs', () => {
  it('places 走 placeDetails、attractions 走 attractionByID', async () => {
    const ds = makeDs()
    const nodes = [node({ places: ['p1'], attractions: ['lmk_1'] })]
    const { result } = renderHook(() => useResolvedRefs(nodes), { wrapper: wrapperFor(ds) })
    await waitFor(() => expect(result.current.size).toBe(2))
    expect(result.current.get('p1')).toMatchObject({ name: '名稱-p1', lat: 1, lng: 2 })
    expect(result.current.get('lmk_1')).toMatchObject({ name: '景點-lmk_1', lat: 3, lng: 4 })
  })

  it('已查到的 id 不重查;新增的 id 才發查詢', async () => {
    const ds = makeDs()
    let nodes = [node({ places: ['p1'] })]
    const { result, rerender } = renderHook(() => useResolvedRefs(nodes), { wrapper: wrapperFor(ds) })
    await waitFor(() => expect(result.current.size).toBe(1))
    nodes = [node({ places: ['p1', 'p2'] })]
    rerender()
    await waitFor(() => expect(result.current.size).toBe(2))
    expect(ds.placeDetails).toHaveBeenCalledTimes(2)
  })

  it('同頁多個消費者(同一個 Provider)需要同一個 id 時只查一次,且兩邊拿到同一份結果', async () => {
    const ds = makeDs()
    const nodes = [node({ places: ['shared'] })]
    const { result } = renderHook(
      () => ({ a: useResolvedRefs(nodes), b: useResolvedRefs(nodes) }),
      { wrapper: wrapperFor(ds) },
    )
    await waitFor(() => expect(result.current.a.size).toBe(1))
    expect(result.current.b.get('shared')).toBe(result.current.a.get('shared'))
    expect(ds.placeDetails).toHaveBeenCalledTimes(1)
  })

  it('站點自己的 placeId 也被解析(取照片用),但不會變成它自己的子景點;旅館 placeId 一併解析', async () => {
    const ds = makeDs()
    const nodes = [node({ placeId: 'own', name: '站點' })]
    const lodgings = [{ id: 'l', placeId: 'hotel', dayIds: ['d1'] }]
    const { result } = renderHook(() => useResolvedRefs(nodes, lodgings), { wrapper: wrapperFor(ds) })
    await waitFor(() => expect(result.current.get('own')?.googlePhotoUrls).toEqual(['https://img/own.jpg']))
    await waitFor(() => expect(result.current.get('hotel')?.name).toBe('名稱-hotel'))
    expect(resolveNodeRefChildren(nodes[0], result.current)).toEqual([])
  })

  it('查詢失敗:不在結果表裡(取用端退回最小項目),不丟例外', async () => {
    const ds = makeDs({ placeDetails: vi.fn(async () => { throw new Error('x') }) })
    const nodes = [node({ places: ['boom'] })]
    const { result } = renderHook(() => useResolvedRefs(nodes), { wrapper: wrapperFor(ds) })
    await waitFor(() => expect(getPlanDataStore(ds).getEntry('place', 'boom')?.state).toBe('failed'))
    expect(result.current.get('boom')).toBeUndefined()
    expect(resolveNodeRefChildren(nodes[0], result.current)).toEqual([{ id: 'boom', placeId: 'boom' }])
  })

  it('站點 placeId 第一次解析失敗,節點之後有了座標(重試成功)就立即重查、補回照片(不等失敗重試間隔)', async () => {
    let fail = true
    const ds = makeDs({
      placeDetails: vi.fn(async (id: string) => {
        if (fail) throw new Error('429')
        return { found: true, name: 'N', lat: 1, lng: 2, googlePhotoUrls: [`https://img/${id}.jpg`] }
      }),
    })
    let nodes = [node({ placeId: 'own' })]
    const { result, rerender } = renderHook(() => useResolvedRefs(nodes), { wrapper: wrapperFor(ds) })
    await waitFor(() => expect(getPlanDataStore(ds).getEntry('place', 'own')?.state).toBe('failed'))
    fail = false
    nodes = [node({ placeId: 'own', lat: 1, lng: 2 })]
    rerender()
    await waitFor(() => expect(result.current.get('own')?.googlePhotoUrls).toEqual(['https://img/own.jpg']))
  })

  it('卸載後才回來的結果不 setState、不報錯(結果仍留在 store,下次免重查)', async () => {
    let release: (v: PlanAiPlaceDetailsResult) => void = () => {}
    const ds = makeDs({ placeDetails: vi.fn(() => new Promise<PlanAiPlaceDetailsResult>((r) => (release = r))) })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = renderHook(() => useResolvedRefs([node({ places: ['late'] })]), { wrapper: wrapperFor(ds) })
    unmount()
    release({ found: true, name: 'late' })
    await new Promise((r) => setTimeout(r, 10))
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
    expect(getPlanDataStore(ds).getSnapshot().get('late')?.name).toBe('late')
  })

  describe('TTL 真的會過期重取(頁面開著、節點組合不變)', () => {
    afterEach(() => {
      vi.useRealTimers()
    })
    const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

    function setupExpiring() {
      vi.useFakeTimers()
      let name = '舊'
      const ds = makeDs({
        placeDetails: vi.fn(async () => ({ found: true, name, lat: 1, lng: 2, googlePhotoUrls: [`https://img/${name}.jpg`] })),
      })
      const nodes = [node({ places: ['p'] })]
      const hook = renderHook(() => useResolvedRefs(nodes), { wrapper: wrapperFor(ds) })
      return { ds, hook, setName: (n: string) => (name = n) }
    }

    it('低頻計時器:過了 TTL 後自動對目前需要的 id 重取,換上新照片網址', async () => {
      const { ds, hook, setName } = setupExpiring()
      await tick(0)
      expect(hook.result.current.get('p')?.name).toBe('舊')
      setName('新')
      await tick(PLAN_DATA_TTL_MS - 1000)
      expect(ds.placeDetails).toHaveBeenCalledTimes(1) // 未過期不重取
      await tick(PLAN_DATA_TTL_MS)
      expect(ds.placeDetails).toHaveBeenCalledTimes(2)
      expect(hook.result.current.get('p')?.googlePhotoUrls).toEqual(['https://img/新.jpg'])
    })

    it('可見性回到前景(visibilitychange):已過期的立即重取;未過期不重取', async () => {
      const { ds, hook, setName } = setupExpiring()
      await tick(0)
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      await tick(0)
      expect(ds.placeDetails).toHaveBeenCalledTimes(1)
      setName('新')
      vi.setSystemTime(Date.now() + PLAN_DATA_TTL_MS) // 只推時間、不觸發計時器
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      await tick(0)
      expect(ds.placeDetails).toHaveBeenCalledTimes(2)
      expect(hook.result.current.get('p')?.name).toBe('新')
    })

    it('計時器不重試失敗的項目(不造成無限重試)', async () => {
      vi.useFakeTimers()
      const ds = makeDs({ placeDetails: vi.fn(async () => { throw new Error('x') }) })
      renderHook(() => useResolvedRefs([node({ places: ['boom'] })]), { wrapper: wrapperFor(ds) })
      await tick(0)
      expect(ds.placeDetails).toHaveBeenCalledTimes(1)
      await tick(PLAN_DATA_TTL_MS * 6)
      expect(ds.placeDetails).toHaveBeenCalledTimes(1)
    })

    it('卸載後清掉計時器與監聽:之後過期也不再重取', async () => {
      const { ds, hook } = setupExpiring()
      await tick(0)
      hook.unmount()
      vi.setSystemTime(Date.now() + PLAN_DATA_TTL_MS)
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(PLAN_DATA_TTL_MS * 3)
      expect(ds.placeDetails).toHaveBeenCalledTimes(1)
    })
  })

  it('換資料來源(Provider 換 dataSource):換成另一個 store,舊來源的結果不沿用,用新來源重查', async () => {
    const ds1 = makeDs()
    const ds2 = makeDs({ placeDetails: vi.fn(async () => ({ found: true, name: '新來源', lat: 9, lng: 9 })) })
    const nodes = [node({ places: ['p'] })]
    let ds = ds1
    const { result, rerender } = renderHook(() => useResolvedRefs(nodes), {
      wrapper: ({ children }: { children: ReactNode }) => <PlanDataProvider dataSource={ds}>{children}</PlanDataProvider>,
    })
    await waitFor(() => expect(result.current.get('p')?.name).toBe('名稱-p'))
    ds = ds2
    rerender()
    expect(result.current.get('p')).toBeUndefined()
    await waitFor(() => expect(result.current.get('p')?.name).toBe('新來源'))
  })
})
