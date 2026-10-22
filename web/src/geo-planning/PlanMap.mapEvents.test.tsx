// PlanMap 地圖建立與地圖事件的特性測試(characterization tests)。
//
// 目的:2026-10 規劃把 PlanMap 內部的「建圖 + zoom_changed/bounds_changed/idle/
// click 監聽器 + 重建」換成 NativeMapBase 加掛載式 hook(見 NativeMapBase.tsx 檔頭),
// 要求「不異動功能」。這份測試先把現在的行為鎖住——拆分前後都必須全綠。
//
// 只描述現狀、不評價好壞;斷言都是從外部可觀察的結果(地圖建構參數、監聽器註冊、
// 回呼是否被呼叫、按鈕是否出現、panTo/setZoom/fitBounds 是否被呼叫),不碰內部 state。
//
// 涵蓋:
//   建圖:參數、延後建圖(initialCenter 未定)、onMapReady、API key 缺失
//   事件:zoom_changed → zoom;bounds_changed → bounds;idle → 回報中心 + 搜尋這個區域按鈕
//   抑制:panTarget.suppressQuery 讓下一次 idle 不冒出搜尋按鈕,只抑制一次
//   平移:panTo / fitBounds / setZoom / onlyIfOutOfView 的分支
//   重建:主題改變重建地圖並重新註冊監聽器;主題沒變不重建
//
// mock 策略同 PlanMap.poiClick.test.tsx:整個 @googlemaps/js-api-loader 與 api.ts 查詢,
// 不載入真實 SDK。
// ---- NativeMapBase 要等容器回報有尺寸才建圖,jsdom 沒有 ResizeObserver ----
class FakeResizeObserver {
  constructor(private cb: (entries: unknown[]) => void) {}
  observe() {
    this.cb([{ contentRect: { width: 300, height: 300 } }])
  }
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act, screen } from '@testing-library/react'
import { PlanMap } from './PlanMap'
import type { ClientConfig } from '../api'

type Listener = (event?: unknown) => void

const fake = {
  zoom: 12,
  center: { lat: 35.0, lng: 135.76 },
  bounds: null as { contains: (p: { lat: number; lng: number }) => boolean } | null,
  circleBounds: { tag: 'circle-bounds' } as unknown,
}

class FakeMap {
  static instances: FakeMap[] = []
  listeners: Record<string, Listener[]> = {}
  panTo = vi.fn()
  fitBounds = vi.fn()
  setZoom = vi.fn()
  setCenter = vi.fn()
  constructor(
    public el: HTMLElement,
    public opts: Record<string, unknown>,
  ) {
    FakeMap.instances.push(this)
  }
  addListener(event: string, handler: Listener) {
    this.listeners[event] = this.listeners[event] ?? []
    this.listeners[event].push(handler)
    return { remove: () => {} }
  }
  getDiv() {
    return this.el
  }
  getCenter() {
    return { lat: () => fake.center.lat, lng: () => fake.center.lng }
  }
  getZoom() {
    return fake.zoom
  }
  getBounds() {
    return fake.bounds
  }
  emit(event: string, payload?: unknown) {
    ;(this.listeners[event] ?? []).forEach((h) => h(payload))
  }
}

const clearInstanceListeners = vi.fn()

vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: vi.fn(),
  importLibrary: vi.fn((name: string) => {
    if (name === 'maps') return Promise.resolve({ Map: FakeMap })
    if (name === 'marker') return Promise.resolve({ AdvancedMarkerElement: class {} })
    return Promise.reject(new Error(`unexpected importLibrary(${name})`))
  }),
}))

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchGeoPlaceDetails: vi.fn(() => Promise.resolve({})),
    fetchGeoAttractionsOnlyNearby: vi.fn(() => Promise.resolve({ attractions: [] })),
  }
})

;(globalThis as { google?: unknown }).google = {
  maps: {
    OverlayView: class {},
    LatLng: class {
      constructor(
        public lat: number,
        public lng: number,
      ) {}
    },
    Circle: class {
      getBounds() {
        return fake.circleBounds
      }
    },
    event: {
      clearInstanceListeners: (...args: unknown[]) => clearInstanceListeners(...args),
      trigger: vi.fn(),
    },
  },
}

const cfg: ClientConfig = { baseURL: 'http://localhost:8080', token: null }
const CENTER = { lat: 35.0, lng: 135.76 }

beforeEach(() => {
  FakeMap.instances = []
  fake.zoom = 12
  fake.center = { ...CENTER }
  fake.bounds = null
  fake.circleBounds = { tag: 'circle-bounds' }
  clearInstanceListeners.mockClear()
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-api-key')
  vi.stubEnv('VITE_GOOGLE_MAPS_MAP_ID', 'test-map-id')
})

