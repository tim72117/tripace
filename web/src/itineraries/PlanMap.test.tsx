// PlanMap(itineraries)——行程詳情頁的地圖元件:NativeMapBase 建圖,共同 prop 經 usePlanMapDrawing 交給統一繪製層。
// mock 掉 NativeMapBase 與 useSharedDrawLayer,只驗證元件把什麼交給誰。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import type { MapHandle } from '../geo-planning/NativeMapBase'
import { PlanMap } from './PlanMap'

type BaseProps = { center?: unknown; zoom?: number; mapId?: string; theme?: unknown; onHandleChange?: (h: MapHandle) => void }
let baseProps: BaseProps | null = null
const drawArgs: Record<string, unknown>[] = []

vi.mock('../geo-planning/NativeMapBase', () => ({
  NativeMapBase: (props: BaseProps) => {
    baseProps = props
    return <div data-testid="native-map" />
  },
}))
vi.mock('../geo-planning/mapDrawLayer/useSharedDrawLayer', () => ({
  useSharedDrawLayer: (args: Record<string, unknown>) => {
    drawArgs.push(args)
    return { expandedThemeId: null }
  },
}))

beforeEach(() => {
  baseProps = null
  drawArgs.length = 0
})

const stops = [{ id: 's1', lat: 1, lng: 2 }]

describe('itineraries PlanMap', () => {
  it('NativeMapBase 拿到 center、zoom、mapId、theme;children 渲染在地圖旁', () => {
    const { getByTestId } = render(
      <PlanMap initialCenter={{ lat: 1, lng: 2 }} zoom={15} mapId="m" theme="dark" stops={stops}>
        <div data-testid="vignette" />
      </PlanMap>,
    )
    expect(baseProps).toMatchObject({ center: { lat: 1, lng: 2 }, zoom: 15, mapId: 'm', theme: 'dark' })
    expect(getByTestId('vignette')).toBeTruthy()
  })

  it('共同 prop 轉成統一繪製層的輸入:站點、選取、hover、點圓點回報,沒有藍點與整條路線', () => {
    const onStopClick = vi.fn()
    const extra = [{ id: 'x', drawables: [] }]
    render(
      <PlanMap initialCenter={undefined} stops={stops} selectedStopId="s1" hoverStopId="s2" onStopClick={onStopClick} extraLayers={extra} />,
    )
    const args = drawArgs[drawArgs.length - 1] as { stopDots: Record<string, unknown>; currentPosition: unknown; routeLine: { enabled: boolean }; extraLayers: unknown }
    expect(args.stopDots).toMatchObject({ stops, selectedId: 's1', hoverId: 's2', onPointClick: onStopClick })
    expect(args.currentPosition).toBeNull()
    expect(args.routeLine.enabled).toBe(false)
    expect(args.extraLayers).toBe(extra)
  })

  it('地圖就緒後把 MapHandle 交給統一繪製層與 onHandleChange', () => {
    const onHandleChange = vi.fn()
    render(<PlanMap initialCenter={undefined} stops={stops} onHandleChange={onHandleChange} />)
    const handle: MapHandle = { mapRef: { current: {} as google.maps.Map }, mapReady: true, mapVersion: 1 }
    act(() => baseProps?.onHandleChange?.(handle))
    expect(onHandleChange).toHaveBeenCalledWith(handle)
    const args = drawArgs[drawArgs.length - 1] as { mapReady: boolean; mapVersion: number }
    expect(args.mapReady).toBe(true)
    expect(args.mapVersion).toBe(1)
  })
})
