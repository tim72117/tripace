// NativeMapBase 契約測試。
//
// 2026-10 為了讓 PlanMap 能換成「NativeMapBase 加掛載式 hook」而不異動功能,補上三個
// 缺口(見 NativeMapBase.tsx 的 MapHandle.error 與 rebuildOnThemeChange 說明);
// 這份測試同時鎖住 NativeMapBase 既有的建圖/重建行為(原本完全沒有測試)。
//
// mock 策略同 PlanMap.mapEvents.test.tsx:假的 @googlemaps/js-api-loader 與假的
// ResizeObserver(NativeMapBase 要等容器回報有尺寸才建圖,jsdom 沒有 ResizeObserver)。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { NativeMapBase, type MapHandle } from './NativeMapBase'

class FakeMap {
  static instances: FakeMap[] = []
  constructor(
    public el: HTMLElement,
    public opts: Record<string, unknown>,
  ) {
    FakeMap.instances.push(this)
  }
  setCenter = vi.fn()
  addListener() {
    return { remove: () => {} }
  }
  getCenter() {
    return { lat: () => view.center.lat, lng: () => view.center.lng }
  }
}

// 使用者目前實際看到的中心(拖曳後與初始 center 不同),給 getCenter 用
const view = { center: { lat: 0, lng: 0 } }

const loader = { fail: null as string | null, gate: null as Promise<void> | null }
const clearInstanceListeners = vi.fn()
const triggerSpy = vi.fn()

vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: vi.fn(),
  importLibrary: vi.fn((name: string) => {
    // gate:測試用的閘門——有值時 importLibrary 要等它放行才回來,模擬 SDK 載入很慢
    if (loader.gate) return loader.gate.then(() => (name === 'maps' ? { Map: FakeMap } : { AdvancedMarkerElement: class {} }))
    if (loader.fail) return Promise.reject(new Error(loader.fail))
    if (name === 'maps') return Promise.resolve({ Map: FakeMap })
    if (name === 'marker') return Promise.resolve({ AdvancedMarkerElement: class {} })
    return Promise.reject(new Error(`unexpected importLibrary(${name})`))
  }),
}))

;(globalThis as { google?: unknown }).google = {
  maps: { event: { clearInstanceListeners: (...a: unknown[]) => clearInstanceListeners(...a), trigger: (...a: unknown[]) => triggerSpy(...a) } },
}

