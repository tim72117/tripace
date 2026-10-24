// usePanTarget 單元測試。
//
// 從 PlanMap 的 panTarget effect 抽出來(2026-10)。PlanMap 整體行為另由
// PlanMap.mapEvents.test.tsx 保護;這裡驗證 hook 自己的契約。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePanTarget } from './usePanTarget'

const circle = { bounds: { tag: 'circle-bounds' } as unknown }

;(globalThis as { google?: unknown }).google = {
  maps: {
    Circle: class {
      getBounds() {
        return circle.bounds
      }
    },
  },
}

function makeMap() {
  return { panTo: vi.fn(), fitBounds: vi.fn(), setZoom: vi.fn() }
}

type Target = NonNullable<Parameters<typeof usePanTarget>[0]['panTarget']>

function setup(overrides: Partial<Parameters<typeof usePanTarget>[0]> = {}) {
  const map = makeMap()
  const onSuppressIdle = vi.fn()
  const base = {
    mapRef: { current: map as unknown as google.maps.Map },
    mapReady: true,
    panTarget: null as Target | null,
    bounds: null as google.maps.LatLngBounds | null,
    zoom: 12,
    onSuppressIdle,
  }
  const props = { ...base, ...overrides }
  const hook = renderHook((p: typeof props) => usePanTarget(p), { initialProps: props })
  return { map, onSuppressIdle, props, hook }
}

beforeEach(() => {
  circle.bounds = { tag: 'circle-bounds' }
})

