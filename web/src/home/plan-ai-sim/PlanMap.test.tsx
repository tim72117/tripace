// PlanMap——/ai-plan 的「地圖元件」,對應登入後的 PlanMap 同一個層級:
// 內部用 NativeMapBase 建圖,再掛上統一繪製層(useSharedDrawLayer)與光暈。頁面只管狀態與版面。
//
// mock 掉 NativeMapBase、useSharedDrawLayer、useExploreQueries、useMapViewport、useMapIdle,只驗證元件把什麼交給誰。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'
import type { MapHandle } from '../../geo-planning/NativeMapBase'
import type { PlanAiDataSource } from './planAiDataSource'

type BaseProps = {
  center: { lat: number; lng: number } | undefined
  zoom?: number
  mapId?: string
  theme?: unknown
  onHandleChange?: (h: MapHandle) => void
  children?: React.ReactNode
}
let baseProps: BaseProps | null = null
const drawArgs: Record<string, unknown>[] = []
const exploreArgs: Record<string, unknown>[] = []

vi.mock('../../geo-planning/NativeMapBase', () => ({
  NativeMapBase: (props: BaseProps) => {
    baseProps = props
    return <div data-testid="native-map">{props.children}</div>
  },
}))
vi.mock('../../geo-planning/mapDrawLayer/useSharedDrawLayer', () => ({
  useSharedDrawLayer: (args: Record<string, unknown>) => {
    drawArgs.push(args)
    return { expandedThemeId: null }
  },
}))
const exploreState = {
  attractions: [] as unknown[],
  areaSearch: { areaDirty: false, searching: false },
  activeCategory: null as string | null,
  handleCategoryClick: vi.fn(),
  handleSearchThisArea: vi.fn(),
  handleMapIdle: vi.fn(),
  suppressNextIdle: vi.fn(),
}
vi.mock('../../geo-planning/useExploreQueries', () => ({
  useExploreQueries: (args: Record<string, unknown>) => {
    exploreArgs.push(args)
    return exploreState
  },
}))

vi.mock('../../geo-planning/useMapEvents', () => ({
  useMapViewport: () => ({ zoom: 12, bounds: null }),
  useMapIdle: () => {},
}))

import { PlanMap } from './PlanMap'

const handle = (over: Partial<MapHandle> = {}): MapHandle => ({ mapRef: { current: null }, mapReady: true, mapVersion: 2, ...over })
const lastDraw = () => drawArgs[drawArgs.length - 1] as {
  mapRef: unknown
  mapReady: boolean
  mapVersion: number
  theme?: string | null
  currentPosition: unknown
  stopDots: Record<string, unknown>
  routeSegments?: unknown
}
const stops = [{ id: 'a', lat: 1, lng: 2 }]

function renderMap(props: Partial<React.ComponentProps<typeof PlanMap>> = {}) {
  return render(<PlanMap initialCenter={{ lat: 1, lng: 2 }} zoom={14} stops={stops} {...props} />)
}

beforeEach(() => {
  baseProps = null
  drawArgs.length = 0
  exploreArgs.length = 0
  exploreState.attractions = []
  exploreState.areaSearch = { areaDirty: false, searching: false }
  exploreState.activeCategory = null
  exploreState.handleCategoryClick.mockClear()
  exploreState.handleSearchThisArea.mockClear()
})

describe('PlanMap 建圖', () => {
  it('用 NativeMapBase 建圖:initialCenter(經 resolveMapCenter)、zoom、mapId、theme 傳入(日夜切換時重建地圖)', () => {
    renderMap({ mapId: 'MAP', theme: 'dark' })
    expect(baseProps!.center).toEqual({ lat: 1, lng: 2 })
    expect(baseProps!.zoom).toBe(14)
    expect(baseProps!.mapId).toBe('MAP')
    expect(baseProps!.theme).toBe('dark')
  })

  it('children 渲染在地圖容器內(同 PlanMap 的 children)', () => {
    const { getByTestId } = renderMap({ children: <i data-testid="extra" /> })
    expect(getByTestId('native-map').contains(getByTestId('extra'))).toBe(true)
  })

  it('NativeMapBase 回報的 MapHandle 轉給呼叫端 onHandleChange', () => {
    const onHandleChange = vi.fn()
    renderMap({ onHandleChange })
    const h = handle()
    act(() => baseProps!.onHandleChange!(h))
    expect(onHandleChange).toHaveBeenCalledWith(h)
  })

  it('沒傳 onHandleChange 也不會出錯', () => {
    renderMap()
    expect(() => act(() => baseProps!.onHandleChange!(handle()))).not.toThrow()
  })
})

