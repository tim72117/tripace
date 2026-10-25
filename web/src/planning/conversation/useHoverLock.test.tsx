import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useHoverLock } from './useHoverLock'

describe('useHoverLock', () => {
  it('掛載時鎖住,第一次 pointermove 才解鎖', () => {
    const { result } = renderHook(() => useHoverLock())
    expect(result.current).toBe(true)
    act(() => {
      window.dispatchEvent(new Event('pointermove'))
    })
    expect(result.current).toBe(false)
  })

  it('解鎖後不會再鎖回去', () => {
    const { result } = renderHook(() => useHoverLock())
    act(() => {
      window.dispatchEvent(new Event('pointermove'))
    })
    act(() => {
      window.dispatchEvent(new Event('pointermove'))
    })
    expect(result.current).toBe(false)
  })

  it('每次重新掛載(換到下一個畫面)都重新鎖住', () => {
    const first = renderHook(() => useHoverLock())
    act(() => {
      window.dispatchEvent(new Event('pointermove'))
    })
    expect(first.result.current).toBe(false)
    first.unmount()
    const second = renderHook(() => useHoverLock())
    expect(second.result.current).toBe(true)
  })

  // 卸載後 result.current 本來就不會再變(元件已卸載),只看它無法證明監聽已移除;改成直接檢查卸載時移除的是同一個 handler。
  it('卸載時移除同一個 pointermove handler', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useHoverLock())
    const added = add.mock.calls.filter(([type]) => type === 'pointermove')
    expect(added).toHaveLength(1)
    const handler = added[0][1]
    expect(remove.mock.calls.some(([type, h]) => type === 'pointermove' && h === handler)).toBe(false)
    unmount()
    expect(remove.mock.calls.some(([type, h]) => type === 'pointermove' && h === handler)).toBe(true)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
