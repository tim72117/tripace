// useListItineraries——清單頁的行程來源:API 成功、失敗、逾時(LIST_ITINERARIES_TIMEOUT_MS)都會結束 loading;
// 逾時後晚到的結果被忽略;卸載後不再更新。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { makeItinerary, stop } from './testUtils'

const fetchList = vi.fn()
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, fetchPublicItineraryPageList: (...args: unknown[]) => fetchList(...args) }
})

import { LIST_ITINERARIES_TIMEOUT_MS, useListItineraries } from './useListItineraries'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const apiItem = makeItinerary([stop({ name: 'a' })], { id: 'api-1', title: '資料庫行程' })
const page = { itineraryPages: [{ id: '1', slug: 'api-1', content: apiItem, status: 'published', updatedAt: '' }] }

// 讓 promise 的 then 回呼跑完(fake timers 下 microtask 仍正常運作)。
const flush = () => act(async () => {})

beforeEach(() => {
  vi.useFakeTimers()
  fetchList.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useListItineraries', () => {
  it('逾時常數是 10 秒', () => {
    expect(LIST_ITINERARIES_TIMEOUT_MS).toBe(10_000)
  })

  it('成功:loading 結束、併入 API 行程', async () => {
    fetchList.mockResolvedValue(page)
    const { result } = renderHook(() => useListItineraries())
    expect(result.current.loading).toBe(true)
    await flush()
    expect(result.current.loading).toBe(false)
    expect(result.current.items.map((i) => i.id)).toContain('api-1')
  })

  it('失敗:loading 結束、沒有 API 行程', async () => {
    fetchList.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useListItineraries())
    await flush()
    expect(result.current.loading).toBe(false)
    expect(result.current.items.map((i) => i.id)).not.toContain('api-1')
  })

  it('逾時:API 卡住時,到時間 loading 結束(視同失敗)', async () => {
    fetchList.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useListItineraries())
    act(() => {
      vi.advanceTimersByTime(LIST_ITINERARIES_TIMEOUT_MS - 1)
    })
    expect(result.current.loading).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.loading).toBe(false)
  })

  it('逾時後晚到的成功結果被忽略', async () => {
    const d = deferred<typeof page>()
    fetchList.mockReturnValue(d.promise)
    const { result } = renderHook(() => useListItineraries())
    act(() => {
      vi.advanceTimersByTime(LIST_ITINERARIES_TIMEOUT_MS)
    })
    expect(result.current.loading).toBe(false)
    d.resolve(page)
    await flush()
    expect(result.current.items.map((i) => i.id)).not.toContain('api-1')
  })

  it('卸載:清掉逾時計時器,晚到的結果不更新(不報 act/卸載警告)', async () => {
    const d = deferred<typeof page>()
    fetchList.mockReturnValue(d.promise)
    const { unmount } = renderHook(() => useListItineraries())
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    d.resolve(page)
    await flush()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('成功回來後清掉逾時計時器', async () => {
    fetchList.mockResolvedValue(page)
    renderHook(() => useListItineraries())
    await flush()
    expect(vi.getTimerCount()).toBe(0)
  })
})
