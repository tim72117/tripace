// useExploreQueries 單元測試。
//
// 從 PlanMap 抽出來的「查詢與搜尋區域狀態」(2026-10):三個查詢入口(類別標籤、探索、
// 搜尋這個區域)、attractions / areaSearch / activeCategory 三份 state,以及 idle 與程式化
// 平移之間的抑制旗標。PlanMap 整體行為另由 PlanMap.searchEntries.test.tsx、
// PlanMap.mapEvents.test.tsx 保護。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { GeoAttraction } from '../../api'
import { useExploreQueries } from './useExploreQueries'
import { EXPLORE_CATEGORY } from './exploreQuery'
import type { PlanAiDataSource } from '../data/source'

const geocode = vi.fn()
const nearby = vi.fn()
// 資料存取層用假實例:nearbyAttractionAreas 轉給 nearby mock(只驗證查詢參數與回傳處理,不碰網路)。
const dataSource = {
  placeDetails: vi.fn(),
  transitEstimate: vi.fn(),
  nearbyAttractionAreas: (...a: unknown[]) => nearby(...a),
  geocode: (...a: unknown[]) => geocode(...a),
} as unknown as PlanAiDataSource

const att = (name: string, lat = 1, lng = 2) => ({ name, lat, lng }) as GeoAttraction

function setup(overrides: Partial<Parameters<typeof useExploreQueries>[0]> = {}) {
  const center = { lat: 35.0, lng: 135.76 }
  const map = { getCenter: () => ({ lat: () => center.lat, lng: () => center.lng }) }
  const cb = {
    onSearchStart: vi.fn(),
    onGeocodeCandidatesChange: vi.fn(),
    onAttractionsChange: vi.fn(),
    onCityChange: vi.fn(),
    onActiveCategoryChange: vi.fn(),
  }
  const base = {
    mapRef: { current: map as unknown as google.maps.Map | null },
    dataSource,
    zoom: 12,
    city: '',
    exploreTrigger: 0,
    ...cb,
  }
  const props = { ...base, ...overrides }
  const hook = renderHook((p: typeof props) => useExploreQueries(p), { initialProps: props })
  return { hook, props, cb, center }
}

beforeEach(() => {
  geocode.mockReset()
  nearby.mockReset()
  geocode.mockResolvedValue({ query: '', candidates: [] })
  nearby.mockResolvedValue([])
})

describe('初始狀態', () => {
  it('attractions 預設為空、areaSearch 沒有待查範圍、沒有選中的類別', () => {
    const { hook } = setup()
    expect(hook.result.current.attractions).toEqual([])
    expect(hook.result.current.areaSearch).toEqual({ areaDirty: false, searching: false })
    expect(hook.result.current.activeCategory).toBeNull()
  })

  it('initialAttractions 作為 attractions 的初始值', () => {
    const initial = [att('A')]
    const { hook } = setup({ initialAttractions: initial })
    expect(hook.result.current.attractions).toBe(initial)
  })
})