/** 等到第 n 張地圖建好且 mapReady 已翻成 true(idle 監聽器已註冊即代表建圖 effect 跑完) */
async function mapBuilt(n = 1) {
  await waitFor(() => {
    expect(FakeMap.instances.length).toBeGreaterThanOrEqual(n)
    expect(FakeMap.instances[n - 1].listeners.idle?.length ?? 0).toBeGreaterThan(0)
  })
  return FakeMap.instances[n - 1]
}

const emit = (map: FakeMap, event: string, payload?: unknown) => act(() => map.emit(event, payload))

// ===== 建圖 =====

describe('PlanMap 建圖', () => {
  it('依 initialCenter 與環境變數建立地圖,帶固定的原生選項', async () => {
    render(<PlanMap cfg={cfg} initialCenter={CENTER} />)
    const map = await mapBuilt()
    expect(FakeMap.instances).toHaveLength(1)
    expect(map.opts).toMatchObject({
      center: CENTER,
      zoom: 12,
      mapId: 'test-map-id',
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      zoomControl: true,
      colorScheme: 'FOLLOW_SYSTEM',
    })
    expect(map.opts.restriction).toBeUndefined()
  })

  it('initialCenter 為 null(查無旅程座標)時,用預設起點建圖', async () => {
    render(<PlanMap cfg={cfg} initialCenter={null} />)
    const map = await mapBuilt()
    expect(map.opts.center).toEqual({ lat: 35.0, lng: 135.76 })
  })

  it('showZoomControl=false 時關閉縮放按鈕', async () => {
    render(<PlanMap cfg={cfg} initialCenter={CENTER} showZoomControl={false} />)
    const map = await mapBuilt()
    expect(map.opts.zoomControl).toBe(false)
  })

  it('有 restrictBounds 才帶 restriction,且 strictBounds 為 true', async () => {
    const bounds = { north: 36, south: 34, east: 137, west: 135 }
    render(<PlanMap cfg={cfg} initialCenter={CENTER} restrictBounds={bounds} />)
    const map = await mapBuilt()
    expect(map.opts.restriction).toEqual({ latLngBounds: bounds, strictBounds: true })
  })

  it('initialCenter 還沒決定(undefined)時不建圖,決定後才建', async () => {
    const { rerender } = render(<PlanMap cfg={cfg} initialCenter={undefined} />)
    // 給非同步建圖流程時間,確認真的沒建
    await new Promise((r) => setTimeout(r, 30))
    expect(FakeMap.instances).toHaveLength(0)

    rerender(<PlanMap cfg={cfg} initialCenter={CENTER} />)
    await mapBuilt()
    expect(FakeMap.instances).toHaveLength(1)
  })

  it('建好後註冊 zoom_changed、bounds_changed、idle、click 監聽器', async () => {
    render(<PlanMap cfg={cfg} initialCenter={CENTER} />)
    const map = await mapBuilt()
    // zoom_changed、bounds_changed 都不只一個:PlanMap 自己各一個(寫 zoom/bounds
    // state),attractionGlowSupport.ts 也會各掛一個(重新計算光暈,見該檔 scheduleResolve)。
    // 總數是兩個 hook 的實作細節,拆分時可能改變,所以斷言「至少一個」而不是釘死總數;
    // 各監聽器真正做的事由下面的行為測試(zoom → setZoom、bounds → onlyIfOutOfView、
    // idle → onCenterChange 與搜尋按鈕)負責鎖住。
    for (const event of ['zoom_changed', 'bounds_changed', 'idle', 'click']) {
      expect(map.listeners[event]?.length ?? 0, event).toBeGreaterThanOrEqual(1)
    }
  })

  it('建圖完成後呼叫 onMapReady 一次', async () => {
    const onMapReady = vi.fn()
    render(<PlanMap cfg={cfg} initialCenter={CENTER} onMapReady={onMapReady} />)
    await mapBuilt()
    await waitFor(() => expect(onMapReady).toHaveBeenCalledTimes(1))
  })

  it('地圖載入失敗時隱藏類別標籤與搜尋框,失敗畫面只出現一次', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
    render(<PlanMap cfg={cfg} initialCenter={CENTER} city="" onCityChange={() => {}} onSearch={() => {}} />)
    await screen.findByText('地圖載入失敗')
    expect(screen.getAllByText('地圖載入失敗')).toHaveLength(1)
    expect(document.querySelector('button[title="景點"]')).toBeNull()
    expect(document.querySelector('input[inputmode="search"]')).toBeNull()
  })

  it('沒有 API key 時不建圖,顯示載入失敗訊息', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
    render(<PlanMap cfg={cfg} initialCenter={CENTER} />)
    await screen.findByText('地圖載入失敗')
    expect(FakeMap.instances).toHaveLength(0)
  })
})

