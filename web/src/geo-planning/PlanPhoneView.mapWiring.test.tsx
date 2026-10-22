// PlanPhoneView 對 PlanMap 的接線:stops 相關 prop 原樣轉傳、目前位置藍點、首站自動平移與其優先於定位平移。
// mock 掉 PlanMap(capture props)與 useCurrentLocation(控制回傳並攔下 onLocated)。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { PlanPhoneView } from './PlanPhoneView'
import type { ClientConfig } from '../api'
import type { User } from '../user/types'
import type { PlanStopMarker } from './usePlanStopMarkers'

type Captured = Record<string, unknown> & {
  panTarget?: { lat: number; lng: number } | null
  currentPosition?: { lat: number; lng: number } | null
}
let captured: Captured = {}

vi.mock('./PlanMap', () => ({
  EXPLORE_CATEGORY: 'explore',
  PlanMap: (props: Captured & { children?: React.ReactNode }) => {
    captured = props
    return props.children ?? null
  },
}))

let locationArgs: { wanted: boolean; onLocated?: (p: { lat: number; lng: number }) => void } | null = null
let locationResult: { lat: number; lng: number } | null = null
vi.mock('../phone/useCurrentLocation', () => ({
  useCurrentLocation: (args: { wanted: boolean; onLocated?: (p: { lat: number; lng: number }) => void }) => {
    locationArgs = args
    return { currentPosition: locationResult, request: async () => null }
  },
}))

const cfg: ClientConfig = { baseURL: 'http://localhost', token: 'test-token' }
const user: User = { id: 'usr_1', name: '測試使用者', avatarColor: '#000' }

function stop(id: string, lat: number, lng: number): PlanStopMarker {
  return { id, name: id, lat, lng } as unknown as PlanStopMarker
}

function ui(extra: Partial<React.ComponentProps<typeof PlanPhoneView>> = {}) {
  return (
    <PlanPhoneView
      cfg={cfg}
      tripID="trip_1"
      activeTrip={null}
      user={user}
      onOpenSettings={() => {}}
      onOpenTrips={() => {}}
      {...extra}
    />
  )
}

beforeEach(() => {
  captured = {}
  locationArgs = null
  locationResult = null
})

describe('PlanPhoneView 對 PlanMap 的接線', () => {
  it('stops/selectedStopId/hoverStopId/hoverTransitPair/onStopClick/showPlanRouteLine/safeAreaRef 原樣轉給 PlanMap', () => {
    const stops = [stop('a', 25.0, 121.5)]
    const hoverTransitPair = { fromId: 'a', toId: 'b' }
    const onStopClick = vi.fn()
    const safeAreaRef = { current: document.createElement('div') }
    render(
      ui({ stops, selectedStopId: 'a', hoverStopId: 'b', hoverTransitPair, onStopClick, showPlanRouteLine: true, safeAreaRef }),
    )
    expect(captured.stops).toBe(stops)
    expect(captured.selectedStopId).toBe('a')
    expect(captured.hoverStopId).toBe('b')
    expect(captured.hoverTransitPair).toBe(hoverTransitPair)
    expect(captured.onStopClick).toBe(onStopClick)
    expect(captured.showPlanRouteLine).toBe(true)
    expect(captured.safeAreaRef).toBe(safeAreaRef)
  })

  it('沒傳這些 prop 時 PlanMap 收到 undefined(不顯示站點圖層)', () => {
    render(ui())
    expect(captured.stops).toBeUndefined()
    expect(captured.selectedStopId).toBeUndefined()
    expect(captured.showPlanRouteLine).toBeUndefined()
  })

  it('currentPosition 由 useCurrentLocation 提供並傳給 PlanMap', () => {
    locationResult = { lat: 24.1, lng: 120.6 }
    render(ui())
    expect(captured.currentPosition).toEqual({ lat: 24.1, lng: 120.6 })
  })

  it('useCurrentLocation 拿到 onLocated 回呼', () => {
    render(ui())
    expect(typeof locationArgs?.onLocated).toBe('function')
  })
})

describe('PlanPhoneView 首站自動平移', () => {
  it('傳入非空 stops:PlanMap 的 panTarget 出現首站座標', () => {
    render(ui({ stops: [stop('a', 25.04, 121.56), stop('b', 22.6, 120.3)] }))
    expect(captured.panTarget).toMatchObject({ lat: 25.04, lng: 121.56 })
  })

  it('stops 為空:不平移', () => {
    render(ui({ stops: [] }))
    expect(captured.panTarget ?? null).toBeNull()
  })

  it('stops 之後才出現:出現時才平移到首站', () => {
    const { rerender } = render(ui({ stops: [] }))
    expect(captured.panTarget ?? null).toBeNull()
    rerender(ui({ stops: [stop('a', 25.04, 121.56)] }))
    expect(captured.panTarget).toMatchObject({ lat: 25.04, lng: 121.56 })
  })

  it('首站已平移後,定位平移被忽略', () => {
    render(ui({ stops: [stop('a', 25.04, 121.56)] }))
    act(() => locationArgs!.onLocated!({ lat: 1, lng: 2 }))
    expect(captured.panTarget).toMatchObject({ lat: 25.04, lng: 121.56 })
  })

  it('定位先到、首站後到:定位照常平移,首站出現後再移過去', () => {
    const { rerender } = render(ui({ stops: [] }))
    act(() => locationArgs!.onLocated!({ lat: 1, lng: 2 }))
    expect(captured.panTarget).toMatchObject({ lat: 1, lng: 2 })
    rerender(ui({ stops: [stop('a', 25.04, 121.56)] }))
    expect(captured.panTarget).toMatchObject({ lat: 25.04, lng: 121.56 })
  })
})
