// planning/preview/useCurrentLocation 契約測試——政策見該檔檔頭：已授權才靜默取，不主動跳授權提示。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useCurrentLocation } from './useCurrentLocation'

type PermState = 'granted' | 'prompt' | 'denied'
const getCurrentPosition = vi.fn()
const query = vi.fn()

function setNavigator(opts: { geolocation?: boolean; permissions?: boolean }) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: opts.geolocation === false ? undefined : { getCurrentPosition },
  })
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: opts.permissions === false ? undefined : { query },
  })
}
const permission = (state: PermState) => query.mockResolvedValue({ state })
function geoOk(lat = 25.03, lng = 121.56) {
  getCurrentPosition.mockImplementation((ok: (p: unknown) => void) => ok({ coords: { latitude: lat, longitude: lng } }))
}

beforeEach(() => {
  getCurrentPosition.mockReset()
  query.mockReset()
  setNavigator({})
})

describe('planning/preview/useCurrentLocation', () => {
  it('未啟用：完全不呼叫定位與權限 API', async () => {
    renderHook(() => useCurrentLocation({ wanted: false }))
    await act(async () => {})
    expect(query).not.toHaveBeenCalled()
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('已授權：啟用後靜默取得座標', async () => {
    permission('granted')
    geoOk()
    const { result } = renderHook(() => useCurrentLocation({ wanted: true }))
    await waitFor(() => expect(result.current.currentPosition).toEqual({ lat: 25.03, lng: 121.56 }))
  })

  it('尚未授權（prompt）：不主動取得，不跳授權提示', async () => {
    permission('prompt')
    const { result } = renderHook(() => useCurrentLocation({ wanted: true }))
    await act(async () => {})
    expect(getCurrentPosition).not.toHaveBeenCalled()
    expect(result.current.currentPosition).toBeNull()
  })

  it('prompt 時使用者主動 request()：才呼叫定位並取得座標', async () => {
    permission('prompt')
    geoOk(1, 2)
    const { result } = renderHook(() => useCurrentLocation({ wanted: true }))
    await act(async () => {})
    let pos: unknown
    await act(async () => {
      pos = await result.current.request()
    })
    expect(pos).toEqual({ lat: 1, lng: 2 })
    expect(result.current.currentPosition).toEqual({ lat: 1, lng: 2 })
  })

  it('未啟用時呼叫 request()：不動作', async () => {
    geoOk()
    const { result } = renderHook(() => useCurrentLocation({ wanted: false }))
    await expect(result.current.request()).resolves.toBeNull()
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('已拒絕：不取得、request() 也不再呼叫定位', async () => {
    permission('denied')
    const { result } = renderHook(() => useCurrentLocation({ wanted: true }))
    await act(async () => {})
    await expect(result.current.request()).resolves.toBeNull()
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('不支援 permissions API 或 query 丟例外：退回不取得，不丟例外', async () => {
    setNavigator({ permissions: false })
    const a = renderHook(() => useCurrentLocation({ wanted: true }))
    await act(async () => {})
    expect(a.result.current.currentPosition).toBeNull()
    setNavigator({})
    query.mockRejectedValue(new Error('unsupported'))
    const b = renderHook(() => useCurrentLocation({ wanted: true }))
    await act(async () => {})
    expect(b.result.current.currentPosition).toBeNull()
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('不支援 geolocation 或定位失敗：request() 回 null，不丟例外', async () => {
    permission('prompt')
    setNavigator({ geolocation: false })
    const a = renderHook(() => useCurrentLocation({ wanted: true }))
    await act(async () => {})
    await expect(a.result.current.request()).resolves.toBeNull()
    setNavigator({})
    getCurrentPosition.mockImplementation((_ok: unknown, err: (e: unknown) => void) => err({ code: 1 }))
    const b = renderHook(() => useCurrentLocation({ wanted: true }))
    await act(async () => {})
    await expect(b.result.current.request()).resolves.toBeNull()
  })

  it('停用後座標清空（回到播放態不留藍點）', async () => {
    permission('granted')
    geoOk()
    const { result, rerender } = renderHook((p: { wanted: boolean }) => useCurrentLocation(p), { initialProps: { wanted: true } })
    await waitFor(() => expect(result.current.currentPosition).not.toBeNull())
    rerender({ wanted: false })
    await waitFor(() => expect(result.current.currentPosition).toBeNull())
  })

  it('已授權取得座標時通知 onLocated（/ai-plan 不傳，藍點不移動鏡頭）', async () => {
    permission('granted')
    geoOk(5, 6)
    const onLocated = vi.fn()
    renderHook(() => useCurrentLocation({ wanted: true, onLocated }))
    await waitFor(() => expect(onLocated).toHaveBeenCalledWith({ lat: 5, lng: 6 }))
  })
})