// 容器一被觀察就回報有尺寸(寬高大於 0),NativeMapBase 才會建圖;
// 之後測試可以用 reportSize 手動再回報(模擬容器縮放、隱藏、再顯示)。
class FakeResizeObserver {
  static all: FakeResizeObserver[] = []
  constructor(private cb: (entries: unknown[]) => void) {
    FakeResizeObserver.all.push(this)
  }
  observe() {
    this.cb([{ contentRect: { width: 300, height: 300 } }])
  }
  disconnect() {}
  report(width: number, height: number) {
    this.cb([{ contentRect: { width, height } }])
  }
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver

function reportSize(width: number, height: number) {
  act(() => FakeResizeObserver.all.forEach((o) => o.report(width, height)))
}

const CENTER = { lat: 35.0, lng: 135.76 }

function lastHandle(onHandleChange: ReturnType<typeof vi.fn>): MapHandle | undefined {
  const calls = onHandleChange.mock.calls
  return calls.length ? (calls[calls.length - 1][0] as MapHandle) : undefined
}

beforeEach(() => {
  FakeMap.instances = []
  loader.fail = null
  loader.gate = null
  clearInstanceListeners.mockClear()
  triggerSpy.mockClear()
  FakeResizeObserver.all = []
  view.center = { lat: 23.5, lng: 121.5 }
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-api-key')
  vi.stubEnv('VITE_GOOGLE_MAPS_MAP_ID', 'test-map-id')
})

// ===== 既有行為(鎖住) =====

describe('NativeMapBase 建圖', () => {
  it('依 props 建立地圖並回報 handle:mapReady 為 true、mapVersion 為 1', async () => {
    const onHandleChange = vi.fn()
    render(<NativeMapBase center={CENTER} zoom={13} theme="light" onHandleChange={onHandleChange} />)
    await waitFor(() => expect(lastHandle(onHandleChange)?.mapReady).toBe(true))
    expect(FakeMap.instances).toHaveLength(1)
    expect(FakeMap.instances[0].opts).toMatchObject({
      center: CENTER,
      zoom: 13,
      mapId: 'test-map-id',
      colorScheme: 'LIGHT',
      disableDefaultUI: true,
      gestureHandling: 'greedy',
    })
    expect(lastHandle(onHandleChange)?.mapVersion).toBe(1)
  })

  it('center 為 undefined 時不建圖,決定後才建', async () => {
    const { rerender } = render(<NativeMapBase center={undefined} />)
    await new Promise((r) => setTimeout(r, 30))
    expect(FakeMap.instances).toHaveLength(0)
    rerender(<NativeMapBase center={CENTER} />)
    await waitFor(() => expect(FakeMap.instances).toHaveLength(1))
  })
})

describe('NativeMapBase 建圖進行中依賴改變', () => {
  it('SDK 還沒載入完,容器尺寸翻轉(isVisible 變化)使建圖被取消:新一輪仍要建出地圖(旗標不能卡住)', async () => {
    let release!: () => void
    loader.gate = new Promise<void>((r) => (release = r))
    const onHandleChange = vi.fn()
    render(<NativeMapBase center={CENTER} onHandleChange={onHandleChange} />)
    reportSize(0, 0)
    reportSize(300, 300)
    release()
    await waitFor(() => expect(lastHandle(onHandleChange)?.mapReady).toBe(true))
    expect(FakeMap.instances).toHaveLength(1)
  })
})

describe('NativeMapBase restrictBounds', () => {
  const bounds = { north: 36, south: 34, east: 137, west: 135 }

  it('預設 strictBounds 為 false:只鎖拖曳範圍,不鎖縮放下限(既有行為)', async () => {
    render(<NativeMapBase center={CENTER} restrictBounds={bounds} />)
    await waitFor(() => expect(FakeMap.instances).toHaveLength(1))
    expect(FakeMap.instances[0].opts.restriction).toEqual({ latLngBounds: bounds, strictBounds: false })
  })

  it('strictRestriction=true 時 strictBounds 為 true(PlanMap 原本的行為)', async () => {
    render(<NativeMapBase center={CENTER} restrictBounds={bounds} strictRestriction />)
    await waitFor(() => expect(FakeMap.instances).toHaveLength(1))
    expect(FakeMap.instances[0].opts.restriction).toEqual({ latLngBounds: bounds, strictBounds: true })
  })

  it('沒有 restrictBounds 就沒有 restriction', async () => {
    render(<NativeMapBase center={CENTER} strictRestriction />)
    await waitFor(() => expect(FakeMap.instances).toHaveLength(1))
    expect(FakeMap.instances[0].opts.restriction).toBeUndefined()
  })
})

describe('NativeMapBase 主題改變(預設:重建)', () => {
  it('theme 從 light 變 dark:建立第二張地圖、mapVersion 加 1、舊實例的監聽器被清掉', async () => {
    const onHandleChange = vi.fn()
    const { rerender } = render(<NativeMapBase center={CENTER} theme="light" onHandleChange={onHandleChange} />)
    await waitFor(() => expect(lastHandle(onHandleChange)?.mapVersion).toBe(1))

    rerender(<NativeMapBase center={CENTER} theme="dark" onHandleChange={onHandleChange} />)
    await waitFor(() => expect(lastHandle(onHandleChange)?.mapVersion).toBe(2))

    expect(FakeMap.instances).toHaveLength(2)
    expect(FakeMap.instances[1].opts.colorScheme).toBe('DARK')
    expect(clearInstanceListeners).toHaveBeenCalledWith(FakeMap.instances[0])
  })
})

// ===== 缺口 3:rebuildOnThemeChange =====

describe('NativeMapBase rebuildOnThemeChange=false(給 PlanMap 維持現況用)', () => {
  it('theme 改變不重建:仍只有一張地圖,mapVersion 不變,也不清舊實例的監聽器', async () => {
    const onHandleChange = vi.fn()
    const { rerender } = render(
      <NativeMapBase center={CENTER} theme="light" rebuildOnThemeChange={false} onHandleChange={onHandleChange} />,
    )
    await waitFor(() => expect(lastHandle(onHandleChange)?.mapVersion).toBe(1))

    rerender(<NativeMapBase center={CENTER} theme="dark" rebuildOnThemeChange={false} onHandleChange={onHandleChange} />)
    await new Promise((r) => setTimeout(r, 50))

    expect(FakeMap.instances).toHaveLength(1)
    expect(lastHandle(onHandleChange)?.mapVersion).toBe(1)
    expect(clearInstanceListeners).not.toHaveBeenCalled()
  })

  it('第一次建圖不受影響(center 先 undefined、後決定,仍會建一張)', async () => {
    const { rerender } = render(<NativeMapBase center={undefined} theme="light" rebuildOnThemeChange={false} />)
    rerender(<NativeMapBase center={CENTER} theme="light" rebuildOnThemeChange={false} />)
    await waitFor(() => expect(FakeMap.instances).toHaveLength(1))
  })
})

// ===== 缺口 1:MapHandle.error =====

describe('NativeMapBase 回報錯誤', () => {
  it('正常建圖時 handle.error 為 null', async () => {
    const onHandleChange = vi.fn()
    render(<NativeMapBase center={CENTER} onHandleChange={onHandleChange} />)
    await waitFor(() => expect(lastHandle(onHandleChange)?.mapReady).toBe(true))
    expect(lastHandle(onHandleChange)?.error ?? null).toBeNull()
  })

  it('沒有 API key:handle.error 帶出錯誤訊息,地圖不建', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
    const onHandleChange = vi.fn()
    render(<NativeMapBase center={CENTER} onHandleChange={onHandleChange} />)
    await waitFor(() => expect(lastHandle(onHandleChange)?.error).toContain('未設定 VITE_GOOGLE_MAPS_API_KEY'))
    expect(FakeMap.instances).toHaveLength(0)
    expect(lastHandle(onHandleChange)?.mapReady).toBe(false)
  })

  it('載入地圖模組失敗:handle.error 帶出失敗原因', async () => {
    loader.fail = '網路中斷'
    const onHandleChange = vi.fn()
    render(<NativeMapBase center={CENTER} onHandleChange={onHandleChange} />)
    await waitFor(() => expect(lastHandle(onHandleChange)?.error).toBe('網路中斷'))
  })

  it('錯誤時 NativeMapBase 自己仍會畫失敗畫面(既有行為)', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
    const { findByText } = render(<NativeMapBase center={CENTER} />)
    expect(await findByText('地圖載入失敗')).toBeTruthy()
  })
})

