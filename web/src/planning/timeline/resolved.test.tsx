// resolved.ts 的純函式 helper:id 表 → 子景點清單(退回最小項目、farFromNext 蓋回)、地圖小點。
// 解析本身(查詢、快取、重試)的測試在 planning/data/store.test.ts 與 PlanDataProvider.test.tsx。
import { describe, it, expect } from 'vitest'
import { resolveMapChildren, resolveNodeRefChildren } from './resolved'
import type { PlanNode } from './model'

const node = (extra: Partial<PlanNode>): PlanNode => ({ id: 'n', type: 'stop', ...extra })

describe('resolveNodeRefChildren(純函式)', () => {
  it('沒有 id 回空陣列;attractions 在前、places 在後,同 id 去重', () => {
    expect(resolveNodeRefChildren(node({}), new Map())).toEqual([])
    const out = resolveNodeRefChildren(node({ attractions: ['lmk_1'], places: ['p1', 'lmk_1', 'p1'] }), new Map())
    expect(out.map((c) => c.id)).toEqual(['lmk_1', 'p1'])
  })

  it('尚未解析的 id 退回只有 id 的最小項目;farFromNext 的 id 蓋上旗標', () => {
    const out = resolveNodeRefChildren(
      node({ places: ['a', 'b'], farFromNext: ['b'] }),
      new Map([['a', { id: 'a', name: 'A', placeId: 'a' }]]),
    )
    expect(out[0]).toEqual({ id: 'a', name: 'A', placeId: 'a' })
    expect(out[1]).toEqual({ id: 'b', placeId: 'b', farFromNext: true })
  })

  it('resolveMapChildren 只收有座標的項目', () => {
    const resolved = new Map([['a', { id: 'a', name: 'A', lat: 1, lng: 2 }]])
    expect(resolveMapChildren(node({ places: ['a', 'b'] }), resolved)).toEqual([{ id: 'a', lat: 1, lng: 2, name: 'A' }])
  })
})
