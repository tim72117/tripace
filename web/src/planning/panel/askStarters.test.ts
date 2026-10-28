import { describe, expect, it, vi } from 'vitest'
import { candidatesFromAttractions, nearbyAskInput, pickBaseStop, shouldConfirmFromComposer } from './askStarters'

const stop = (id: string, extra: object = {}) => ({ id, type: 'stop', ...extra })

describe('pickBaseStop', () => {
  it('有選中的站點就用它;選中的不是站點或沒選中,用最後一站;沒有站點回 undefined', () => {
    const a = stop('a')
    const b = stop('b')
    const note = { id: 'n', type: 'note' }
    expect(pickBaseStop([a, b], a)).toBe(a)
    expect(pickBaseStop([a, b], undefined)).toBe(b)
    expect(pickBaseStop([a, note, b], note)).toBe(b)
    expect(pickBaseStop([note], undefined)).toBeUndefined()
    expect(pickBaseStop([], undefined)).toBeUndefined()
  })
})

describe('candidatesFromAttractions', () => {
  it('只留有 placeId 的、排除指定地點、帶上座標', () => {
    const list = [
      { placeId: 'p1', name: '赤崁樓', lat: 1, lng: 2 },
      { name: '沒有 placeId', lat: 3, lng: 4 },
      { placeId: 'p2', name: '孔廟', summary: 's', lat: 5, lng: 6 },
    ]
    expect(candidatesFromAttractions(list)).toEqual([
      { placeId: 'p1', name: '赤崁樓', summary: undefined, lat: 1, lng: 2 },
      { placeId: 'p2', name: '孔廟', summary: 's', lat: 5, lng: 6 },
    ])
    expect(candidatesFromAttractions(list, 'p1').map((c) => c.placeId)).toEqual(['p2'])
  })
})

describe('nearbyAskInput', () => {
  it('有座標:search 模式,查詢時帶這一站的座標', async () => {
    const search = vi.fn(async () => [])
    const input = nearbyAskInput({ node: { lat: 22.9, lng: 120.2, name: 'x' }, reason: 'r', search })!
    expect('search' in input && input.reason).toBe('r')
    await (input as { search: (s: AbortSignal) => Promise<unknown> }).search(new AbortController().signal)
    expect(search).toHaveBeenCalledWith(22.9, 120.2)
  })
  it('沒座標有名稱:探查模式用站名;兩者都沒有回 null', () => {
    const search = vi.fn()
    expect(nearbyAskInput({ node: { name: '赤崁樓' }, reason: 'r', search })).toEqual({ explore: { destination: '赤崁樓' }, reason: 'r' })
    expect(nearbyAskInput({ node: {}, reason: 'r', search })).toBeNull()
  })
  it('座標為 0 也算有座標', () => {
    expect(nearbyAskInput({ node: { lat: 0, lng: 0 }, reason: 'r', search: vi.fn() })).toHaveProperty('search')
  })
})

describe('shouldConfirmFromComposer', () => {
  const base = { route: 'ignore' as const, text: '', showAskPage: true, selectionCount: 2 }
  it('空白送出 + 詢問頁開著 + 有勾選 = 確認', () => {
    expect(shouldConfirmFromComposer(base)).toBe(true)
  })
  it('有打字、沒勾選、詢問頁沒開、或路由不是 ignore 都不確認', () => {
    expect(shouldConfirmFromComposer({ ...base, text: '想去海邊' })).toBe(false)
    expect(shouldConfirmFromComposer({ ...base, text: '   ' })).toBe(true)
    expect(shouldConfirmFromComposer({ ...base, selectionCount: 0 })).toBe(false)
    expect(shouldConfirmFromComposer({ ...base, showAskPage: false })).toBe(false)
    expect(shouldConfirmFromComposer({ ...base, route: 'askPage' })).toBe(false)
  })
})
