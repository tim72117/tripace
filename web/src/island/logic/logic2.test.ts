import { describe, expect, it } from 'vitest'
import type { IslandLayout, Pt } from '../data/layoutTypes'
import { articleToIsland, displayableStops, excerpt, extractStops, generateTimes, type IslandStop } from './articleToIsland'
import { DEFAULT_LANTERN_OPTS, lanternGlowAt, lanternJitter, lanternOrder, LANTERN_JITTER_MAX } from './lanternSchedule'
import { buildPathCurve } from './pathCurve'
import { mulberry32 } from './rng'
import { MAX_RAISE, resolveScatter } from './scatterResolve'
import { cameraAt, coverKey, tourKeyframes } from './tour'
import { polygonArea, selfIntersects, validateLayout } from './validateLayout'

const SQ: Pt[] = [[-20, -20], [20, -20], [20, 20], [-20, 20]]

describe('rng', () => {
  it('同 seed 同序列、值域 [0,1)', () => {
    const a = mulberry32(5), b = mulberry32(5)
    for (let i = 0; i < 30; i++) { const v = a(); expect(v).toBe(b()); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1) }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })
})

describe('燈籠亮起排程', () => {
  const order = [0, 0.25, 0.5, 0.75, 1]
  const jit = lanternJitter(5, 7)
  it('globalGlow=0 全暗、=1 全亮,且都在 [0,1]', () => {
    expect([...lanternGlowAt(0, order, jit)].every((g) => g === 0)).toBe(true)
    expect([...lanternGlowAt(1, order, jit)].every((g) => g === 1)).toBe(true)
    for (let g = 0; g <= 1; g += 0.05) for (const v of lanternGlowAt(g, order, jit)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
  })
  it('globalGlow 遞增時每盞單調不減', () => {
    let prev = lanternGlowAt(0, order, jit)
    for (let g = 0.02; g <= 1; g += 0.02) {
      const cur = lanternGlowAt(g, order, jit)
      cur.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(prev[i] - 1e-6))
      prev = cur
    }
  })
  it('起點(u 小)的先亮:中途時 u=0 的亮度 > u=1 的亮度', () => {
    const mid = lanternGlowAt(0.4, order, [0, 0, 0, 0, 0])
    expect(mid[0]).toBeGreaterThan(mid[4])
    expect(mid[0]).toBeGreaterThan(0)
    expect(mid[4]).toBe(0)
  })
  it('超出範圍的 globalGlow 會夾住;jitter 同 seed 相同且在上限內', () => {
    expect(lanternGlowAt(5, order, jit)[4]).toBe(1)
    expect(lanternGlowAt(-3, order, jit)[0]).toBe(0)
    expect(lanternJitter(5, 7)).toEqual(jit)
    expect(Math.max(...jit)).toBeLessThanOrEqual(LANTERN_JITTER_MAX)
    expect(DEFAULT_LANTERN_OPTS.ramp + LANTERN_JITTER_MAX).toBeLessThanOrEqual(1)
  })
  it('lanternOrder:沿步道越後面的燈 u 越大', () => {
    const c = buildPathCurve([[0, 0], [20, 0], [20, 20]])
    const u = lanternOrder([[1, 1], [20, 5], [19, 19]], c)
    expect(u[0]).toBeLessThan(u[1])
    expect(u[1]).toBeLessThan(u[2])
    expect(Math.min(...u)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...u)).toBeLessThanOrEqual(1)
  })
})

