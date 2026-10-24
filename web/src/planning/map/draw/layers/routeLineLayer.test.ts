import { describe, it, expect } from 'vitest'
import { routeLineLayer, type RouteLineSegment } from './routeLineLayer'
import { arcChordMeters, arcPath } from './routeArc'
import { ROUTE_STROKE_WEIGHT, routeArrowOffsets, routeCasingOptions, routeStrokeOptions } from './routeStyle'
import { composeLayers } from '../compose'
import { signatureOf } from '../diff'
import type { PolylineDrawable } from '../types'

const seg = (id: string, from: [number, number], to: [number, number]): RouteLineSegment => ({
  id,
  from: { lat: from[0], lng: from[1] },
  to: { lat: to[0], lng: to[1] },
})
const AB = seg('a->b', [1, 2], [3, 4])
const BC = seg('b->c', [3, 4], [5, 6])

const polys = (segments: RouteLineSegment[], over: { accentColor?: string; dark?: boolean } = {}) =>
  routeLineLayer({ segments, accentColor: over.accentColor ?? '#f00', dark: over.dark }).drawables as PolylineDrawable[]
const colored = (segments: RouteLineSegment[], over?: { accentColor?: string; dark?: boolean }) =>
  polys(segments, over).filter((d) => d.group === 'routeLine')
const casings = (segments: RouteLineSegment[], over?: { accentColor?: string; dark?: boolean }) =>
  polys(segments, over).filter((d) => d.group === 'routeCasing')

describe('routeLineLayer', () => {
  it('id 固定為 routeLine;沒有段就沒有 drawable', () => {
    const layer = routeLineLayer({ segments: [], accentColor: '#f00' })
    expect(layer.id).toBe('routeLine')
    expect(layer.drawables).toEqual([])
  })

  it('每段兩個 polyline drawable:光暈(id 加 :casing)在前、顏色線(id 就是段 id)在後,兩者同一份弧線路徑', () => {
    const ds = polys([AB, BC])
    expect(ds.map((d) => [d.id, d.group, d.kind])).toEqual([
      ['a->b:casing', 'routeCasing', 'polyline'],
      ['a->b', 'routeLine', 'polyline'],
      ['b->c:casing', 'routeCasing', 'polyline'],
      ['b->c', 'routeLine', 'polyline'],
    ])
    expect(ds[1].path).toEqual(arcPath({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }))
    expect(ds[0].path).toEqual(ds[1].path)
    // 弧線兩端就是段的起訖座標。
    expect(ds[1].path[0]).toEqual({ lat: 1, lng: 2 })
    expect(ds[1].path[ds[1].path.length - 1]).toEqual({ lat: 3, lng: 4 })
  })

  it('樣式取自 routeStyle:顏色線用強調色與集中的線寬、箭頭位置依段長分級;光暈依 dark 切換', () => {
    const d = colored([AB], { accentColor: '#123456' })[0]
    const arrowOffsets = routeArrowOffsets(arcChordMeters(AB.from, AB.to))
    expect(arrowOffsets).toHaveLength(5) // (1,2)→(3,4) 約 300 公里:長段
    expect(d.options).toEqual(routeStrokeOptions('#123456', { arrowOffsets }))
    // 短段(約 110 公尺)只有中點一個箭頭;箭頭沒有 repeat、不在 0%/100%
    const short = colored([seg('s', [25, 121], [25.001, 121])])[0]
    const arrows = (short.options?.icons ?? []).filter((i) => i.icon?.path === 2)
    expect(arrows.map((a) => a.offset)).toEqual(['50%'])
    expect((short.options?.icons ?? []).every((i) => i.repeat === undefined)).toBe(true)
    expect(d.options?.strokeWeight).toBe(ROUTE_STROKE_WEIGHT)
    expect(casings([AB])[0].options).toEqual(routeCasingOptions(false))
    expect(casings([AB], { dark: true })[0].options).toEqual(routeCasingOptions(true))
  })

  it('強調色改變時每段顏色線都跟著變', () => {
    const colors = (c: string) => colored([AB, BC], { accentColor: c }).map((d) => d.options?.strokeColor)
    expect(colors('#111111')).toEqual(['#111111', '#111111'])
    expect(colors('#222222')).toEqual(['#222222', '#222222'])
  })

  it('簽章穩定:資料不變時 id 與簽章不變;一段改變只影響那一段的兩條', () => {
    const a = polys([AB, BC])
    const b = polys([AB, BC])
    expect(b.map((d) => d.id)).toEqual(a.map((d) => d.id))
    expect(b.map((d) => signatureOf(d).data)).toEqual(a.map((d) => signatureOf(d).data))
    const c = polys([AB, seg('b->c', [3, 4], [7, 8])])
    expect(c.map((d) => d.id)).toEqual(a.map((d) => d.id))
    expect(signatureOf(c[0]).data).toBe(signatureOf(a[0]).data)
    expect(signatureOf(c[1]).data).toBe(signatureOf(a[1]).data)
    expect(signatureOf(c[2]).data).not.toBe(signatureOf(a[2]).data)
    expect(signatureOf(c[3]).data).not.toBe(signatureOf(a[3]).data)
  })

  it('composeLayers 後 id 帶功能層前綴', () => {
    expect(composeLayers([routeLineLayer({ segments: [AB], accentColor: '#f00' })]).map((d) => d.id)).toEqual([
      'routeLine:a->b:casing',
      'routeLine:a->b',
    ])
  })
})
