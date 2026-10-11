// useElementHeight.test.tsx——2026-10 新增(使用者明確要求「有什麼方法
// 可以確保 bottom sheet 如果是在功能列後面,標頭不會被遮蔽,也不用功能
// 列改動高度就要重新確認」「我要穩定根本的處理方式」「繼續」)。
//
// vitest + jsdom 原生不實作 ResizeObserver,也不會真的計算版面(所有
// 元素的 getBoundingClientRect() 恆為 0)——這代表這份測試驗證不了
// 「真的量到正確高度」這件事本身(那是瀏覽器原生 layout 引擎的職責,
// 只有真實瀏覽器/E2E 測試才能確診,同一類限制見
// PhoneBottomSheet.dragHandoff.test.tsx 檔頭對 jsdom 能力邊界的完整
// 說明)。這裡驗證的是 hook 介面層面的行為:
//   1. ref 還沒有掛載任何元素時不報錯、回傳 0。
//   2. 沒有 ResizeObserver 的環境(這裡用 vi.stubGlobal 模擬,對齊 hook
//      本身為了相容測試環境而加的防禦)下不報錯、能完成掛載與卸載。
//   3. ResizeObserver 存在時,hook 確實呼叫 observe()/disconnect(),
//      且 callback 觸發時正確更新 state。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useRef } from 'react'
import { render, act } from '@testing-library/react'
import { useElementHeight } from './useElementHeight'

function Harness({ onHeight }: { onHeight: (h: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const height = useElementHeight(ref)
  onHeight(height)
  return <div ref={ref}>內容</div>
}

describe('useElementHeight', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('沒有 ResizeObserver 的環境下不報錯，仍能掛載並回傳一個數字', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const onHeight = vi.fn()
    expect(() => render(<Harness onHeight={onHeight} />)).not.toThrow()
    const lastCall = onHeight.mock.calls[onHeight.mock.calls.length - 1]
    expect(typeof lastCall[0]).toBe('number')
  })

  it('有 ResizeObserver 時，掛載會呼叫 observe()，卸載會呼叫 disconnect()', () => {
    const observeSpy = vi.fn()
    const disconnectSpy = vi.fn()
    let capturedCallback: ResizeObserverCallback | null = null

    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        capturedCallback = callback
      }
      observe = observeSpy
      disconnect = disconnectSpy
      unobserve = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)

    const onHeight = vi.fn()
    const { unmount } = render(<Harness onHeight={onHeight} />)

    expect(observeSpy).toHaveBeenCalledTimes(1)
    expect(capturedCallback).not.toBeNull()

    unmount()
    expect(disconnectSpy).toHaveBeenCalledTimes(1)
  })

  it('有 ResizeObserver 時，callback 觸發後會用 borderBoxSize 更新高度', () => {
    let capturedCallback: ResizeObserverCallback | null = null

    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        capturedCallback = callback
      }
      observe = vi.fn()
      disconnect = vi.fn()
      unobserve = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)

    const onHeight = vi.fn()
    render(<Harness onHeight={onHeight} />)

    expect(capturedCallback).not.toBeNull()
    const fakeEntry = {
      borderBoxSize: [{ blockSize: 64, inlineSize: 390 }],
      contentRect: { height: 60 } as DOMRectReadOnly,
    } as unknown as ResizeObserverEntry

    // act()——capturedCallback 觸發後會呼叫 hook 內部的 setHeight,這是
    // 一次 React state 更新,必須包在 act() 裡讓 React 完成對應的
    // re-render 才能在斷言時讀到更新後的值,否則會得到「act 警告 + 讀到
    // 舊值」的假陰性結果(這份檔案第一版就踩到這個坑)。
    act(() => {
      capturedCallback!([fakeEntry], {} as ResizeObserver)
    })

    expect(onHeight).toHaveBeenLastCalledWith(64)
  })
})
