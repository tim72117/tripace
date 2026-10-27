import { describe, it, expect } from 'vitest'
import { routeLineLayer, type RouteLineSegment } from './routeLineLayer'
import { arcChordMeters, arcPath } from './routeArc'
import { FOOTPRINT_LEFT, FOOTPRINT_RIGHT, footprintSpacing } from './footprintIcon'
import { ROUTE_STROKE_WEIGHT, metersToPixels, routeArrowOffsets, routeCasingOptions, routeStrokeOptions } from './routeStyle'
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

  describe('步行段(walking)畫腳印', () => {
    const walk = (id: string, from: [number, number], to: [number, number]): RouteLineSegment => ({ ...seg(id, from, to), walking: true })
    const W = walk('w', [25, 121], [25.003, 121])
    // LONG——約 2.2 公里,在 zoom 13~17 都放得下好幾步(W 約 333 公尺,縮小後會短到放不下一步)。
    const LONG = walk('long', [25, 121], [25.02, 121])

    it('只有一個 drawable(沒有光暈),id 是段 id、group routeLine、路徑與實線段同一條弧線', () => {
      const ds = polys([W])
      expect(ds.map((d) => [d.id, d.group])).toEqual([['w', 'routeLine']])
      expect(ds[0].path).toEqual(arcPath(W.from, W.to))
    })

    it('左右腳兩組 icons 交錯、repeat 相同(兩步)、顏色取強調色,沒有圓頭與箭頭', () => {
      const icons = polys([W], { accentColor: '#123456' })[0].options?.icons ?? []
      expect(icons.map((i) => i.icon?.path)).toEqual([FOOTPRINT_LEFT, FOOTPRINT_RIGHT])
      expect(icons[0].repeat).toBe(icons[1].repeat)
      expect(parseFloat(icons[1].offset as string)).toBeGreaterThan(parseFloat(icons[0].offset as string))
      expect(icons.every((i) => i.icon?.fillColor === '#123456')).toBe(true)
    })

    it('間距與大小隨 zoom:拉近腳印變大、間距變寬;不傳 zoom 用基準等級', () => {
      const repeatAt = (zoom?: number) => {
        const layer = routeLineLayer({ segments: [LONG], accentColor: '#f00', zoom })
        return parseFloat(((layer.drawables[0] as PolylineDrawable).options?.icons ?? [])[0].repeat as string)
      }
      expect(repeatAt(17)).toBeGreaterThan(repeatAt(15))
      expect(repeatAt(13)).toBeLessThan(repeatAt(15))
      expect(repeatAt(undefined)).toBe(repeatAt(15))
      expect(repeatAt(15)).toBe(Math.round(footprintSpacing(15).repeatPx))
    })

    it('腳印沒有線:strokeOpacity 為 0(不畫實線也不留底線),只剩 icons', () => {
      const o = polys([W])[0].options
      expect(o?.strokeOpacity).toBe(0)
      expect(o?.icons?.length).toBe(2)
    })

    it('路徑夠長:沿路重複排列(有 repeat、像素 offset)', () => {
      const icons = polys([LONG])[0].options?.icons ?? []
      expect(icons.every((i) => typeof i.repeat === 'string')).toBe(true)
      expect(icons.every((i) => (i.offset as string).endsWith('px'))).toBe(true)
    })

    it('路徑短到放不下一步:改用百分比位置各放一隻腳印、不重複,短段才不會因為沒有底線而消失', () => {
      const SHORT = walk('s', [25, 121], [25.0003, 121]) // 約 33 公尺,zoom 15 約 8px
      const icons = polys([SHORT])[0].options?.icons ?? []
      expect(icons.map((i) => i.icon?.path)).toEqual([FOOTPRINT_LEFT, FOOTPRINT_RIGHT])
      expect(icons.map((i) => i.offset)).toEqual(['35%', '65%'])
      expect(icons.every((i) => i.repeat === undefined)).toBe(true)
    })

    it('拉近到同一段夠長時,又回到沿路重複(依 zoom 判斷)', () => {
      const SEG = walk('m', [25, 121], [25.00225, 121]) // 約 250 公尺:zoom 13 約 14px、zoom 18 約 462px
      const at = (zoom: number) => (routeLineLayer({ segments: [SEG], accentColor: '#f00', zoom }).drawables[0] as PolylineDrawable).options?.icons?.[0]
      expect(at(13)?.repeat).toBeUndefined()
      expect(typeof at(18)?.repeat).toBe('string')
    })

    it('混合時:非步行段仍是光暈加實線,不受 zoom 影響', () => {
      const ds = routeLineLayer({ segments: [W, AB], accentColor: '#f00', zoom: 18 }).drawables as PolylineDrawable[]
      expect(ds.map((d) => d.id)).toEqual(['w', 'a->b:casing', 'a->b'])
      expect(ds[2].options).toEqual(routeStrokeOptions('#f00', { arrowOffsets: routeArrowOffsets(arcChordMeters(AB.from, AB.to)) }))
    })

    it('深淺色:腳印邊線顏色跟 dark 切換;zoom 改變簽章跟著變(宿主才會更新)', () => {
      const edge = (dark: boolean) => polys([W], { dark })[0].options?.icons?.[0].icon?.strokeColor
      expect(edge(false)).toBe('#ffffff')
      expect(edge(true)).toBe('#000000')
      const sig = (zoom: number) => signatureOf(routeLineLayer({ segments: [W], accentColor: '#f00', zoom }).drawables[0]).data
      expect(sig(16)).not.toBe(sig(15))
    })
  })

  describe('metersToPixels', () => {
    it('赤道 zoom 0 每像素約 156543 公尺;每放大一級像素數加倍;緯度越高同樣公尺長度的像素越多', () => {
      expect(metersToPixels(156543.03392, 0, 0)).toBeCloseTo(1, 5)
      expect(metersToPixels(1000, 0, 11)).toBeCloseTo(metersToPixels(1000, 0, 10) * 2, 5)
      expect(metersToPixels(1000, 60, 10)).toBeGreaterThan(metersToPixels(1000, 0, 10))
    })
  })
})