// ===== idle:回報中心 + 搜尋這個區域按鈕 =====

describe('PlanMap idle 事件', () => {
  it('idle 時把目前地圖中心回報給 onCenterChange', async () => {
    const onCenterChange = vi.fn()
    render(<PlanMap cfg={cfg} initialCenter={CENTER} onCenterChange={onCenterChange} />)
    const map = await mapBuilt()
    fake.center = { lat: 36.1, lng: 136.2 }
    emit(map, 'idle')
    expect(onCenterChange).toHaveBeenCalledWith({ lat: 36.1, lng: 136.2 })
  })

  it('搜尋框有文字時,idle 後冒出「搜尋這個區域」按鈕', async () => {
    render(<PlanMap cfg={cfg} initialCenter={CENTER} city="京都" onCityChange={() => {}} onSearch={() => {}} />)
    const map = await mapBuilt()
    expect(screen.queryByText('搜尋這個區域')).toBeNull()
    emit(map, 'idle')
    expect(await screen.findByText('搜尋這個區域')).toBeTruthy()
  })

  it('搜尋框沒有文字(且沒選探索)時,idle 不冒出按鈕', async () => {
    render(<PlanMap cfg={cfg} initialCenter={CENTER} city="" onCityChange={() => {}} onSearch={() => {}} />)
    const map = await mapBuilt()
    emit(map, 'idle')
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByText('搜尋這個區域')).toBeNull()
  })
})

// ===== suppressQuery:程式化平移造成的 idle 不冒按鈕,只抑制一次 =====

describe('PlanMap panTarget.suppressQuery', () => {
  const props = { cfg, initialCenter: CENTER, city: '京都', onCityChange: () => {}, onSearch: () => {} }

  it('帶 suppressQuery 的平移之後,下一次 idle 不冒出按鈕;再下一次才冒出', async () => {
    render(<PlanMap {...props} panTarget={{ lat: 35.1, lng: 135.8, suppressQuery: true }} />)
    const map = await mapBuilt()
    await waitFor(() => expect(map.panTo).toHaveBeenCalledTimes(1))

    emit(map, 'idle') // 平移動畫結束的那次:被抑制
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByText('搜尋這個區域')).toBeNull()

    emit(map, 'idle') // 使用者自己拖曳:恢復冒出
    expect(await screen.findByText('搜尋這個區域')).toBeTruthy()
  })

  it('沒帶 suppressQuery 的平移,idle 照常冒出按鈕', async () => {
    render(<PlanMap {...props} panTarget={{ lat: 35.1, lng: 135.8 }} />)
    const map = await mapBuilt()
    await waitFor(() => expect(map.panTo).toHaveBeenCalledTimes(1))
    emit(map, 'idle')
    expect(await screen.findByText('搜尋這個區域')).toBeTruthy()
  })
})

// ===== panTarget 平移分支 =====