describe('PlanMap 統一繪製層', () => {
  it('地圖還沒好時:用預設 handle(未就緒、版本 0)呼叫 useSharedDrawLayer', () => {
    renderMap()
    expect(lastDraw().mapReady).toBe(false)
    expect(lastDraw().mapVersion).toBe(0)
  })

  it('NativeMapBase 回報 handle 後:地圖實例(同步進身分不變的本地 mapRef)、mapReady、mapVersion 交給 useSharedDrawLayer', () => {
    renderMap()
    const map = { tag: 'map' } as unknown as google.maps.Map
    const h = handle({ mapRef: { current: map }, mapVersion: 3 })
    act(() => baseProps!.onHandleChange!(h))
    expect((lastDraw().mapRef as { current: unknown }).current).toBe(map)
    expect(lastDraw().mapReady).toBe(true)
    expect(lastDraw().mapVersion).toBe(3)
  })

  it('站點、選取、hover、轉乘配對、點擊回呼(與 PlanMap 同名 prop)交給 stopDots', () => {
    const onStopClick = vi.fn()
    const pair = { fromId: 'a', toId: 'b' }
    renderMap({ selectedStopId: 'a', hoverStopId: 'b', hoverTransitPair: pair, onStopClick })
    const dots = lastDraw().stopDots
    expect(dots.stops).toBe(stops)
    expect(dots.selectedId).toBe('a')
    expect(dots.hoverId).toBe('b')
    expect(dots.hoverTransitPair).toBe(pair)
    expect(dots.onPointClick).toBe(onStopClick)
  })

  it('theme、currentPosition、routeSegments 原樣交給 useSharedDrawLayer', () => {
    const segments = [{ id: 'a->b', from: { lat: 1, lng: 2 }, to: { lat: 3, lng: 4 } }]
    renderMap({ theme: 'dark', currentPosition: { lat: 3, lng: 4 }, routeSegments: segments })
    expect(lastDraw().theme).toBe('dark')
    expect(lastDraw().currentPosition).toEqual({ lat: 3, lng: 4 })
    expect(lastDraw().routeSegments).toBe(segments)
  })

  it('沒傳 currentPosition:交 null(不畫藍點);沒傳 routeSegments:不畫線', () => {
    renderMap()
    expect(lastDraw().currentPosition).toBeNull()
    expect(lastDraw().routeSegments).toBeUndefined()
  })

  it('回報目前展開的主題點 id(onExpandedThemeIdChange)', () => {
    const onExpanded = vi.fn()
    renderMap({ onExpandedThemeIdChange: onExpanded })
    expect(onExpanded).toHaveBeenCalledWith(null)
  })
})

describe('PlanMap 景點區域光暈(與登入後共用「按鈕才查」)', () => {
  const ds = () =>
    ({
      placeDetails: vi.fn(),
      transitEstimate: vi.fn(),
      geoPlaceDetails: vi.fn(),
      photoAssets: vi.fn(),
      nearbyAttractionAreas: vi.fn(),
    }) as unknown as PlanAiDataSource

  it('共用 useExploreQueries:吃頁面傳入的資料存取層實例(PlanMap 不自己挑端點),沒有 cfg', () => {
    const attractionDataSource = ds()
    renderMap({ liveLayersEnabled: true, attractionDataSource })
    const last = exploreArgs[exploreArgs.length - 1]
    expect(last.dataSource).toBe(attractionDataSource)
    expect('cfg' in last).toBe(false)
  })

  it('推論態且有資料存取層:渲染「探索」按鈕,點下去呼叫 handleCategoryClick(探索類別)', () => {
    const { getByTitle } = renderMap({ liveLayersEnabled: true, attractionDataSource: ds() })
    fireEvent.click(getByTitle('探索'))
    expect(exploreState.handleCategoryClick).toHaveBeenCalledWith('attraction')
  })

  it('播放態(liveLayersEnabled 預設 false)或沒有資料存取層:沒有探索按鈕', () => {
    const a = renderMap()
    expect(a.queryByTitle('探索')).toBeNull()
    a.unmount()
    const b = renderMap({ liveLayersEnabled: true })
    expect(b.queryByTitle('探索')).toBeNull()
  })

  it('「搜尋這個區域」:地圖移動過(areaDirty)且探索已選中才顯示,點下去呼叫 handleSearchThisArea', () => {
    const attractionDataSource = ds()
    const none = renderMap({ liveLayersEnabled: true, attractionDataSource })
    expect(none.queryByText('搜尋這個區域')).toBeNull()
    none.unmount()
    exploreState.areaSearch = { areaDirty: true, searching: false }
    exploreState.activeCategory = 'attraction'
    const { getByText } = renderMap({ liveLayersEnabled: true, attractionDataSource })
    fireEvent.click(getByText('搜尋這個區域'))
    expect(exploreState.handleSearchThisArea).toHaveBeenCalledTimes(1)
  })

  it('查到的景點區域交給統一繪製層(attractionGlow),詳情與照片走資料存取層實例', () => {
    const attractionDataSource = ds()
    exploreState.attractions = [{ name: 'A' }]
    renderMap({ liveLayersEnabled: true, attractionDataSource })
    const glow = (lastDraw() as unknown as { attractionGlow: Record<string, unknown> }).attractionGlow
    expect(glow.attractions).toEqual([{ name: 'A' }])
    expect(glow.placeDetails).toBe(attractionDataSource.geoPlaceDetails)
    expect(glow.photoAssets).toBe(attractionDataSource.photoAssets)
    expect('cfg' in glow).toBe(false)
    expect('usePublicPlaceDetails' in glow).toBe(false)
  })

  it('不啟用光暈(播放態)時,即使 hook 有舊結果也不畫', () => {
    exploreState.attractions = [{ name: 'A' }]
    renderMap({ attractionDataSource: ds() })
    const glow = (lastDraw() as unknown as { attractionGlow: Record<string, unknown> }).attractionGlow
    expect(glow.attractions).toEqual([])
  })

  it('controlsPortalTarget 收下但不渲染到那裡(探索控制項直接疊在地圖容器內):元素裡保持空的', () => {
    const target = document.createElement('div')
    renderMap({ controlsPortalTarget: target })
    expect(target.children).toHaveLength(0)
  })
})
