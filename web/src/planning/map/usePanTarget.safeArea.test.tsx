// usePanTarget 的 safeAreaRef 選項:把「移到目標點」換成「移到讓目標落在安全區中心」。
// 平移本身交給共用的 panMapTo(與 /ai-plan 的 useMapSafeArea 同一條路),這裡 mock 掉它,只驗證 usePanTarget
// 交給它什麼。沒傳 safeAreaRef 時行為與原本完全相同,由 usePanTarget.test.tsx 保護。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const pan = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('./panMapTo', () => ({ panMapTo: (...a: unknown[]) => pan.fn(...a) }))

import { usePanTarget } from './usePanTarget'

;(globalThis as { google?: unknown }).google = {
  maps: {
    Circle: class {
      getBounds() {
        return null
      }
    },
  },
}

function setup(over: Partial<Parameters<typeof usePanTarget>[0]> = {}) {
  const map = { panTo: vi.fn(), fitBounds: vi.fn(), setZoom: vi.fn() }
  const base = {
    mapRef: { current: map as unknown as google.maps.Map },
    mapReady: true,
    panTarget: { lat: 1, lng: 2 } as Parameters<typeof usePanTarget>[0]['panTarget'],
    bounds: null as google.maps.LatLngBounds | null,
    zoom: 12,
    onSuppressIdle: vi.fn(),
  }
  const props = { ...base, ...over }
  renderHook((p: typeof props) => usePanTarget(p), { initialProps: props })
  return { map, props }
}

beforeEach(() => {
  pan.fn.mockReset()
})

describe('usePanTarget + safeAreaRef', () => {
  it('帶 safeAreaRef:平移交給 panMapTo,並把安全區元素一起交過去', () => {
    const el = document.createElement('div')
    const { map, props } = setup({ safeAreaRef: { current: el } })
    expect(pan.fn).toHaveBeenCalledTimes(1)
    expect(pan.fn).toHaveBeenCalledWith(map, props.panTarget, el)
  })

  it('沒傳 safeAreaRef:仍走 panMapTo,但沒有安全區元素(panMapTo 退回 map.panTo)', () => {
    const { map, props } = setup()
    expect(pan.fn).toHaveBeenCalledWith(map, props.panTarget, undefined)
  })

  it('safeAreaRef 還沒掛上元素(current 為 null):交過去 null', () => {
    setup({ safeAreaRef: { current: null } })
    expect(pan.fn.mock.calls[0][2]).toBeNull()
  })

  it('fitBounds 的情況(帶 radiusMeters 且算得出範圍)不經過 panMapTo,也不受安全區影響', () => {
    ;(globalThis as { google: { maps: { Circle: unknown } } }).google.maps.Circle = class {
      getBounds() {
        return { tag: 'b' }
      }
    }
    const { map } = setup({ panTarget: { lat: 1, lng: 2, radiusMeters: 100 }, safeAreaRef: { current: document.createElement('div') } })
    expect(map.fitBounds).toHaveBeenCalled()
    expect(pan.fn).not.toHaveBeenCalled()
  })
})
