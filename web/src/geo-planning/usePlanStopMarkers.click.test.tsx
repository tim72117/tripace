// usePlanStopMarkers 點擊回呼簽章——onPointClick 與 useMapMarkerLayer 的同名回呼對齊:
// 兩個參數 (id, point),第二個是被點的那個點本身(2026-10,使用者要求兩邊功能相同的
// 參數命名與簽章對齊,為之後把 PlanMap 換成 useMapMarkerLayer 鋪路)。
// mock 手法同 mapMarkerLayer/useMapMarkerLayer.test.tsx。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePlanStopMarkers, type PlanStopMarker } from './usePlanStopMarkers'

class FakeAdvancedMarker {
  clickHandlers: (() => void)[] = []
  title: string | undefined
  constructor(opts: { title?: string }) {
    this.title = opts.title
    advancedMarkers.push(this)
  }
  addListener(event: string, handler: () => void) {
    if (event === 'gmp-click') this.clickHandlers.push(handler)
    return { remove: () => {} }
  }
  click() {
    this.clickHandlers.forEach((h) => h())
  }
}

class FakeOverlay {
  constructor(
    _position: unknown,
    public title: string | undefined,
    public onClick: (() => void) | undefined,
  ) {
    overlays.push(this)
  }
  setState() {}
  setZIndex() {}
  setMap() {}
}

let advancedMarkers: FakeAdvancedMarker[] = []
let overlays: FakeOverlay[] = []

vi.mock('./mapMarkers', () => ({
  planStopMarkerContent: (state: string) => ({ state }),
}))
vi.mock('./planStopOverlay', () => ({
  getPlanStopOverlayClass: () => FakeOverlay,
}))

;(globalThis as { google?: unknown }).google = {
  maps: {
    marker: { AdvancedMarkerElement: FakeAdvancedMarker },
    LatLng: class {
      constructor(
        public lat: number,
        public lng: number,
      ) {}
    },
    event: { clearInstanceListeners: () => {} },
  },
}

function makeMapRef() {
  const div = document.createElement('div')
  return { current: { getDiv: () => div } as unknown as google.maps.Map }
}

const A: PlanStopMarker = { id: 'a', lat: 1, lng: 1, name: 'A' }
const B: PlanStopMarker = { id: 'b', lat: 2, lng: 2, name: 'B' }

beforeEach(() => {
  advancedMarkers = []
  overlays = []
})

describe('usePlanStopMarkers onPointClick 簽章', () => {
  it('AdvancedMarker 路徑:點擊回報 (id, 被點的那個點)', () => {
    const onPointClick = vi.fn()
    renderHook(() =>
      usePlanStopMarkers({ mapRef: makeMapRef(), mapReady: true, points: [A, B], onPointClick }),
    )
    advancedMarkers.find((m) => m.title === 'B')!.click()
    expect(onPointClick).toHaveBeenCalledTimes(1)
    expect(onPointClick).toHaveBeenCalledWith('b', B)
  })

  it('Overlay(手繪地圖)路徑:同樣回報 (id, 被點的那個點)', () => {
    const onPointClick = vi.fn()
    renderHook(() =>
      usePlanStopMarkers({
        mapRef: makeMapRef(),
        mapReady: true,
        points: [A, B],
        onPointClick,
        useAdvancedMarkers: false,
      }),
    )
    overlays.find((o) => o.title === 'A')!.onClick!()
    expect(onPointClick).toHaveBeenCalledWith('a', A)
  })

  it('只收 id 的舊式回呼仍可用(第二個參數被忽略)', () => {
    const onlyId = vi.fn((id: string) => id)
    renderHook(() => usePlanStopMarkers({ mapRef: makeMapRef(), mapReady: true, points: [A], onPointClick: onlyId }))
    advancedMarkers[0].click()
    expect(onlyId.mock.calls[0][0]).toBe('a')
  })

  it('沒傳 onPointClick 時,點擊不會出錯', () => {
    renderHook(() => usePlanStopMarkers({ mapRef: makeMapRef(), mapReady: true, points: [A] }))
    expect(() => advancedMarkers[0].click()).not.toThrow()
  })
})
