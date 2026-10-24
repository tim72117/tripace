import { describe, it, expect } from 'vitest'
import { clearNodeStatus, EMPTY_NODE_STATUS, nodeStatusOf, pruneNodeStatus, setNodeStatus } from './status'

describe('planNodeStatus(純函式)', () => {
  it('setNodeStatus 合併旗標;false 代表清掉,沒寫到的旗標不動', () => {
    let m = setNodeStatus(EMPTY_NODE_STATUS, 'a', { loading: true })
    m = setNodeStatus(m, 'a', { failed: true })
    expect(m.get('a')).toEqual({ loading: true, failed: true })
    m = setNodeStatus(m, 'a', { loading: false })
    expect(m.get('a')).toEqual({ failed: true })
  })

  it('旗標全清掉就不佔一筆;沒有變動回傳同一個參照,也不改動傳入的 Map', () => {
    const m1 = setNodeStatus(EMPTY_NODE_STATUS, 'a', { loading: true })
    expect(setNodeStatus(m1, 'a', { loading: true })).toBe(m1)
    expect(setNodeStatus(m1, 'b', { failed: false })).toBe(m1)
    const m2 = setNodeStatus(m1, 'a', { loading: false })
    expect(m2.has('a')).toBe(false)
    expect(m1.get('a')).toEqual({ loading: true })
  })

  it('clearNodeStatus 整筆清;本來沒有回傳同一個參照', () => {
    const m1 = setNodeStatus(EMPTY_NODE_STATUS, 'a', { removing: true })
    expect(clearNodeStatus(m1, 'zzz')).toBe(m1)
    expect(clearNodeStatus(m1, 'a').size).toBe(0)
  })

  it('pruneNodeStatus 只留還存在的節點;沒有要丟的回傳同一個參照', () => {
    let m = setNodeStatus(EMPTY_NODE_STATUS, 'a', { loading: true })
    m = setNodeStatus(m, 'b', { removing: true })
    expect(pruneNodeStatus(m, new Set(['a', 'b']))).toBe(m)
    const pruned = pruneNodeStatus(m, new Set(['a']))
    expect([...pruned.keys()]).toEqual(['a'])
  })

  it('nodeStatusOf 沒有紀錄(或沒有狀態表)回空物件', () => {
    expect(nodeStatusOf(undefined, 'x')).toEqual({})
    expect(nodeStatusOf(EMPTY_NODE_STATUS, 'x')).toEqual({})
  })
})
