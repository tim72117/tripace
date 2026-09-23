// useSyncedState.test.tsx — 核心要驗證的是這個 hook 存在的唯一理由:
// commit() 的回傳值必須在呼叫當下就是同步、確定的結果,即使 commit 是
// 從 React 事件系統之外的地方呼叫(setTimeout、原生事件回呼——這正是
// 真實踩過的坑,見 useSyncedState.ts 開頭的完整背景說明)。若這個 hook
// 的實作又不小心退化回「updater 內賦值、外部讀取」那個危險模式,這裡
// 的測試會直接失敗(讀到 undefined),不需要等到接上真正的 WebSocket/
// onagent 才發現。
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSyncedState } from './useSyncedState'

describe('useSyncedState', () => {
  it('commit 回傳值在呼叫當下就是同步結果,不是 undefined', () => {
    const { result } = renderHook(() => useSyncedState<number>(0))
    let commitResult: string | undefined
    act(() => {
      const [, , commit] = result.current
      commitResult = commit((current) => ({ next: current + 1, result: `now ${current + 1}` }))
    })
    expect(commitResult).toBe('now 1')
  })

  it('compute 回傳 next 時,ref 與 state 都會更新', () => {
    const { result } = renderHook(() => useSyncedState<number>(0))
    act(() => {
      const [, , commit] = result.current
      commit((current) => ({ next: current + 5, result: undefined }))
    })
    const [ref, state] = result.current
    expect(ref.current).toBe(5)
    expect(state).toBe(5)
  })

  it('compute 不給 next(驗證失敗情境)時,ref 與 state 都維持不變', () => {
    const { result } = renderHook(() => useSyncedState<number>(10))
    let commitResult: { ok: boolean } | undefined
    act(() => {
      const [, , commit] = result.current
      commitResult = commit(() => ({ result: { ok: false } }))
    })
    const [ref, state] = result.current
    expect(commitResult).toEqual({ ok: false })
    expect(ref.current).toBe(10)
    expect(state).toBe(10)
  })

  it('連續兩次 commit(模擬 LLM 連續呼叫兩次工具),第二次看得到第一次的結果', () => {
    const { result } = renderHook(() => useSyncedState<string[]>([]))
    act(() => {
      const [, , commit] = result.current
      commit((current) => ({ next: [...current, 'a'], result: current.length }))
      // 關鍵:第二次呼叫緊接在第一次之後、同一個 act() 內——若這個 hook
      // 的實作退化回「讀 useState 閉包裡的舊值」,這裡讀到的 current 會是
      // 空陣列(第一次呼叫前的舊狀態),而不是已經包含 'a' 的陣列。
      const secondResult = commit((current) => ({ next: [...current, 'b'], result: current.length }))
      expect(secondResult).toBe(1) // 第二次呼叫時,current 已經是 ['a'](長度 1)
    })
    const [ref] = result.current
    expect(ref.current).toEqual(['a', 'b'])
  })

  it('在 React 事件系統之外呼叫 commit(模擬 WebSocket onmessage/setTimeout 等原生回呼),回傳值依然是同步、確定的結果', async () => {
    const { result } = renderHook(() => useSyncedState<number>(0))

    // 這是真實踩過的坑重現的核心情境:setTimeout 回呼完全在 React 的
    // 事件系統之外,若 commit 內部依賴「updater 會同步執行」這種不成立
    // 的假設,這裡讀到的 commitResult 就會是 undefined。
    const commitResult = await new Promise<number>((resolve) => {
      setTimeout(() => {
        const [, , commit] = result.current
        const r = commit((current) => ({ next: current + 100, result: current + 100 }))
        resolve(r)
      }, 0)
    })

    expect(commitResult).toBe(100)
  })
})
