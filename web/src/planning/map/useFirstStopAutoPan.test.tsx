// useFirstStopAutoPan:首站自動平移,四個入口共用;怎麼平移由呼叫端注入。
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFirstStopAutoPan, usePanWithFirstStopPriority } from './useFirstStopAutoPan'

const stops = [
  { lat: 1, lng: 2 },
  { lat: 3, lng: 4 },
]

describe('useFirstStopAutoPan', () => {
  it('第一站出現且 ready 才平移,只做一次', () => {
    const pan = vi.fn()
    const { rerender } = renderHook(
      (p: { ready: boolean; s: typeof stops }) => useFirstStopAutoPan({ stops: p.s, enabled: true, ready: p.ready, pan }),
      { initialProps: { ready: false, s: stops } },
    )
    expect(pan).not.toHaveBeenCalled()
    rerender({ ready: true, s: stops })
    expect(pan).toHaveBeenCalledTimes(1)
    expect(pan).toHaveBeenCalledWith({ lat: 1, lng: 2 })
    rerender({ ready: true, s: [{ lat: 9, lng: 9 }, ...stops] })
    expect(pan).toHaveBeenCalledTimes(1)
  })
  it('沒有站點、或停用:不平移,之後啟用才補', () => {
    const pan = vi.fn()
    renderHook(() => useFirstStopAutoPan({ stops: [], enabled: true, ready: true, pan }))
    const { rerender } = renderHook(
      (p: { enabled: boolean }) => useFirstStopAutoPan({ stops, enabled: p.enabled, ready: true, pan }),
      { initialProps: { enabled: false } },
    )
    expect(pan).not.toHaveBeenCalled()
    rerender({ enabled: true })
    expect(pan).toHaveBeenCalledWith({ lat: 1, lng: 2 })
  })
})

describe('usePanWithFirstStopPriority', () => {
  it('位置先到、首站後到:兩者都平移(首站最後把地圖移過去)', () => {
    const pan = vi.fn()
    const { result } = renderHook(() => usePanWithFirstStopPriority(pan))
    result.current.panToLocation({ lat: 1, lng: 1 })
    result.current.panToFirstStop({ lat: 2, lng: 2 })
    expect(pan.mock.calls).toEqual([[{ lat: 1, lng: 1 }], [{ lat: 2, lng: 2 }]])
  })

  it('首站平移過之後,晚到的位置平移被忽略(不把地圖拉走)', () => {
    const pan = vi.fn()
    const { result } = renderHook(() => usePanWithFirstStopPriority(pan))
    result.current.panToFirstStop({ lat: 2, lng: 2 })
    result.current.panToLocation({ lat: 1, lng: 1 })
    expect(pan).toHaveBeenCalledTimes(1)
    expect(pan).toHaveBeenCalledWith({ lat: 2, lng: 2 })
  })

  it('兩個函式的身分穩定;pan 換新時用最新的', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = renderHook((p: { pan: (t: { lat: number; lng: number }) => void }) => usePanWithFirstStopPriority(p.pan), {
      initialProps: { pan: first },
    })
    const fns = result.current
    rerender({ pan: second })
    expect(result.current.panToFirstStop).toBe(fns.panToFirstStop)
    expect(result.current.panToLocation).toBe(fns.panToLocation)
    result.current.panToLocation({ lat: 3, lng: 3 })
    expect(second).toHaveBeenCalledWith({ lat: 3, lng: 3 })
    expect(first).not.toHaveBeenCalled()
  })
})