describe('usePanTarget', () => {
  it('panTarget 為 null 時什麼都不做', () => {
    const { map } = setup({ panTarget: null })
    expect(map.panTo).not.toHaveBeenCalled()
  })

  it('地圖還沒好(mapReady 為 false)時什麼都不做', () => {
    const { map } = setup({ mapReady: false, panTarget: { lat: 1, lng: 2 } })
    expect(map.panTo).not.toHaveBeenCalled()
  })

  it('一般 panTarget:panTo 到該點,不呼叫 fitBounds', () => {
    const t = { lat: 35.2, lng: 135.9 }
    const { map } = setup({ panTarget: t })
    expect(map.panTo).toHaveBeenCalledWith(t)
    expect(map.fitBounds).not.toHaveBeenCalled()
  })

  it('帶 radiusMeters:fitBounds(圓的範圍, 48),不 panTo', () => {
    const { map } = setup({ panTarget: { lat: 1, lng: 2, radiusMeters: 1500 } })
    expect(map.fitBounds).toHaveBeenCalledWith(circle.bounds, 48)
    expect(map.panTo).not.toHaveBeenCalled()
  })

  it('radiusMeters 為 0 或圓算不出範圍時,退回 panTo', () => {
    const a = setup({ panTarget: { lat: 1, lng: 2, radiusMeters: 0 } })
    expect(a.map.panTo).toHaveBeenCalledTimes(1)
    expect(a.map.fitBounds).not.toHaveBeenCalled()

    circle.bounds = null
    const b = setup({ panTarget: { lat: 1, lng: 2, radiusMeters: 500 } })
    expect(b.map.panTo).toHaveBeenCalledTimes(1)
  })

  describe('onlyIfOutOfView', () => {
    it('目標在目前可視範圍內:不平移,也不設抑制旗標', () => {
      const bounds = { contains: () => true } as unknown as google.maps.LatLngBounds
      const { map, onSuppressIdle } = setup({
        bounds,
        panTarget: { lat: 1, lng: 2, onlyIfOutOfView: true, suppressQuery: true },
      })
      expect(map.panTo).not.toHaveBeenCalled()
      expect(onSuppressIdle).not.toHaveBeenCalled()
    })

    it('目標不在可視範圍內:照常平移', () => {
      const bounds = { contains: () => false } as unknown as google.maps.LatLngBounds
      const { map } = setup({ bounds, panTarget: { lat: 1, lng: 2, onlyIfOutOfView: true } })
      expect(map.panTo).toHaveBeenCalledTimes(1)
    })

    it('可視範圍未知(null):保守起見仍平移', () => {
      const { map } = setup({ bounds: null, panTarget: { lat: 1, lng: 2, onlyIfOutOfView: true } })
      expect(map.panTo).toHaveBeenCalledTimes(1)
    })
  })

  describe('suppressQuery', () => {
    it('帶 suppressQuery:平移前通知呼叫端抑制下一次 idle', () => {
      const order: string[] = []
      const map = makeMap()
      map.panTo.mockImplementation(() => order.push('panTo'))
      const onSuppressIdle = vi.fn(() => order.push('suppress'))
      renderHook(() =>
        usePanTarget({
          mapRef: { current: map as unknown as google.maps.Map },
          mapReady: true,
          panTarget: { lat: 1, lng: 2, suppressQuery: true },
          bounds: null,
          zoom: 12,
          onSuppressIdle,
        }),
      )
      expect(order).toEqual(['suppress', 'panTo'])
    })

    it('帶 radiusMeters 的 suppressQuery 也會通知(fitBounds 同樣會造成 idle)', () => {
      const { onSuppressIdle } = setup({ panTarget: { lat: 1, lng: 2, radiusMeters: 800, suppressQuery: true } })
      expect(onSuppressIdle).toHaveBeenCalledTimes(1)
    })

    it('沒帶 suppressQuery:不通知', () => {
      const { onSuppressIdle } = setup({ panTarget: { lat: 1, lng: 2 } })
      expect(onSuppressIdle).not.toHaveBeenCalled()
    })
  })

  describe('level', () => {
    it('目前 zoom 低於該層級需要的縮放:setZoom 到 minZoomForLevel', () => {
      const { map } = setup({ zoom: 5, panTarget: { lat: 1, lng: 2, level: 4 } })
      expect(map.setZoom).toHaveBeenCalledWith(14)
    })

    it('目前 zoom 已足夠:不 setZoom,尊重使用者當下的瀏覽尺度', () => {
      const { map } = setup({ zoom: 16, panTarget: { lat: 1, lng: 2, level: 4 } })
      expect(map.panTo).toHaveBeenCalledTimes(1)
      expect(map.setZoom).not.toHaveBeenCalled()
    })

    it('沒有 level 就不碰 zoom', () => {
      const { map } = setup({ zoom: 3, panTarget: { lat: 1, lng: 2 } })
      expect(map.setZoom).not.toHaveBeenCalled()
    })
  })

  describe('重新渲染', () => {
    it('同一個 panTarget 物件重新渲染不會再平移(避免渲染 → panTo → idle → 查詢 → 渲染的迴圈)', () => {
      const t = { lat: 1, lng: 2 }
      const { map, hook, props } = setup({ panTarget: t })
      hook.rerender({ ...props, panTarget: t, zoom: 13 })
      hook.rerender({ ...props, panTarget: t, bounds: { contains: () => false } as unknown as google.maps.LatLngBounds })
      expect(map.panTo).toHaveBeenCalledTimes(1)
    })

    it('換成新的 panTarget 物件才會再平移', () => {
      const { map, hook, props } = setup({ panTarget: { lat: 1, lng: 2 } })
      hook.rerender({ ...props, panTarget: { lat: 1, lng: 2 } })
      expect(map.panTo).toHaveBeenCalledTimes(2)
    })

    it('mapReady 從 false 變 true 時才執行', () => {
      const t = { lat: 1, lng: 2 }
      const { map, hook, props } = setup({ mapReady: false, panTarget: t })
      expect(map.panTo).not.toHaveBeenCalled()
      hook.rerender({ ...props, mapReady: true, panTarget: t })
      expect(map.panTo).toHaveBeenCalledTimes(1)
    })
  })
})
