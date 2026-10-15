import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTypewriter } from './useTypewriter'

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }))
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useTypewriter', () => {
  it('一般模式:逐字顯示,打完整句才回報 done', () => {
    stubReducedMotion(false)
    vi.useFakeTimers()
    const { result } = renderHook(() => useTypewriter('想去哪裡?', 10))

    expect(result.current).toEqual({ displayedText: '', done: false })
    act(() => { vi.advanceTimersByTime(10) })
    expect(result.current.displayedText).toBe('想')
    expect(result.current.done).toBe(false)
    act(() => { vi.advanceTimersByTime(40) })
    expect(result.current).toEqual({ displayedText: '想去哪裡?', done: true })
  })

  it('一般模式:空字串代表尚未開始,不回報 done', () => {
    stubReducedMotion(false)
    const { result } = renderHook(() => useTypewriter(''))

    expect(result.current).toEqual({ displayedText: '', done: false })
  })

  it('減少動態:非空文字整句直接顯示並回報 done', () => {
    stubReducedMotion(true)
    const { result } = renderHook(() => useTypewriter('想去哪裡?'))

    expect(result.current).toEqual({ displayedText: '想去哪裡?', done: true })
  })

  // 回歸:呼叫端(DestinationPrompt)在氣泡進場動畫結束前餵空字串。
  // 減少動態分支若直接 setDone(true),選項膠囊會在題目還是空白時先出現。
  it('減少動態:空字串同樣代表尚未開始,不回報 done', () => {
    stubReducedMotion(true)
    const { result } = renderHook(() => useTypewriter(''))

    expect(result.current).toEqual({ displayedText: '', done: false })
  })

  it('減少動態:從空字串變成有文字後,才回報 done', () => {
    stubReducedMotion(true)
    const { result, rerender } = renderHook(({ text }) => useTypewriter(text), {
      initialProps: { text: '' },
    })
    expect(result.current.done).toBe(false)

    rerender({ text: '想去哪個城市?' })
    expect(result.current).toEqual({ displayedText: '想去哪個城市?', done: true })
  })
})