describe('文章 → 島', () => {
  const blocks = [
    { id: 'p1', kind: 'paragraph', text: 'x' },
    { id: 'stop_1', kind: 'stop', index: '壱', name: '基山街', desc: '九份最熱鬧的主要街道。傍晚燈籠亮起。', blurb: '好吃' },
    { id: 'tl', kind: 'scroll-timeline-start' },
    { id: 'stop_4', kind: 'stop', index: '弐', name: '豎崎路石階', desc: '石階' },
    { id: 'weird', kind: 'unknown-kind' },
  ]
  const anchor = (stopId: string, time: string) => ({ stopId, model: 'm', x: 0, z: 0, label: stopId, time })
  const src = { slug: 's', content: { title: 'T', blocks } }
  it('extractStops 只取 stop、依序,未知 kind 靜默略過', () => {
    expect(extractStops(blocks).map((b) => b.id)).toEqual(['stop_1', 'stop_4'])
    expect(extractStops([null, 3, {}, { kind: 'stop' }])).toEqual([])
  })
  it('對應版面站點:用版面時間、摘錄取第一句', () => {
    const r = articleToIsland(src, { stops: [anchor('stop_1', '17:30'), anchor('stop_4', '18:30')] }, { name: 'n' })
    expect(r.issues).toEqual([])
    expect(r.stops.map((s) => [s.stopId, s.time, s.timeSource])).toEqual([['stop_1', '17:30', 'layout'], ['stop_4', '18:30', 'layout']])
    expect(r.stops[0].excerpt).toBe('九份最熱鬧的主要街道。')
    expect(r.stops[0].blurb).toBe('好吃')
    expect(r.meta.title).toBe('T')
  })
  it('版面缺一站 → anchor null、用產生的時間、warn;版面多出一站 → warn', () => {
    const r = articleToIsland(src, { stops: [anchor('stop_1', '17:30'), anchor('ghost', '19:00')] }, { name: 'n' })
    expect(r.stops[1].anchor).toBeNull()
    expect(r.stops[1].timeSource).toBe('generated')
    expect(r.issues.map((i) => i.level)).toContain('warn')
    expect(r.issues.some((i) => i.path === 'stops.ghost')).toBe(true)
  })
  it('順序不一致 → error', () => {
    const r = articleToIsland(src, { stops: [anchor('stop_4', '17:30'), anchor('stop_1', '18:30')] }, { name: 'n' })
    expect(r.issues.some((i) => i.level === 'error')).toBe(true)
  })
  it('excerpt:超長截斷加…、不切斷 emoji;generateTimes 對齊 5 分鐘且遞增', () => {
    expect(excerpt('一二三四五六七八九十', 4)).toBe('一二三四…')
    expect(excerpt('😀😀😀😀😀', 3)).toBe('😀😀😀…')
    expect(excerpt('短句', 60)).toBe('短句')
    const t = generateTimes(4, '17:30', '20:15')
    expect(t).toEqual(['17:30', '18:25', '19:20', '20:15'])
    expect(generateTimes(0, '17:00', '18:00')).toEqual([])
  })
})

describe('散落物避障', () => {
  const layout = {
    outline: SQ, topY: 0,
    terraces: [{ outline: [[0, -20], [20, -20], [20, 20], [0, 20]] as Pt[], y: 3 }],
    stops: [{ stopId: 's', model: 'm', x: -10, z: 10, label: 'l', time: '17:30' }],
    river: { points: [[-20, -10], [20, -10]] as Pt[], width: 4 },
  }
  const opts = { pathLine: [[-20, 0], [20, 0]] as Pt[], pathWidth: 4, stopClear: 3, edgeClear: 1, radiusOf: () => 0.5 }
  const P = (x: number, z: number) => ({ model: 'tree', x, z })
  it('各種不合格的位置都被剔除並附原因', () => {
    const r = resolveScatter([P(50, 0), P(-10, 0.5), P(-10, -10), P(-10, 11), P(19.8, 5), P(0, 5)], layout, opts)
    expect(r.kept).toHaveLength(0)
    expect(r.dropped.map((d) => d.reason)).toEqual(['在島外', '擋在步道上', '落在河道上', '擠在站點建築旁', '離島邊緣太近', '騎在階地邊緣'])
  })
  it('合格的保留;y 不合理(離譜高、低於地面)或沒填時以階地高度為準', () => {
    const r = resolveScatter([{ ...P(10, 10), y: 99 }, P(-10, 5), { ...P(10, -5), y: -2 }], layout, opts)
    expect(r.kept.map((k) => [k.x, k.y])).toEqual([[10, 3], [-10, 0], [10, 3]])
  })
  it('刻意墊高(蒸氣在攤位上方)的 y 保留:落在地面到 MAX_RAISE 之間', () => {
    const r = resolveScatter([{ ...P(10, 10), y: 4.5 }, { ...P(-10, 5), y: 1.2 }], layout, opts)
    expect(r.kept.map((k) => k.y)).toEqual([4.5, 1.2])
    const over = resolveScatter([{ ...P(-10, 5), y: MAX_RAISE + 0.5 }], layout, opts)
    expect(over.kept[0].y).toBe(0)
  })
  it('決定性:同輸入同輸出', () => {
    const list = Array.from({ length: 30 }, (_, i) => P(-18 + i * 1.2, (i % 7) * 4 - 12))
    expect(resolveScatter(list, layout, opts)).toEqual(resolveScatter(list, layout, opts))
  })
})

