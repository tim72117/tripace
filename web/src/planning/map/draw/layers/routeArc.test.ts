// routeArc 測試:站點之間弧線取樣的純函式(2026-10 連線樣式柔化)。
import { describe, it, expect } from 'vitest'
import {
  ARC_MIN_METERS,
  ARC_SAG_RATIO,
  ARC_SEGMENTS,
  arcChordMeters,
  arcPath,
  projectMercator,
  unprojectMercator,
} from './routeArc'

const A = { lat: 25.0478, lng: 121.517 } // 台北車站
const B = { lat: 25.0339, lng: 121.5645 } // 台北101(約 5 公里)

describe('projectMercator / unprojectMercator', () => {
  it('往返後回到原點(浮點誤差內)', () => {
    for (const p of [A, { lat: -33.86, lng: 151.21 }, { lat: 64.1, lng: -21.9 }]) {
      const back = unprojectMercator(projectMercator(p))
      expect(back.lat).toBeCloseTo(p.lat, 9)
      expect(back.lng).toBeCloseTo(p.lng, 9)
    }
  })

  it('x 隨經度、y 隨緯度(向下):北邊 y 較小', () => {
    expect(projectMercator({ lat: 0, lng: 0 })).toEqual({ x: 0.5, y: 0.5 })
    expect(projectMercator({ lat: 10, lng: 0 }).y).toBeLessThan(0.5)
    expect(projectMercator({ lat: 0, lng: 90 }).x).toBe(0.75)
  })
})

describe('arcChordMeters', () => {
  it('台北車站到台北 101 約 5 公里', () => {
    const m = arcChordMeters(A, B)
    expect(m).toBeGreaterThan(4500)
    expect(m).toBeLessThan(5500)
  })
})

describe('arcPath', () => {
  it('兩端點原樣保留(同一個物件),點數為 ARC_SEGMENTS + 1', () => {
    const path = arcPath(A, B)
    expect(path).toHaveLength(ARC_SEGMENTS + 1)
    expect(path[0]).toBe(A)
    expect(path[path.length - 1]).toBe(B)
  })

  it('中點偏離弦的距離約為弦長 × ARC_SAG_RATIO(在投影平面上量)', () => {
    const path = arcPath(A, B)
    const a = projectMercator(A)
    const b = projectMercator(B)
    const mid = projectMercator(path[ARC_SEGMENTS / 2])
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    // 點到直線 AB 的距離
    const dist = Math.abs((b.x - a.x) * (a.y - mid.y) - (a.x - mid.x) * (b.y - a.y)) / len
    expect(dist / len).toBeCloseTo(ARC_SAG_RATIO, 3)
  })

  it('方向固定:一律鼓向行進方向的左側,所以 A→B 與 B→A 的弧在弦的兩側(不重疊)', () => {
    const a = projectMercator(A)
    const b = projectMercator(B)
    const side = (p: { lat: number; lng: number }) => {
      const m = projectMercator(p)
      return Math.sign((b.x - a.x) * (m.y - a.y) - (b.y - a.y) * (m.x - a.x))
    }
    const forward = arcPath(A, B)[ARC_SEGMENTS / 2]
    const backward = arcPath(B, A)[ARC_SEGMENTS / 2]
    expect(side(forward)).not.toBe(0)
    expect(side(forward)).toBe(-side(backward))
    // 往東走時左側是北:中點緯度比弦中點高。
    const east = arcPath({ lat: 25, lng: 121 }, { lat: 25, lng: 121.1 })[ARC_SEGMENTS / 2]
    expect(east.lat).toBeGreaterThan(25)
  })

  it('弧上每個點都落在以弦為底的那一側、且單調前進(不會折返)', () => {
    const path = arcPath(A, B).map(projectMercator)
    const a = path[0]
    const b = path[path.length - 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    let prev = -Infinity
    for (const p of path) {
      const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)
      expect(t).toBeGreaterThan(prev)
      prev = t
    }
  })

  it('太短的段退回兩點直線', () => {
    const near = { lat: A.lat + 0.0001, lng: A.lng } // 約 11 公尺
    expect(arcChordMeters(A, near)).toBeLessThan(ARC_MIN_METERS)
    expect(arcPath(A, near)).toEqual([A, near])
    expect(arcPath(A, A)).toEqual([A, A])
  })

  it('純函式:同樣輸入得到同樣輸出', () => {
    expect(arcPath(A, B)).toEqual(arcPath(A, B))
  })
})
