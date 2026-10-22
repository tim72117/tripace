// phone/useCurrentLocation:登入後手機的目前位置政策——要取時直接問瀏覽器（會跳授權提示）。
// 桌面版（desktop/useCurrentLocation）同一份政策，測試見 desktop/useCurrentLocation.test.tsx。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useCurrentLocation } from './useCurrentLocation'

function stubGeolocation(getCurrentPosition: unknown) {
  vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } })
}
const ok = (lat: number, lng: number) => (success: PositionCallback) =>
  success({ coords: { latitude: lat, longitude: lng } } as GeolocationPosition)

afterEach(() => vi.unstubAllGlobals())

describe('phone/useCurrentLocation', () => {
  it('wanted 為 false：不碰定位、沒有座標', () => {
    const get = vi.fn()
    stubGeolocation(get)
    const { result } = renderHook(() => useCurrentLocation({ wanted: false }))
    expect(get).not.toHaveBeenCalled()
    expect(result.current.currentPosition).toBeNull()
  })

  it('wanted 變 true：直接問瀏覽器，取到後提供 currentPosition 並通知 onLocated', async () => {
    stubGeolocation(ok(25.033, 121.5654))
    const onLocated = vi.fn()
    const { result } = renderHook(() => useCurrentLocation({ wanted: true, onLocated }))
    await waitFor(() => expect(result.current.currentPosition).toEqual({ lat: 25.033, lng: 121.5654 }))
    expect(onLocated).toHaveBeenCalledWith({ lat: 25.033, lng: 121.5654 })
  })

  it('使用者拒絕或不支援：沒有座標、不通知、不丟例外', async () => {
    stubGeolocation((_s: PositionCallback, e: PositionErrorCallback) => e({ code: 1 } as GeolocationPositionError))
    const onLocated = vi.fn()
    const { result } = renderHook(() => useCurrentLocation({ wanted: true, onLocated }))
    await new Promise((r) => setTimeout(r, 0))
    expect(result.current.currentPosition).toBeNull()
    expect(onLocated).not.toHaveBeenCalled()
  })

  it('wanted 變回 false：座標清空', async () => {
    stubGeolocation(ok(1, 2))
    const { result, rerender } = renderHook((p: { wanted: boolean }) => useCurrentLocation(p), { initialProps: { wanted: true } })
    await waitFor(() => expect(result.current.currentPosition).toEqual({ lat: 1, lng: 2 }))
    rerender({ wanted: false })
    await waitFor(() => expect(result.current.currentPosition).toBeNull())
  })

  it('定位還沒回來就卸載：不寫入、不通知', async () => {
    let finish: PositionCallback = () => {}
    stubGeolocation((s: PositionCallback) => {
      finish = s
    })
    const onLocated = vi.fn()
    const { unmount } = renderHook(() => useCurrentLocation({ wanted: true, onLocated }))
    unmount()
    finish({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition)
    await new Promise((r) => setTimeout(r, 0))
    expect(onLocated).not.toHaveBeenCalled()
  })

  it('wanted 在定位回來前 true → false → true:第一輪的舊結果被丟棄,只採用第二輪(不重複通知)', async () => {
    const callbacks: PositionCallback[] = []
    stubGeolocation((s: PositionCallback) => {
      callbacks.push(s)
    })
    const onLocated = vi.fn()
    const { result, rerender } = renderHook((p: { wanted: boolean }) => useCurrentLocation({ wanted: p.wanted, onLocated }), {
      initialProps: { wanted: true },
    })
    rerender({ wanted: false })
    rerender({ wanted: true })
    await waitFor(() => expect(callbacks).toHaveLength(2))
    callbacks[1]({ coords: { latitude: 2, longitude: 2 } } as GeolocationPosition)
    await waitFor(() => expect(result.current.currentPosition).toEqual({ lat: 2, lng: 2 }))
    callbacks[0]({ coords: { latitude: 1, longitude: 1 } } as GeolocationPosition) // 舊的,晚到
    await new Promise((r) => setTimeout(r, 0))
    expect(result.current.currentPosition).toEqual({ lat: 2, lng: 2 })
    expect(onLocated).toHaveBeenCalledTimes(1)
    expect(onLocated).toHaveBeenCalledWith({ lat: 2, lng: 2 })
  })

  it('request()：wanted 時再問一次並回傳座標；wanted 為 false 回 null', async () => {
    stubGeolocation(ok(3, 4))
    const on = renderHook(() => useCurrentLocation({ wanted: true }))
    await expect(on.result.current.request()).resolves.toEqual({ lat: 3, lng: 4 })
    const off = renderHook(() => useCurrentLocation({ wanted: false }))
    await expect(off.result.current.request()).resolves.toBeNull()
  })
})