describe('類別標籤(搜尋框類別)', () => {
  it('點「飯店」:寫回搜尋框文字、通知搜尋開始、用 restrict 模式 + 地圖中心 + 1500m 查詢', async () => {
    const { hook, cb, center } = setup()
    act(() => hook.result.current.handleCategoryClick('lodging'))
    expect(cb.onCityChange).toHaveBeenCalledWith('飯店')
    expect(cb.onSearchStart).toHaveBeenCalledTimes(1)
    expect(geocode).toHaveBeenCalledWith('飯店', center, 'restrict', 1500)
  })

  it('查詢成功:候選轉成回報格式(帶 category 與 placeId),areaSearch 回到無待查', async () => {
    geocode.mockResolvedValue({
      query: '飯店',
      candidates: [{ name: 'H', address: 'addr', lat: 3, lng: 4, placeId: 'p1' }],
    })
    const { hook, cb } = setup()
    act(() => hook.result.current.handleMapIdle())
    expect(hook.result.current.areaSearch.areaDirty).toBe(true)
    act(() => hook.result.current.handleCategoryClick('lodging'))
    await waitFor(() =>
      expect(cb.onGeocodeCandidatesChange).toHaveBeenCalledWith([
        { name: 'H', address: 'addr', lat: 3, lng: 4, category: 'lodging', placeId: 'p1' },
      ]),
    )
    expect(hook.result.current.areaSearch).toEqual({ areaDirty: false, searching: false })
  })

  it('查詢失敗:回報空清單,areaSearch 標成需要重查', async () => {
    geocode.mockRejectedValue(new Error('x'))
    const { hook, cb } = setup()
    act(() => hook.result.current.handleCategoryClick('restaurant'))
    await waitFor(() => expect(cb.onGeocodeCandidatesChange).toHaveBeenCalledWith([]))
    expect(hook.result.current.areaSearch).toEqual({ areaDirty: true, searching: false })
  })

  it('連續兩次查詢:先發出的晚回來時被丟棄(只採用最新的一次)', async () => {
    let resolveFirst!: (v: unknown) => void
    geocode.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
    geocode.mockResolvedValueOnce({ query: '', candidates: [{ name: 'NEW', address: '', lat: 1, lng: 2 }] })
    const { hook, cb } = setup()
    act(() => hook.result.current.handleCategoryClick('lodging'))
    act(() => hook.result.current.handleCategoryClick('restaurant'))
    await waitFor(() => expect(cb.onGeocodeCandidatesChange).toHaveBeenCalledTimes(1))
    await act(async () => resolveFirst({ query: '', candidates: [{ name: 'OLD', address: '', lat: 1, lng: 2 }] }))
    expect(cb.onGeocodeCandidatesChange).toHaveBeenCalledTimes(1)
    expect(cb.onGeocodeCandidatesChange.mock.calls[0][0][0].name).toBe('NEW')
  })

  it('地圖還沒好(mapRef 為 null)時不做任何事', () => {
    const { hook, cb } = setup({ mapRef: { current: null } })
    act(() => hook.result.current.handleCategoryClick('lodging'))
    expect(cb.onCityChange).not.toHaveBeenCalled()
    expect(geocode).not.toHaveBeenCalled()
  })
})

