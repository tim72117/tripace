import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDeferredPromptSender } from './useDeferredPromptSender'

describe('useDeferredPromptSender', () => {
  it('已就緒時直接送出並回傳 sendPrompt 的結果', async () => {
    const { result } = renderHook(() => useDeferredPromptSender())
    const send = vi.fn().mockResolvedValue(true)
    result.current.register(send)

    await expect(result.current.submit('我想去東京玩')).resolves.toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('我想去東京玩')
  })

  it('尚未就緒時不丟失:暫存,register 時補送一次', async () => {
    const { result } = renderHook(() => useDeferredPromptSender())

    await expect(result.current.submit('我想去東京玩')).resolves.toBe(false)

    const send = vi.fn().mockResolvedValue(true)
    result.current.register(send)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('我想去東京玩')

    // 補送後不會在下一次 register 又重送。
    const send2 = vi.fn().mockResolvedValue(true)
    result.current.register(send2)
    expect(send2).not.toHaveBeenCalled()
  })

  it('尚未就緒時多次送出,只補送最後一句', async () => {
    const { result } = renderHook(() => useDeferredPromptSender())
    void result.current.submit('第一句')
    void result.current.submit('第二句')

    const send = vi.fn().mockResolvedValue(true)
    result.current.register(send)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('第二句')
  })

  it('對話橋接重建後以最新的 sendPrompt 為準', async () => {
    const { result } = renderHook(() => useDeferredPromptSender())
    const first = vi.fn().mockResolvedValue(true)
    const second = vi.fn().mockResolvedValue(true)
    result.current.register(first)
    result.current.register(second)

    await result.current.submit('hi')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('hi')
  })

  it('沒有待送內容時 register 不會送出任何東西', () => {
    const { result } = renderHook(() => useDeferredPromptSender())
    const send = vi.fn().mockResolvedValue(true)
    result.current.register(send)
    expect(send).not.toHaveBeenCalled()
  })
})
