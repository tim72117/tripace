// useCityAttractionGlow——行程詳情頁的光暈資料來源:依行程所在城市經資料存取層查景點區域,失敗不影響頁面。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const attractionsByCity = vi.fn()
vi.mock('../planning/data/public', () => ({
  getPlanAiPublicDataSource: () => ({
    attractionsByCity: (city: string) => attractionsByCity(city),
    geoPlaceDetails: vi.fn(),
    photoAssets: vi.fn(),
  }),
}))

import { cityNameOf, useCityAttractionGlow } from './useCityAttractionGlow'

beforeEach(() => {
  attractionsByCity.mockReset()
})

describe('cityNameOf', () => {
  it('取「國家・城市」的最後一段;沒有分隔字元就原樣', () => {
    expect(cityNameOf('泰國・清邁')).toBe('清邁')
    expect(cityNameOf('台灣・台南')).toBe('台南')
    expect(cityNameOf('清邁')).toBe('清邁')
  })
})

describe('useCityAttractionGlow', () => {
  it('依城市名查景點區域,查到後放進 attractionGlow,沒有控制項', async () => {
    const list = [{ id: 'a', name: '尼曼文青咖啡巷', lat: 1, lng: 2 }]
    attractionsByCity.mockResolvedValue(list)
    const { result } = renderHook(() => useCityAttractionGlow('泰國・清邁'))
    expect(result.current.attractionGlow.attractions).toEqual([])
    await waitFor(() => expect(result.current.attractionGlow.attractions).toEqual(list))
    expect(attractionsByCity).toHaveBeenCalledWith('清邁')
    expect(result.current.controls).toBeUndefined()
    expect(typeof result.current.attractionGlow.placeDetails).toBe('function')
    expect(typeof result.current.attractionGlow.photoAssets).toBe('function')
  })

  it('查詢失敗:維持空清單,不丟例外', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    attractionsByCity.mockImplementation(() => new Promise((_, reject) => setTimeout(() => reject(new Error('boom')), 0)))
    const { result } = renderHook(() => useCityAttractionGlow('泰國・清邁'))
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(result.current.attractionGlow.attractions).toEqual([])
    spy.mockRestore()
  })
})
