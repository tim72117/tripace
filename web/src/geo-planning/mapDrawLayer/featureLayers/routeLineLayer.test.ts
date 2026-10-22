import { describe, it, expect } from 'vitest'
import { routeLineLayer } from './routeLineLayer'

const s = (id: string, lat: number, lng: number) => ({ id, lat, lng })
const A = s('a', 1, 2)
const B = s('b', 3, 4)
const C = s('c', 5, 6)

describe('routeLineLayer', () => {
  it('id 固定為 routeLine', () => {
    expect(routeLineLayer({ stops: [], enabled: true, accentColor: '#f00' }).id).toBe('routeLine')
  })

  it('關閉時不畫', () => {
    expect(routeLineLayer({ stops: [A, B], enabled: false, accentColor: '#f00' }).drawables).toEqual([])
  })

  it('0 或 1 個點連不成線', () => {
    expect(routeLineLayer({ stops: [], enabled: true, accentColor: '#f00' }).drawables).toEqual([])
    expect(routeLineLayer({ stops: [A], enabled: true, accentColor: '#f00' }).drawables).toEqual([])
  })

  it('2 個以上的點依序連成一條線,群組為 routeLine', () => {
    const { drawables } = routeLineLayer({ stops: [A, B, C], enabled: true, accentColor: '#f00' })
    expect(drawables).toHaveLength(1)
    const d = drawables[0]
    expect(d.kind).toBe('polyline')
    expect(d.group).toBe('routeLine')
    if (d.kind !== 'polyline') throw new Error('unreachable')
    expect(d.path).toEqual([
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
      { lat: 5, lng: 6 },
    ])
  })

  it('樣式對照舊 hook:實線、0.85、粗細 3、顏色用傳入的強調色', () => {
    const d = routeLineLayer({ stops: [A, B], enabled: true, accentColor: '#123456' }).drawables[0]
    if (d.kind !== 'polyline') throw new Error('unreachable')
    expect(d.options).toEqual({ strokeColor: '#123456', strokeOpacity: 0.85, strokeWeight: 3 })
  })

  it('強調色改變時樣式跟著變', () => {
    const get = (c: string) => {
      const d = routeLineLayer({ stops: [A, B], enabled: true, accentColor: c }).drawables[0]
      return d.kind === 'polyline' ? d.options?.strokeColor : undefined
    }
    expect(get('#111111')).toBe('#111111')
    expect(get('#222222')).toBe('#222222')
  })

  it('點的順序改變時路徑跟著變', () => {
    const path = (stops: typeof A[]) => {
      const d = routeLineLayer({ stops, enabled: true, accentColor: '#f00' }).drawables[0]
      return d.kind === 'polyline' ? d.path : []
    }
    expect(path([A, B, C])).not.toEqual(path([C, B, A]))
    expect(path([C, B, A])[0]).toEqual({ lat: 5, lng: 6 })
  })
})
