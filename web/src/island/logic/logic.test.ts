import { describe, expect, it } from 'vitest'
import type { LightKey, Pt } from '../data/layoutTypes'
import { distToPolyline, pointInPolygon } from './geometry'
import { buildPathCurve } from './pathCurve'
import { formatTime, hexToRgb, lerpColor, parseTime, sampleLight } from './lighting'
import { heightAt } from './terrain'
import { activeStopIndex, travelerArc } from './travel'

const SQ: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]]

describe('幾何', () => {
  it('pointInPolygon 內外', () => {
    expect(pointInPolygon(5, 5, SQ)).toBe(true)
    expect(pointInPolygon(11, 5, SQ)).toBe(false)
  })
  it('distToPolyline:到線段與端點的最短距離', () => {
    const line: Pt[] = [[0, 0], [10, 0]]
    expect(distToPolyline(5, 3, line)).toBeCloseTo(3)
    expect(distToPolyline(-4, 3, line)).toBeCloseTo(5)
  })
})

describe('地形高度', () => {
  const layout = {
    topY: 0,
    terraces: [
      { outline: [[0, 0], [20, 0], [20, 20], [0, 20]] as Pt[], y: 2 },
      { outline: [[5, 5], [15, 5], [15, 15], [5, 15]] as Pt[], y: 5 },
    ],
  }
  it('取所有包含該點的階地中最高的 y;不在任何階地回 topY', () => {
    expect(heightAt(layout, 10, 10)).toBe(5)
    expect(heightAt(layout, 2, 2)).toBe(2)
    expect(heightAt(layout, 30, 30)).toBe(0)
  })
  it('沒有 terraces 時是平地', () => {
    expect(heightAt({ topY: 1.5 }, 3, 3)).toBe(1.5)
  })
})

describe('步道曲線', () => {
  const pts: Pt[] = [[0, 0], [10, 0], [10, 10], [20, 10]]
  const c = buildPathCurve(pts)
  it('通過所有控制點(起點與終點精確)', () => {
    expect(c.at(0)).toMatchObject({ x: 0, z: 0 })
    const end = c.at(c.length)
    expect(end.x).toBeCloseTo(20)
    expect(end.z).toBeCloseTo(10)
  })
  it('弧長單調遞增,總長不短於折線直線距離', () => {
    for (let i = 1; i < c.samples.length; i++) expect(c.samples[i].s).toBeGreaterThanOrEqual(c.samples[i - 1].s)
    expect(c.length).toBeGreaterThanOrEqual(Math.hypot(20, 10))
  })
  it('等弧長間隔取點,相鄰點的直線距離近似相等(旅人等速)', () => {
    const step = c.length / 40
    const ds: number[] = []
    for (let i = 0; i < 40; i++) {
      const a = c.at(i * step)
      const b = c.at((i + 1) * step)
      ds.push(Math.hypot(b.x - a.x, b.z - a.z))
    }
    expect(Math.max(...ds) / Math.min(...ds)).toBeLessThan(1.15)
  })
  it('方向是單位向量;at 會夾住超出範圍的 s', () => {
    const d = c.at(c.length / 2)
    expect(Math.hypot(d.dirX, d.dirZ)).toBeCloseTo(1)
    expect(c.at(-5)).toMatchObject({ x: 0, z: 0 })
    expect(c.at(c.length + 99).x).toBeCloseTo(20)
  })
  it('nearestArc:控制點附近的弧長合理,且離起點越近越小', () => {
    expect(c.nearestArc(0, 0)).toBeCloseTo(0)
    expect(c.nearestArc(20, 10)).toBeCloseTo(c.length, 0)
    expect(c.nearestArc(10, 1)).toBeLessThan(c.nearestArc(10, 9))
  })
  it('少於兩個點會丟錯', () => {
    expect(() => buildPathCurve([[0, 0]])).toThrow()
  })
})