describe('導覽鏡頭', () => {
  const stops = [{ x: -10, y: 0, z: 10 }, { x: 0, y: 3, z: 0 }, { x: 10, y: 6, z: -10 }]
  const keys = tourKeyframes(stops, 35)
  it('前後各一個封面,中間每站一個、target 在站點附近', () => {
    expect(keys).toHaveLength(stops.length + 2)
    expect(keys[0]).toEqual(coverKey(35))
    expect(keys[keys.length - 1]).toEqual(coverKey(35))
    stops.forEach((s, i) => {
      expect(keys[i + 1].target[0]).toBeCloseTo(s.x)
      expect(keys[i + 1].target[2]).toBeCloseTo(s.z)
    })
  })
  it('cameraAt:端點等於首尾關鍵幀、夾住 u、到站時等於該關鍵幀', () => {
    expect(cameraAt(keys, 0)).toEqual(keys[0])
    expect(cameraAt(keys, 1)).toEqual(keys[keys.length - 1])
    expect(cameraAt(keys, -3)).toEqual(keys[0])
    expect(cameraAt(keys, 9)).toEqual(keys[keys.length - 1])
    const k = cameraAt(keys, 2 / (keys.length - 1))
    expect(k.pos[0]).toBeCloseTo(keys[2].pos[0])
  })
  it('單一關鍵幀不丟錯;鏡頭仰角為俯視(位置高於目標)', () => {
    expect(cameraAt([keys[0]], 0.5)).toEqual(keys[0])
    for (const k of keys) expect(k.pos[1]).toBeGreaterThan(k.target[1])
  })
})

const light = (time: string, glow = 0.5) => ({
  time, skyTop: '#112233', skyBottom: '#223344', fog: '#334455', sun: '#ffeeaa', sunIntensity: 1, sunElevationDeg: 10, sunAzimuthDeg: 0,
  hemiSky: '#aabbcc', hemiGround: '#445566', hemiIntensity: 1, lanternGlow: glow,
})
const goodLayout = (): IslandLayout => ({
  outline: SQ, topY: 0, thickness: 6,
  river: { points: [], width: 0 }, path: { points: [[-10, -10], [10, 10]], width: 2 },
  stops: [
    { stopId: 'a', model: 'm', x: 0, z: 0, label: 'A', time: '17:30' },
    { stopId: 'b', model: 'm', x: 5, z: 5, label: 'B', time: '18:30' },
  ],
  scatter: [{ model: 'm', x: 1, z: 1 }],
  lighting: [light('16:00'), light('22:00')],
  palette: { grass: '#00ff00', grassAlt: '#00ee00', dirt: '#885533', water: '#2244ff', waterDeep: '#112288', path: '#999999' },
})

