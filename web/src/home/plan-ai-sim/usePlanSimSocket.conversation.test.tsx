// usePlanSimSocket 與對話的銜接:模擬劇本的 add_message 寫進獨立的對話狀態(不進時間軸、不持久化),
// 新增站點讓舊訊息淡化,reset 清空對話,clearConversation 供交接使用。
import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePlanSimSocket } from './usePlanSimSocket'
import type { PlanAction } from './planAction'
import type { PlanSimSource } from './planSimSource'
import { listNodes } from '../../plan-core/planTimeline'

beforeEach(() => {
  localStorage.clear()
})

function fakeSource() {
  let cb: ((a: PlanAction) => void) | null = null
  const source: PlanSimSource = {
    onMessage: (c) => {
      cb = c
      return () => {
        cb = null
      }
    },
    onError: () => () => {},
    close: () => {},
  }
  return { source, emit: (a: PlanAction) => cb?.(a) }
}

function setup() {
  const f = fakeSource()
  const hook = renderHook(() => usePlanSimSocket(true, () => f.source))
  return { ...f, ...hook }
}

describe('usePlanSimSocket 的對話', () => {
  it('add_message 寫進對話、不進時間軸,也不碰 localStorage', () => {
    const { result, emit } = setup()
    act(() => emit({ type: 'add_message', id: 'm1', text: '早上先從赤崁樓開始' }))
    expect(result.current.messages).toEqual([{ id: 'm1', text: '早上先從赤崁樓開始' }])
    expect(listNodes(result.current.timeline)).toHaveLength(0)
    expect(localStorage.length).toBe(0)
  })

  it('新增站點後,先前的訊息淡化;之後的新訊息維持新鮮', () => {
    const { result, emit } = setup()
    act(() => emit({ type: 'add_message', id: 'm1', text: '一' }))
    act(() => emit({ type: 'add_stop', id: 's1', name: '赤崁樓', time: '09:00', day: 1, lat: 1, lng: 1 }))
    expect(listNodes(result.current.timeline).map((n) => n.id)).toEqual(['s1'])
    expect(result.current.messages[0].stale).toBe(true)
    act(() => emit({ type: 'add_message', id: 'm2', text: '二' }))
    expect(result.current.messages.map((m) => !!m.stale)).toEqual([true, false])
  })

  it('reset 一併清空對話;clearConversation 清空對話(交接用)', () => {
    const { result, emit } = setup()
    act(() => emit({ type: 'add_message', id: 'm1', text: '一' }))
    act(() => emit({ type: 'reset' }))
    expect(result.current.messages).toEqual([])
    act(() => emit({ type: 'add_message', id: 'm2', text: '二' }))
    act(() => result.current.clearConversation())
    expect(result.current.messages).toEqual([])
  })
})
