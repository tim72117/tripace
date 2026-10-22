// useMapViewport / useMapIdle 的單元測試。
//
// 這兩個 hook 是從 PlanMap 的建圖 effect 抽出來的(zoom_changed、bounds_changed、
// idle、click 監聽器),規則見各 hook 檔頭。PlanMap 整體行為由
// PlanMap.mapEvents.test.tsx 與 PlanMap.poiClick.test.tsx 保護;這裡只驗證
// hook 自己的契約:什麼時候註冊、事件來了做什麼、重建與卸載時如何清理。
import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMapViewport, useMapIdle } from './useMapEvents'

type Listener = (event?: unknown) => void

function makeMap() {
  const listeners: Record<string, Listener[]> = {}
  const removed: string[] = []
  const state = { zoom: 12 as number | undefined, bounds: null as unknown, center: { lat: 1, lng: 2 } as { lat: number; lng: number } | null }
  const map = {
    addListener: (event: string, handler: Listener) => {
      listeners[event] = listeners[event] ?? []
      listeners[event].push(handler)
      return { remove: () => removed.push(event) }
    },
    getZoom: () => state.zoom,
    getBounds: () => state.bounds,
    getCenter: () => (state.center ? { lat: () => state.center!.lat, lng: () => state.center!.lng } : undefined),
  }
  const emit = (event: string, payload?: unknown) => act(() => (listeners[event] ?? []).forEach((h) => h(payload)))
  return { map: map as unknown as google.maps.Map, listeners, removed, state, emit }
}

const refOf = (map: google.maps.Map) => ({ current: map })

describe('useMapViewport', () => {
  it('初始 zoom 為 12、bounds 為 null', () => {
    const m = makeMap()
    const { result } = renderHook(() => useMapViewport({ mapRef: refOf(m.map), mapReady: true }))
    expect(result.current).toEqual({ zoom: 12, bounds: null })
  })

  it('掛上時以地圖目前的實際 zoom 與 bounds 播種(建圖時帶入的 zoom 不會觸發 zoom_changed)', () => {
    const m = makeMap()
    m.state.zoom = 14
    const b = { tag: 'b' }
    m.state.bounds = b
    const { result } = renderHook(() => useMapViewport({ mapRef: refOf(m.map), mapReady: true }))
    expect(result.current.zoom).toBe(14)
    expect(result.current.bounds).toBe(b)
  })

  it('mapReady 為 false 時不註冊監聽器', () => {
    const m = makeMap()
    renderHook(() => useMapViewport({ mapRef: refOf(m.map), mapReady: false }))
    expect(m.listeners.zoom_changed).toBeUndefined()
    expect(m.listeners.bounds_changed).toBeUndefined()
  })

  it('zoom_changed 把地圖目前縮放寫進 zoom;取不到時退回 12', () => {
    const m = makeMap()
    const { result } = renderHook(() => useMapViewport({ mapRef: refOf(m.map), mapReady: true }))
    m.state.zoom = 7
    m.emit('zoom_changed')
    expect(result.current.zoom).toBe(7)
    m.state.zoom = undefined
    m.emit('zoom_changed')
    expect(result.current.zoom).toBe(12)
  })

  it('bounds_changed 把地圖目前可視範圍寫進 bounds;取不到時為 null', () => {
    const m = makeMap()
    const { result } = renderHook(() => useMapViewport({ mapRef: refOf(m.map), mapReady: true }))
    const b = { tag: 'b' }
    m.state.bounds = b
    m.emit('bounds_changed')
    expect(result.current.bounds).toBe(b)
    m.state.bounds = undefined
    m.emit('bounds_changed')
    expect(result.current.bounds).toBeNull()
  })

  it('卸載時移除兩個監聽器', () => {
    const m = makeMap()
    const { unmount } = renderHook(() => useMapViewport({ mapRef: refOf(m.map), mapReady: true }))
    unmount()
    expect(m.removed.sort()).toEqual(['bounds_changed', 'zoom_changed'])
  })

  it('mapVersion 改變(地圖被重建)時,對新實例重新註冊', () => {
    const a = makeMap()
    const b = makeMap()
    const ref = { current: a.map }
    const { rerender } = renderHook(({ v }) => useMapViewport({ mapRef: ref, mapReady: true, mapVersion: v }), {
      initialProps: { v: 0 },
    })
    expect(a.listeners.zoom_changed).toHaveLength(1)
    ref.current = b.map
    rerender({ v: 1 })
    expect(a.removed).toContain('zoom_changed') // 舊實例清掉
    expect(b.listeners.zoom_changed).toHaveLength(1) // 新實例註冊
  })
})

describe('useMapIdle', () => {
  it('idle 時把中心轉成 {lat,lng} 交給 onIdle', () => {
    const m = makeMap()
    const onIdle = vi.fn()
    renderHook(() => useMapIdle({ mapRef: refOf(m.map), mapReady: true, onIdle }))
    m.state.center = { lat: 35.1, lng: 135.2 }
    m.emit('idle')
    expect(onIdle).toHaveBeenCalledWith({ lat: 35.1, lng: 135.2 })
  })

  it('取不到中心時 onIdle 收到 null(呼叫端仍要能處理 idle 本身)', () => {
    const m = makeMap()
    const onIdle = vi.fn()
    renderHook(() => useMapIdle({ mapRef: refOf(m.map), mapReady: true, onIdle }))
    m.state.center = null
    m.emit('idle')
    expect(onIdle).toHaveBeenCalledWith(null)
  })

  it('mapReady 為 false 時不註冊;卸載時移除', () => {
    const m = makeMap()
    const off = renderHook(() => useMapIdle({ mapRef: refOf(m.map), mapReady: false, onIdle: vi.fn() }))
    expect(m.listeners.idle).toBeUndefined()
    off.unmount()

    const m2 = makeMap()
    const on = renderHook(() => useMapIdle({ mapRef: refOf(m2.map), mapReady: true, onIdle: vi.fn() }))
    on.unmount()
    expect(m2.removed).toEqual(['idle'])
  })

  it('onIdle 換成新的函式不會重新註冊監聽器,但事件會呼叫到最新的那個', () => {
    const m = makeMap()
    const first = vi.fn()
    const second = vi.fn()
    const ref = refOf(m.map) // 實際的 mapRef 是穩定的 useRef;在 callback 裡每次建新物件會讓 effect 重跑
    const { rerender } = renderHook(({ cb }) => useMapIdle({ mapRef: ref, mapReady: true, onIdle: cb }), {
      initialProps: { cb: first },
    })
    rerender({ cb: second })
    expect(m.listeners.idle).toHaveLength(1)
    m.emit('idle')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('mapVersion 改變時對新實例重新註冊', () => {
    const a = makeMap()
    const b = makeMap()
    const ref = { current: a.map }
    const { rerender } = renderHook(({ v }) => useMapIdle({ mapRef: ref, mapReady: true, mapVersion: v, onIdle: vi.fn() }), {
      initialProps: { v: 0 },
    })
    ref.current = b.map
    rerender({ v: 1 })
    expect(a.removed).toContain('idle')
    expect(b.listeners.idle).toHaveLength(1)
  })
})