describe('版面驗證', () => {
  const names = new Set(['m'])
  const ids = ['a', 'b']
  it('正常版面零問題', () => {
    expect(validateLayout(goodLayout(), names, ids)).toEqual([])
  })
  it('selfIntersects / polygonArea', () => {
    expect(selfIntersects(SQ)).toBe(false)
    expect(selfIntersects([[0, 0], [10, 10], [10, 0], [0, 10]])).toBe(true)
    expect(Math.abs(polygonArea(SQ))).toBe(1600)
    expect(polygonArea([...SQ].reverse())).toBe(-polygonArea(SQ))
  })
  it('各種錯誤都抓得到', () => {
    const bad = goodLayout()
    bad.outline = [[0, 0], [10, 10], [10, 0], [0, 10]]
    bad.thickness = 0
    bad.stops[1].time = '17:00'
    bad.scatter[0].model = 'nope'
    bad.palette.grass = 'green'
    bad.lighting[0].lanternGlow = 2
    const msgs = validateLayout(bad, names, ids).map((i) => `${i.level}:${i.path}`)
    expect(msgs).toContain('error:outline')
    expect(msgs).toContain('error:thickness')
    expect(msgs).toContain('error:stops[1].time')
    expect(msgs).toContain('error:scatter[0].model')
    expect(msgs).toContain('error:palette.grass')
    expect(msgs).toContain('error:lighting[0].lanternGlow')
  })
  it('站點順序與文章不一致 → error;階地高度不高於 topY → error;光照沒涵蓋傍晚 → warn', () => {
    const l = goodLayout()
    l.terraces = [{ outline: SQ, y: 0 }]
    l.lighting = [light('12:00')]
    const r = validateLayout(l, names, ['b', 'a'])
    expect(r.some((i) => i.level === 'error' && i.path === 'stops')).toBe(true)
    expect(r.some((i) => i.level === 'error' && i.path === 'terraces[0].y')).toBe(true)
    expect(r.some((i) => i.level === 'warn' && i.path === 'lighting')).toBe(true)
  })
})

import { timeAt } from './tour'
import { phaseName } from './phase'

describe('導覽時間與時段', () => {
  it('timeAt:端點、中點、夾住', () => {
    const t = [1000, 1050, 1110, 1200]
    expect(timeAt(t, 0)).toBe(1000)
    expect(timeAt(t, 1)).toBe(1200)
    expect(timeAt(t, 1 / 3)).toBeCloseTo(1050)
    expect(timeAt(t, 0.5)).toBeCloseTo(1080)
    expect(timeAt(t, -2)).toBe(1000)
    expect(timeAt(t, 9)).toBe(1200)
    expect(timeAt([5], 0.5)).toBe(5)
  })
  it('phaseName:各時段邊界', () => {
    expect(phaseName(12 * 60)).toBe('白天')
    expect(phaseName(16 * 60 + 30)).toBe('午後')
    expect(phaseName(17 * 60 + 30)).toBe('夕陽')
    expect(phaseName(18 * 60 + 30)).toBe('藍調時刻')
    expect(phaseName(19 * 60 + 30)).toBe('夜晚')
    expect(phaseName(22 * 60)).toBe('深夜')
    expect(phaseName(18 * 60 + 15)).toBe('藍調時刻')
  })
})

describe('displayableStops(HUD 與場景共用的站點清單)', () => {
  const st = (id: string, model: string | null): IslandStop => ({
    stopId: id, order: 0, index: '', name: id, excerpt: '', time: '17:30', timeSource: 'layout',
    anchor: model === null ? null : { stopId: id, model, x: 0, z: 0, label: id, time: '17:30' },
  })
  const models = { house: {}, tower: {} }
  it('濾掉沒有版面站點(anchor 為 null)與模型不存在的站,保留原本順序', () => {
    const r = displayableStops([st('a', 'house'), st('b', null), st('c', 'ghost'), st('d', 'tower')], models)
    expect(r.map((s) => s.stopId)).toEqual(['a', 'd'])
  })
  it('全部都能顯示時原樣回傳;全部不能時回傳空陣列;不會修改輸入', () => {
    const all = [st('a', 'house'), st('b', 'tower')]
    expect(displayableStops(all, models)).toEqual(all)
    expect(displayableStops([st('a', null)], models)).toEqual([])
    expect(all).toHaveLength(2)
  })
})