describe('探索(自建景點區域)', () => {
  it('點探索:選中該類別、通知外部、依 zoom 換算半徑查景點區域並更新 attractions', async () => {
    nearby.mockResolvedValue([att('A')])
    const { hook, cb, center } = setup({ zoom: 12 })
    act(() => hook.result.current.handleCategoryClick(EXPLORE_CATEGORY))
    expect(hook.result.current.activeCategory).toBe(EXPLORE_CATEGORY)
    expect(cb.onActiveCategoryChange).toHaveBeenCalledWith(EXPLORE_CATEGORY)
    expect(nearby).toHaveBeenCalledWith(center.lat, center.lng, 20000)
    await waitFor(() => expect(hook.result.current.attractions).toEqual([att('A')]))
    expect(cb.onAttractionsChange).toHaveBeenCalledWith([att('A')])
  })

  it('半徑隨 zoom 變化並以 50000m 為上限', () => {
    const near = setup({ zoom: 13 })
    act(() => near.hook.result.current.handleCategoryClick(EXPLORE_CATEGORY))
    expect(nearby.mock.calls[0][2]).toBe(10000)
    nearby.mockClear()
    const far = setup({ zoom: 8 })
    act(() => far.hook.result.current.handleCategoryClick(EXPLORE_CATEGORY))
    expect(nearby.mock.calls[0][2]).toBe(50000)
  })

  it('查回內容相同的景點:沿用舊陣列參照(避免光暈整批重畫)', async () => {
    nearby.mockResolvedValue([att('A')])
    const { hook } = setup()
    act(() => hook.result.current.handleCategoryClick(EXPLORE_CATEGORY))
    await waitFor(() => expect(hook.result.current.attractions).toHaveLength(1))
    const first = hook.result.current.attractions
    nearby.mockResolvedValue([att('A')])
    act(() => hook.result.current.handleSearchThisArea())
    await waitFor(() => expect(nearby).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(hook.result.current.attractions).toBe(first)
  })

  it('再點一次探索:取消選取、清空景點並通知外部', async () => {
    nearby.mockResolvedValue([att('A')])
    const { hook, cb } = setup()
    act(() => hook.result.current.handleCategoryClick(EXPLORE_CATEGORY))
    await waitFor(() => expect(hook.result.current.attractions).toHaveLength(1))
    act(() => hook.result.current.handleCategoryClick(EXPLORE_CATEGORY))
    expect(hook.result.current.activeCategory).toBeNull()
    expect(hook.result.current.attractions).toEqual([])
    expect(cb.onActiveCategoryChange).toHaveBeenLastCalledWith(null)
    expect(cb.onAttractionsChange).toHaveBeenLastCalledWith([])
  })

  it('取消(再點一次探索)之後才回來的舊回應被丟棄:已取消的景點不會復活', async () => {
    let resolveFirst!: (v: GeoAttraction[]) => void
    nearby.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
    const { hook, cb } = setup()
    act(() => hook.result.current.handleCategoryClick(EXPLORE_CATEGORY))
    act(() => hook.result.current.handleCategoryClick(EXPLORE_CATEGORY)) // 取消
    expect(hook.result.current.activeCategory).toBeNull()
    cb.onAttractionsChange.mockClear()
    await act(async () => resolveFirst([att('LATE')]))
    expect(hook.result.current.attractions).toEqual([])
    expect(cb.onAttractionsChange).not.toHaveBeenCalled()
  })

  it('exploreTrigger 遞增時等同點一次探索;為 0 時不觸發', () => {
    const { hook, props } = setup({ exploreTrigger: 0 })
    expect(nearby).not.toHaveBeenCalled()
    hook.rerender({ ...props, exploreTrigger: 1 })
    expect(hook.result.current.activeCategory).toBe(EXPLORE_CATEGORY)
    expect(nearby).toHaveBeenCalledTimes(1)
  })
})

describe('搜尋這個區域', () => {
  it('標成查詢中;搜尋框文字剛好是類別標籤時,帶回該類別', async () => {
    const { hook } = setup({ city: '景點' })
    act(() => hook.result.current.handleSearchThisArea())
    expect(hook.result.current.areaSearch.searching).toBe(true)
    expect(geocode).toHaveBeenCalledWith('景點', expect.anything(), 'restrict', 1500)
    await waitFor(() => expect(hook.result.current.areaSearch.searching).toBe(false))
  })

  it('搜尋框是一般文字:查詢時不帶類別', async () => {
    geocode.mockResolvedValue({ query: '京都', candidates: [{ name: 'X', address: '', lat: 1, lng: 2 }] })
    const { hook, cb } = setup({ city: ' 京都 ' })
    act(() => hook.result.current.handleSearchThisArea())
    await waitFor(() => expect(cb.onGeocodeCandidatesChange).toHaveBeenCalled())
    expect(geocode.mock.calls[0][0]).toBe('京都')
    expect(cb.onGeocodeCandidatesChange.mock.calls[0][0][0].category).toBeUndefined()
  })

  it('搜尋框沒有文字:不查 Google 搜尋', () => {
    const { hook } = setup({ city: '   ' })
    act(() => hook.result.current.handleSearchThisArea())
    expect(geocode).not.toHaveBeenCalled()
  })

  it('目前選中探索:同時重查景點區域', () => {
    const { hook } = setup({ city: '' })
    act(() => hook.result.current.handleCategoryClick(EXPLORE_CATEGORY))
    nearby.mockClear()
    act(() => hook.result.current.handleSearchThisArea())
    expect(nearby).toHaveBeenCalledTimes(1)
  })
})

describe('idle 與抑制旗標', () => {
  it('handleMapIdle 把 areaSearch 標成有待查範圍', () => {
    const { hook } = setup()
    act(() => hook.result.current.handleMapIdle())
    expect(hook.result.current.areaSearch.areaDirty).toBe(true)
  })

  it('suppressNextIdle 之後的第一次 idle 被抑制,第二次才標記', () => {
    const { hook } = setup()
    act(() => hook.result.current.suppressNextIdle())
    act(() => hook.result.current.handleMapIdle())
    expect(hook.result.current.areaSearch.areaDirty).toBe(false)
    act(() => hook.result.current.handleMapIdle())
    expect(hook.result.current.areaSearch.areaDirty).toBe(true)
  })
})
