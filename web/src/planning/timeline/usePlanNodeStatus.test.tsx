import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePlanNodeStatus } from './usePlanNodeStatus'
import { createEmptyTimeline, insertAfter, removeNode, type PlanTimeline } from './model'

function withNodes(...ids: string[]): PlanTimeline {
  let t = createEmptyTimeline()
  for (const id of ids) {
    const r = insertAfter(t, null, { type: 'stop', name: id }, id)
    if (!r.ok) throw new Error('setup')
    t = r.timeline
  }
  return t
}

describe('usePlanNodeStatus', () => {
  it('setStatus/clearStatus 更新狀態表,nodeStatusRef 同步是最新值', () => {
    const t = withNodes('a')
    const ref = { current: t }
    const { result } = renderHook(() => usePlanNodeStatus(t, ref))
    act(() => result.current.setStatus('a', { loading: true }))
    expect(result.current.nodeStatus.get('a')).toEqual({ loading: true })
    act(() => {
      result.current.setStatus('a', { removing: true })
      expect(result.current.nodeStatusRef.current.get('a')).toEqual({ loading: true, removing: true })
    })
    act(() => result.current.clearStatus('a'))
    expect(result.current.nodeStatus.size).toBe(0)
  })

  it('節點被移除(時間軸變動)就修剪掉對應狀態,其餘保留', () => {
    let t = withNodes('a', 'b')
    const ref = { current: t }
    const { result, rerender } = renderHook(() => usePlanNodeStatus(ref.current, ref))
    act(() => {
      result.current.setStatus('a', { removing: true })
      result.current.setStatus('b', { loading: true })
    })
    const removed = removeNode(t, 'a')
    if (!removed.ok) throw new Error('setup')
    t = removed.timeline
    ref.current = t
    rerender()
    expect([...result.current.nodeStatus.keys()]).toEqual(['b'])
  })

  it('剛插入的節點先標狀態:修剪讀 timelineRef(最新),不會被舊的 timeline 參數誤丟', () => {
    const old = withNodes('a')
    const ref = { current: old }
    const { result, rerender } = renderHook(({ t }) => usePlanNodeStatus(t, ref), { initialProps: { t: old } })
    const next = insertAfter(old, 'a', { type: 'stop', name: 'n' }, 'n')
    if (!next.ok) throw new Error('setup')
    // timelineRef 已是最新、render 還拿舊 timeline 的瞬間標狀態
    ref.current = next.timeline
    act(() => result.current.setStatus('n', { loading: true }))
    rerender({ t: old })
    expect(result.current.nodeStatus.get('n')).toEqual({ loading: true })
  })
})
