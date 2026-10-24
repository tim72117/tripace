import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePlanConversation } from './usePlanConversation'

// usePlanConversation 的回歸測試:純記憶體(不碰 localStorage、卸載後清空)。

beforeEach(() => {
  localStorage.clear()
})

describe('純記憶體', () => {
  it('appendMessage 依發生順序累加,不寫 localStorage', () => {
    const { result } = renderHook(() => usePlanConversation())
    act(() => {
      result.current.appendMessage({ id: 'a', text: '一' })
      result.current.appendMessage({ id: 'b', text: '二' })
    })
    expect(result.current.messages.map((m) => m.id)).toEqual(['a', 'b'])
    expect(localStorage.length).toBe(0)
  })

  it('卸載後重新掛載是空的(重整頁面對話清空)', () => {
    const first = renderHook(() => usePlanConversation())
    act(() => first.result.current.appendMessage({ id: 'a', text: '一' }))
    expect(first.result.current.messages).toHaveLength(1)
    first.unmount()
    const second = renderHook(() => usePlanConversation())
    expect(second.result.current.messages).toEqual([])
  })

  it('兩個實例互不相干(沒有跨實例同步)', () => {
    const a = renderHook(() => usePlanConversation())
    const b = renderHook(() => usePlanConversation())
    act(() => a.result.current.appendMessage({ id: 'from-a', text: 'A' }))
    expect(b.result.current.messages).toEqual([])
  })

  it('同一個 tick 連續 append 不會漏(同步讀最新狀態)', () => {
    const { result } = renderHook(() => usePlanConversation())
    act(() => {
      for (let i = 0; i < 5; i++) result.current.appendMessage({ id: `m${i}`, text: String(i) })
    })
    expect(result.current.messages).toHaveLength(5)
    expect(result.current.conversationRef.current.messages).toHaveLength(5)
  })

  it('staleAll 淡化全部、clearConversation 清空', () => {
    const { result } = renderHook(() => usePlanConversation())
    act(() => {
      result.current.appendMessage({ id: 'a', text: '一' })
      result.current.appendMessage({ id: 'b', text: '二' })
    })
    act(() => result.current.staleAll())
    expect(result.current.messages.every((m) => m.stale)).toBe(true)
    act(() => result.current.clearConversation())
    expect(result.current.messages).toEqual([])
  })

  it('appendMessage 不會順便淡化舊訊息(新訊息出現不代表話題推進)', () => {
    const { result } = renderHook(() => usePlanConversation())
    act(() => {
      result.current.appendMessage({ id: 'a', text: '一' })
      result.current.appendMessage({ id: 'b', text: '二' })
    })
    expect(result.current.messages.some((m) => m.stale)).toBe(false)
  })
})
