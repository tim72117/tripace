// useAttractionClickRouting 單元測試。
//
// 從 PlanMap 抽出來的兩個「點到地點之後要走哪條路」的處理(2026-10):
//   - handleAttractionClick:點景點區域光暈(主題點 / 有 placeId / 沒有 placeId)
//   - handlePoiClick:點底圖上 Google 原生 POI(已拿到 placeId)
// PlanMap 整體行為另由 PlanMap.attractionClick.test.tsx / poiClick.test.tsx 保護。
import { createPlanAiApiDataSource } from '../data/api'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ClientConfig, GeoAttraction, GeoPlaceDetails } from '../../api'
import { useAttractionClickRouting } from './useAttractionClickRouting'

type RetryArgs = [string, (id: string) => Promise<GeoPlaceDetails>, (d: GeoPlaceDetails) => void, (id: string) => Promise<unknown>]
const retry = vi.hoisted(() => ({
  calls: [] as unknown[][],
  result: Promise.resolve(undefined) as Promise<unknown>,
}))

vi.mock('../../photoRetry', () => ({
  fetchPlaceDetailsWithPhotoRetry: (...args: unknown[]) => {
    retry.calls.push(args)
    return retry.result
  },
}))
vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, fetchGeoPlaceDetails: vi.fn(), fetchGeoPlacePhotoAssets: vi.fn() }
})

const cfg: ClientConfig = { baseURL: 'http://x', token: null }
const details = { name: 'N', address: 'A', lat: 1, lng: 2, googlePhotoUrls: [] } as unknown as GeoPlaceDetails
const attraction = (extra: Partial<GeoAttraction> = {}) => ({ name: '赤崁樓', lat: 1, lng: 2, ...extra }) as GeoAttraction

function setup(callbacks: Partial<Parameters<typeof useAttractionClickRouting>[0]> = {}) {
  const cb = {
    onPoiSelect: vi.fn(),
    onAttractionSelect: vi.fn(),
    onAttractionOpenPlaceDetails: undefined as undefined | ((d: GeoPlaceDetails, a?: GeoAttraction) => void),
    onAttractionOpenPlaceWithoutGoogle: undefined as undefined | ((a: GeoAttraction) => void),
    ...callbacks,
  }
  const { result, rerender } = renderHook((p: typeof cb) => useAttractionClickRouting({ dataSource: createPlanAiApiDataSource(cfg), ...p }), { initialProps: cb })
  return { result, rerender, cb }
}

beforeEach(() => {
  retry.calls = []
  retry.result = Promise.resolve(undefined)
})

describe('handleAttractionClick', () => {
  it('主題點:交給 onAttractionSelect,不查地點詳情', () => {
    const { result, cb } = setup()
    const d = attraction({ isTheme: true, placeId: 'p1' })
    result.current.handleAttractionClick(d)
    expect(cb.onAttractionSelect).toHaveBeenCalledWith(d)
    expect(retry.calls).toHaveLength(0)
  })

  it('有 placeId:查地點詳情(帶照片重試),拿到後優先走 onAttractionOpenPlaceDetails(details, 景點)', () => {
    const open = vi.fn()
    const { result, cb } = setup({ onAttractionOpenPlaceDetails: open })
    const d = attraction({ placeId: 'p1' })
    result.current.handleAttractionClick(d)
    expect(retry.calls).toHaveLength(1)
    expect(retry.calls[0][0]).toBe('p1')
    ;(retry.calls[0] as RetryArgs)[2](details)
    expect(open).toHaveBeenCalledWith(details, d)
    expect(cb.onPoiSelect).not.toHaveBeenCalled()
  })

  it('有 placeId 但沒有並存路徑:退回 onPoiSelect(details)', () => {
    const { result, cb } = setup()
    result.current.handleAttractionClick(attraction({ placeId: 'p1' }))
    ;(retry.calls[0] as RetryArgs)[2](details)
    expect(cb.onPoiSelect).toHaveBeenCalledWith(details)
  })

  it('查詢失敗:走 onAttractionOpenPlaceWithoutGoogle(景點);沒有就退回 onAttractionSelect', async () => {
    retry.result = Promise.reject(new Error('quota'))
    const without = vi.fn()
    const a = setup({ onAttractionOpenPlaceWithoutGoogle: without })
    const d = attraction({ placeId: 'p1' })
    a.result.current.handleAttractionClick(d)
    await vi.waitFor(() => expect(without).toHaveBeenCalledWith(d))
    expect(a.cb.onAttractionSelect).not.toHaveBeenCalled()

    retry.result = Promise.reject(new Error('quota'))
    const b = setup()
    b.result.current.handleAttractionClick(d)
    await vi.waitFor(() => expect(b.cb.onAttractionSelect).toHaveBeenCalledWith(d))
  })

  it('沒有 placeId:不查詢,直接走 WithoutGoogle;沒有就退回 onAttractionSelect', () => {
    const without = vi.fn()
    const a = setup({ onAttractionOpenPlaceWithoutGoogle: without })
    const d = attraction()
    a.result.current.handleAttractionClick(d)
    expect(without).toHaveBeenCalledWith(d)
    expect(retry.calls).toHaveLength(0)

    const b = setup()
    b.result.current.handleAttractionClick(d)
    expect(b.cb.onAttractionSelect).toHaveBeenCalledWith(d)
  })

  it('回呼換成新函式後,事件呼叫到最新的;handler 本身身分不變(避免光暈整批重畫)', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender, cb } = setup({ onAttractionSelect: first })
    const handler = result.current.handleAttractionClick
    rerender({ ...cb, onAttractionSelect: second })
    expect(result.current.handleAttractionClick).toBe(handler)
    handler(attraction({ isTheme: true }))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})

describe('handlePoiClick', () => {
  it('查詳情後優先走 onAttractionOpenPlaceDetails(details)(沒有景點參數)', () => {
    const open = vi.fn()
    const { result } = setup({ onAttractionOpenPlaceDetails: open })
    result.current.handlePoiClick('ChIJx')
    expect(retry.calls[0][0]).toBe('ChIJx')
    ;(retry.calls[0] as RetryArgs)[2](details)
    expect(open).toHaveBeenCalledWith(details)
  })

  it('沒有並存路徑:退回 onPoiSelect(details)', () => {
    const { result, cb } = setup()
    result.current.handlePoiClick('ChIJx')
    ;(retry.calls[0] as RetryArgs)[2](details)
    expect(cb.onPoiSelect).toHaveBeenCalledWith(details)
  })

  it('查詢失敗不丟例外、不觸發任何回報', async () => {
    retry.result = Promise.reject(new Error('not found'))
    const { result, cb } = setup()
    expect(() => result.current.handlePoiClick('ChIJx')).not.toThrow()
    await new Promise((r) => setTimeout(r, 10))
    expect(cb.onPoiSelect).not.toHaveBeenCalled()
    expect(cb.onAttractionSelect).not.toHaveBeenCalled()
  })
})