describe('PlanMap panTarget 平移', () => {
  it('一般 panTarget:呼叫 panTo', async () => {
    render(<PlanMap cfg={cfg} initialCenter={CENTER} panTarget={{ lat: 35.2, lng: 135.9 }} />)
    const map = await mapBuilt()
    await waitFor(() => expect(map.panTo).toHaveBeenCalledWith({ lat: 35.2, lng: 135.9 }))
    expect(map.fitBounds).not.toHaveBeenCalled()
  })

  it('帶 radiusMeters:改用 fitBounds(圓的範圍, 48),不呼叫 panTo', async () => {
    render(<PlanMap cfg={cfg} initialCenter={CENTER} panTarget={{ lat: 35.2, lng: 135.9, radiusMeters: 1500 }} />)
    const map = await mapBuilt()
    await waitFor(() => expect(map.fitBounds).toHaveBeenCalledWith(fake.circleBounds, 48))
    expect(map.panTo).not.toHaveBeenCalled()
  })

  it('onlyIfOutOfView:目標在 bounds_changed 回報的可視範圍內時不平移', async () => {
    const { rerender } = render(<PlanMap cfg={cfg} initialCenter={CENTER} />)
    const map = await mapBuilt()
    fake.bounds = { contains: () => true }
    emit(map, 'bounds_changed')

    rerender(<PlanMap cfg={cfg} initialCenter={CENTER} panTarget={{ lat: 35.0, lng: 135.76, onlyIfOutOfView: true }} />)
    await new Promise((r) => setTimeout(r, 30))
    expect(map.panTo).not.toHaveBeenCalled()
  })

  it('onlyIfOutOfView:目標不在可視範圍內時照常平移', async () => {
    const { rerender } = render(<PlanMap cfg={cfg} initialCenter={CENTER} />)
    const map = await mapBuilt()
    fake.bounds = { contains: () => false }
    emit(map, 'bounds_changed')

    rerender(<PlanMap cfg={cfg} initialCenter={CENTER} panTarget={{ lat: 35.0, lng: 135.76, onlyIfOutOfView: true }} />)
    await waitFor(() => expect(map.panTo).toHaveBeenCalledTimes(1))
  })

  it('onlyIfOutOfView:還沒收到 bounds_changed(bounds 未知)時照常平移', async () => {
    render(<PlanMap cfg={cfg} initialCenter={CENTER} panTarget={{ lat: 35.0, lng: 135.76, onlyIfOutOfView: true }} />)
    const map = await mapBuilt()
    await waitFor(() => expect(map.panTo).toHaveBeenCalledTimes(1))
  })

  it('帶 level:目前 zoom 低於該層級需要的縮放時 setZoom 到 minZoomForLevel', async () => {
    const { rerender } = render(<PlanMap cfg={cfg} initialCenter={CENTER} />)
    const map = await mapBuilt()
    fake.zoom = 5
    emit(map, 'zoom_changed') // zoom state 被更新成 5

    rerender(<PlanMap cfg={cfg} initialCenter={CENTER} panTarget={{ lat: 35.3, lng: 136.0, level: 4 }} />)
    await waitFor(() => expect(map.panTo).toHaveBeenCalledTimes(1))
    expect(map.setZoom).toHaveBeenCalledWith(14) // level 4 需要 14
  })

  it('帶 level:目前 zoom 已足夠時不 setZoom', async () => {
    const { rerender } = render(<PlanMap cfg={cfg} initialCenter={CENTER} />)
    const map = await mapBuilt()
    fake.zoom = 16
    emit(map, 'zoom_changed')

    rerender(<PlanMap cfg={cfg} initialCenter={CENTER} panTarget={{ lat: 35.3, lng: 136.0, level: 4 }} />)
    await waitFor(() => expect(map.panTo).toHaveBeenCalledTimes(1))
    expect(map.setZoom).not.toHaveBeenCalled()
  })
})

// ===== 主題改變 =====
//
// 注意(特性測試記錄的是「現狀」,不是「應該」):建圖 effect 的註解說 theme 改變會
// 用新的 colorScheme 重建地圖,但實際上 buildingRef 在建圖成功後從不解除(只在失敗時
// 解除),而 effect 在 `mapRef.current && builtColorSchemeRef === colorScheme` 之後
// 立刻檢查 `if (buildingRef.current) return`——所以主題改變時第二道 guard 把重建擋住了。
// 結果是現在 PlanMap 在 theme prop 改變後「不會」重建地圖。
//
// 這和 NativeMapBase 不同(它會在主題改變時重建、mapVersion 加 1)。若把 PlanMap 換成
// NativeMapBase 組合,這個行為會改變——那是功能異動,不是單純重構,需要明確決定。
// 這個測試先把現狀鎖住;刻意改變行為時請連同這個測試一起更新。
describe('PlanMap theme 改變(現狀:不重建)', () => {
  it('建好之後 theme 從 light 變 dark:不會建立第二張地圖,也不會清掉舊實例的監聽器', async () => {
    const { rerender } = render(<PlanMap cfg={cfg} initialCenter={CENTER} theme="light" />)
    const first = await mapBuilt()
    expect(first.opts.colorScheme).toBe('LIGHT')

    rerender(<PlanMap cfg={cfg} initialCenter={CENTER} theme="dark" />)
    await new Promise((r) => setTimeout(r, 50))

    expect(FakeMap.instances).toHaveLength(1)
    expect(clearInstanceListeners).not.toHaveBeenCalled()
  })

  it('主題沒變的重新渲染同樣不重建', async () => {
    const { rerender } = render(<PlanMap cfg={cfg} initialCenter={CENTER} theme="light" />)
    await mapBuilt()
    rerender(<PlanMap cfg={cfg} initialCenter={CENTER} theme="light" city="東京" />)
    await new Promise((r) => setTimeout(r, 30))
    expect(FakeMap.instances).toHaveLength(1)
  })
})
