// routeStyle 測試:連線共用樣式的純函式(2026-10 連線樣式柔化)。
import { describe, it, expect } from 'vitest'
import {
  ROUTE_ARROW_LONG_METERS,
  ROUTE_ARROW_MEDIUM_METERS,
  ROUTE_CASING_OPACITY_DARK,
  ROUTE_CASING_OPACITY_LIGHT,
  ROUTE_CASING_WEIGHT,
  ROUTE_STROKE_OPACITY,
  ROUTE_STROKE_WEIGHT,
  SYMBOL_FORWARD_OPEN_ARROW,
  dottedLineOptions,
  routeArrowOffsets,
  routeCasingOptions,
  routeStrokeOptions,
} from './routeStyle'

type Icon = { path?: unknown; scale?: number; fillColor?: string; strokeColor?: string }
type IconSeq = { icon: Icon; offset?: string; repeat?: string }
// google.maps.IconSequence 的 icon/offset/repeat 都是選填,這裡轉成測試好讀的形狀。
const icons = (o: { icons?: unknown }) => (o.icons ?? []) as IconSeq[]

describe('routeCasingOptions', () => {
  it('淺色主題:白色、低透明度、比顏色線寬;兩端圓頭與線同色同寬', () => {
    const o = routeCasingOptions()
    expect(o).toMatchObject({ strokeColor: '#ffffff', strokeOpacity: ROUTE_CASING_OPACITY_LIGHT, strokeWeight: ROUTE_CASING_WEIGHT })
    expect(ROUTE_CASING_WEIGHT).toBeGreaterThan(ROUTE_STROKE_WEIGHT)
    const caps = icons(o)
    expect(caps.map((c) => c.offset)).toEqual(['0%', '100%'])
    expect(caps.every((c) => c.repeat === undefined)).toBe(true)
    expect(caps[0].icon).toMatchObject({ path: 0, scale: ROUTE_CASING_WEIGHT / 2, fillColor: '#ffffff' })
  })

  it('深色主題:黑色、更低透明度', () => {
    expect(routeCasingOptions(true)).toMatchObject({ strokeColor: '#000000', strokeOpacity: ROUTE_CASING_OPACITY_DARK })
    expect(icons(routeCasingOptions(true))[0].icon.fillColor).toBe('#000000')
  })
})

describe('routeStrokeOptions', () => {
  it('顏色線:傳入的顏色、集中的線寬與透明度;圓頭兩顆加一個中點方向箭頭(白色開口箭頭、offset 50%、沒有 repeat)', () => {
    const o = routeStrokeOptions('#123456')
    expect(o).toMatchObject({ strokeColor: '#123456', strokeOpacity: ROUTE_STROKE_OPACITY, strokeWeight: ROUTE_STROKE_WEIGHT })
    const all = icons(o)
    expect(all).toHaveLength(3)
    expect(all[0].icon).toMatchObject({ path: 0, fillColor: '#123456', scale: ROUTE_STROKE_WEIGHT / 2 })
    const arrow = all[2]
    expect(arrow.icon).toMatchObject({ path: SYMBOL_FORWARD_OPEN_ARROW, strokeColor: '#ffffff' })
    expect(arrow.offset).toBe('50%')
    expect(arrow.repeat).toBeUndefined()
  })

  it('arrowOffsets:每個位置一個箭頭 icon,全部沒有 repeat(repeat 會往起點方向重複排列)', () => {
    const all = icons(routeStrokeOptions('#123456', { arrowOffsets: ['25%', '50%', '75%'] }))
    const arrows = all.filter((i) => i.icon.path === SYMBOL_FORWARD_OPEN_ARROW)
    expect(arrows.map((a) => a.offset)).toEqual(['25%', '50%', '75%'])
    expect(arrows.every((a) => a.repeat === undefined)).toBe(true)
    // 圓頭仍在兩端
    expect(all.filter((i) => i.icon.path === 0).map((i) => i.offset)).toEqual(['0%', '100%'])
  })

  it('arrows 為 false:只有圓頭、沒有箭頭', () => {
    expect(icons(routeStrokeOptions('#123456', { arrows: false }))).toHaveLength(2)
  })

  it('純函式:同樣輸入輸出相等(宿主用 JSON 簽章比對,不能有隨機值)', () => {
    expect(routeStrokeOptions('#abc')).toEqual(routeStrokeOptions('#abc'))
    expect(routeCasingOptions(true)).toEqual(routeCasingOptions(true))
  })
})

describe('routeArrowOffsets', () => {
  const pct = (s: string) => Number(s.replace('%', ''))

  it('短段只有中點一個;中段三個;長段五個(門檻 1.5 公里與 6 公里)', () => {
    expect(routeArrowOffsets(0)).toEqual(['50%'])
    expect(routeArrowOffsets(ROUTE_ARROW_MEDIUM_METERS - 1)).toEqual(['50%'])
    expect(routeArrowOffsets(ROUTE_ARROW_MEDIUM_METERS)).toHaveLength(3)
    expect(routeArrowOffsets(ROUTE_ARROW_LONG_METERS - 1)).toHaveLength(3)
    expect(routeArrowOffsets(ROUTE_ARROW_LONG_METERS)).toHaveLength(5)
    expect(routeArrowOffsets(50_000)).toHaveLength(5)
  })

  it('任何一級都不含起點與終點區間:全部是百分比、離兩端至少 14%、遞增、都含中點 50%', () => {
    for (const m of [0, 2000, 10_000]) {
      const offsets = routeArrowOffsets(m)
      const values = offsets.map(pct)
      expect(offsets.every((o) => o.endsWith('%'))).toBe(true)
      expect(Math.min(...values)).toBeGreaterThanOrEqual(14)
      expect(Math.max(...values)).toBeLessThanOrEqual(86)
      expect([...values].sort((a, b) => a - b)).toEqual(values)
      expect(values).toContain(50)
    }
  })
})

describe('dottedLineOptions', () => {
  it('線本身透明、沿路鋪同色圓點', () => {
    const o = dottedLineOptions('#8B3A2F')
    expect(o.strokeOpacity).toBe(0)
    const [dot] = icons(o)
    expect(dot.icon).toMatchObject({ path: 0, fillColor: '#8B3A2F' })
    expect(dot.repeat).toMatch(/px$/)
  })
})