// ===== 容器尺寸變化(缺口 4:preserveViewOnResize) =====
//
// 預設(既有行為):只在容器「從隱藏變可見」時補 resize,並把中心設回初始 center prop。
// preserveViewOnResize=true(給 PlanMap 用,對齊它原本自己的 ResizeObserver):
// 每次非零尺寸回報都補 resize,並把中心設回「目前」的中心——使用者可能已經拖曳/搜尋
// 移動過地圖,拿初始座標會把畫面拉回原點。

async function builtMap(props: Record<string, unknown> = {}) {
  const onHandleChange = vi.fn()
  render(<NativeMapBase center={CENTER} onHandleChange={onHandleChange} {...props} />)
  await waitFor(() => expect(lastHandle(onHandleChange)?.mapReady).toBe(true))
  // 建圖後的保險 resize(requestAnimationFrame)先清掉,避免干擾後面的斷言
  await new Promise((r) => setTimeout(r, 40))
  triggerSpy.mockClear()
  FakeMap.instances[0].setCenter.mockClear()
  return FakeMap.instances[0]
}

describe('NativeMapBase 容器尺寸變化(預設)', () => {
  it('可見 → 可見的尺寸改變:不補 resize', async () => {
    const map = await builtMap()
    reportSize(500, 400)
    expect(triggerSpy).not.toHaveBeenCalled()
    expect(map.setCenter).not.toHaveBeenCalled()
  })

  it('隱藏 → 可見:補 resize,並把中心設回初始 center', async () => {
    const map = await builtMap()
    reportSize(0, 0)
    reportSize(300, 300)
    expect(triggerSpy).toHaveBeenCalledWith(map, 'resize')
    expect(map.setCenter).toHaveBeenCalledWith(CENTER)
  })
})

describe('NativeMapBase preserveViewOnResize=true', () => {
  it('每次非零尺寸改變都補 resize,並把中心設回「目前」的中心(不是初始 center)', async () => {
    const map = await builtMap({ preserveViewOnResize: true })
    reportSize(500, 400)
    expect(triggerSpy).toHaveBeenCalledWith(map, 'resize')
    expect(map.setCenter).toHaveBeenCalledWith(expect.objectContaining({ lat: expect.any(Function), lng: expect.any(Function) }))
    const arg = map.setCenter.mock.calls[0][0] as { lat: () => number; lng: () => number }
    expect({ lat: arg.lat(), lng: arg.lng() }).toEqual({ lat: 23.5, lng: 121.5 })
    expect(map.setCenter).not.toHaveBeenCalledWith(CENTER)
  })

  it('尺寸為 0(元素被隱藏或卸載)時不處理——此時 resize 只會讓 Maps 把畫布記成 0', async () => {
    const map = await builtMap({ preserveViewOnResize: true })
    reportSize(0, 0)
    reportSize(300, 0)
    expect(triggerSpy).not.toHaveBeenCalled()
    expect(map.setCenter).not.toHaveBeenCalled()
  })

  it('隱藏後再顯示:中心設回隱藏前使用者看到的位置,而不是初始 center', async () => {
    const map = await builtMap({ preserveViewOnResize: true })
    reportSize(0, 0)
    view.center = { lat: 24.1, lng: 120.9 } // 隱藏期間使用者看到的中心
    reportSize(300, 300)
    const arg = map.setCenter.mock.calls[map.setCenter.mock.calls.length - 1][0] as { lat: () => number; lng: () => number }
    expect({ lat: arg.lat(), lng: arg.lng() }).toEqual({ lat: 24.1, lng: 120.9 })
  })

  it('地圖還沒建好時收到尺寸回報不會出錯', async () => {
    render(<NativeMapBase center={undefined} preserveViewOnResize />)
    expect(() => reportSize(500, 400)).not.toThrow()
    expect(FakeMap.instances).toHaveLength(0)
  })
})
