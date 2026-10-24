import { describe, it, expect } from 'vitest'
import { transitHoverLineLayer } from './transitHoverLineLayer'
import { arcPath } from './routeArc'
import { dottedLineOptions } from './routeStyle'

const stops = [
  { id: 'a', lat: 1, lng: 2 },
  { id: 'b', lat: 3, lng: 4 },
  { id: 'c', lat: 5, lng: 6 },
]
const accentColor = '#8B3A2F'

describe('transitHoverLineLayer', () => {
  it('id 固定為 transitHoverLine', () => {
    expect(transitHoverLineLayer({ stops, hoverTransitPair: null, accentColor }).id).toBe('transitHoverLine')
  })

  it('沒有 hover:不畫', () => {
    expect(transitHoverLineLayer({ stops, hoverTransitPair: null, accentColor }).drawables).toEqual([])
  })

  it('其中一端找不到:不畫', () => {
    expect(transitHoverLineLayer({ stops, hoverTransitPair: { fromId: 'a', toId: 'x' }, accentColor }).drawables).toEqual([])
    expect(transitHoverLineLayer({ stops, hoverTransitPair: { fromId: 'x', toId: 'b' }, accentColor }).drawables).toEqual([])
  })

  it('兩端都在:路徑是 from 到 to 的弧線(與整條路線同一組取樣),群組為 transitHoverLine', () => {
    const [d] = transitHoverLineLayer({ stops, hoverTransitPair: { fromId: 'b', toId: 'a' }, accentColor }).drawables
    expect(d).toMatchObject({ kind: 'polyline', group: 'transitHoverLine' })
    if (d.kind !== 'polyline') throw new Error()
    expect(d.path).toEqual(arcPath({ lat: 3, lng: 4 }, { lat: 1, lng: 2 }))
    expect(d.path[0]).toEqual({ lat: 3, lng: 4 })
    expect(d.path[d.path.length - 1]).toEqual({ lat: 1, lng: 2 })
  })

  it('樣式取自 routeStyle 的圓點虛線:strokeOpacity 0、強調色圓點', () => {
    const [d] = transitHoverLineLayer({ stops, hoverTransitPair: { fromId: 'a', toId: 'b' }, accentColor }).drawables
    if (d.kind !== 'polyline') throw new Error()
    expect(d.options).toEqual(dottedLineOptions('#8B3A2F'))
    expect(d.options?.strokeOpacity).toBe(0)
  })

  it('強調色改變:icons 顏色跟著變', () => {
    const color = (c: string) => {
      const [d] = transitHoverLineLayer({ stops, hoverTransitPair: { fromId: 'a', toId: 'b' }, accentColor: c }).drawables
      if (d.kind !== 'polyline') throw new Error()
      return (d.options?.icons?.[0].icon as { fillColor: string }).fillColor
    }
    expect(color('#111111')).toBe('#111111')
    expect(color('#222222')).toBe('#222222')
  })
})