const key = (time: string, c: string, glow: number, intensity = 1): LightKey => ({
  time, skyTop: c, skyBottom: c, fog: c, sun: c, sunIntensity: intensity, sunElevationDeg: 10, sunAzimuthDeg: 0,
  hemiSky: c, hemiGround: c, hemiIntensity: 1, lanternGlow: glow,
})

describe('光照插值', () => {
  const keys = [key('12:00', '#000000', 0, 2), key('18:00', '#ffffff', 1, 0), key('22:00', '#0000ff', 1, 0)]
  it('時間解析與格式化', () => {
    expect(parseTime('17:30')).toBe(17 * 60 + 30)
    expect(formatTime(17 * 60 + 30)).toBe('17:30')
    expect(formatTime(-60)).toBe('23:00')
    expect(() => parseTime('25')).toThrow()
  })
  it('關鍵時刻本身回傳該關鍵幀;中點是平均', () => {
    expect(sampleLight(keys, parseTime('18:00')).skyTop).toBe('#ffffff')
    const mid = sampleLight(keys, parseTime('15:00'))
    expect(mid.lanternGlow).toBeCloseTo(0.5)
    expect(mid.sunIntensity).toBeCloseTo(1)
    expect(hexToRgb(mid.skyTop)[0]).toBeGreaterThan(120)
    expect(hexToRgb(mid.skyTop)[0]).toBeLessThan(136)
  })
  it('跨午夜環狀內插:22:00 → 隔天 12:00 之間連續', () => {
    const a = sampleLight(keys, parseTime('23:00'))
    const b = sampleLight(keys, parseTime('01:00'))
    expect(a.lanternGlow).toBeGreaterThan(b.lanternGlow)
    expect(a.lanternGlow).toBeLessThan(1)
    expect(sampleLight(keys, 24 * 60 + parseTime('18:00')).skyTop).toBe('#ffffff')
  })
  it('lanternGlow 在傍晚段單調不減', () => {
    const k = [key('16:00', '#fff', 0), key('18:30', '#fff', 0.6), key('19:30', '#fff', 1)]
    let prev = -1
    for (let m = parseTime('16:00'); m <= parseTime('19:30'); m += 10) {
      const g = sampleLight(k, m).lanternGlow
      expect(g).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = g
    }
  })
  it('單一關鍵幀恆定;空陣列丟錯', () => {
    expect(sampleLight([key('12:00', '#123456', 0.3)], 999).skyTop).toBe('#123456')
    expect(() => sampleLight([], 0)).toThrow()
  })
  it('lerpColor 端點', () => {
    expect(lerpColor('#000000', '#ffffff', 0)).toBe('#000000')
    expect(lerpColor('#000000', '#ffffff', 1)).toBe('#ffffff')
  })
})

describe('旅人進度', () => {
  const stops = [{ minutes: 600, arc: 0 }, { minutes: 660, arc: 30 }, { minutes: 720, arc: 100 }]
  it('第一站之前停在起點、最後一站之後停在終點', () => {
    expect(travelerArc(stops, 500)).toBe(0)
    expect(travelerArc(stops, 900)).toBe(100)
  })
  it('相鄰兩站之間線性前進,且單調不減', () => {
    expect(travelerArc(stops, 630)).toBeCloseTo(15)
    expect(travelerArc(stops, 690)).toBeCloseTo(65)
    let prev = -1
    for (let m = 580; m <= 740; m += 5) {
      const a = travelerArc(stops, m)
      expect(a).toBeGreaterThanOrEqual(prev)
      prev = a
    }
  })
  it('activeStopIndex', () => {
    expect(activeStopIndex(stops, 590)).toBe(-1)
    expect(activeStopIndex(stops, 600)).toBe(0)
    expect(activeStopIndex(stops, 700)).toBe(1)
    expect(activeStopIndex(stops, 800)).toBe(2)
  })
  it('空站清單不丟錯', () => {
    expect(travelerArc([], 100)).toBe(0)
  })
})
