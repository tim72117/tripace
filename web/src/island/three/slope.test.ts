// slopeGeometry:斜坡的網格(頂面 + 往下收的裙邊)。
import { describe, expect, it } from 'vitest'
import type { Pt } from '../data/layoutTypes'
import { slopeHeightAt } from '../logic/terrain'
import { slopeGeometry } from './terrain'

const slope = { outline: [[0, 0], [10, 0], [10, 10], [0, 10]] as Pt[], from: [5, 0] as Pt, to: [5, 10] as Pt, y0: 2, y1: 6 }

function triangles(geo: ReturnType<typeof slopeGeometry>) {
  const pos = geo.getAttribute('position')
  const out: Array<Array<[number, number, number]>> = []
  for (let i = 0; i < pos.count; i += 3) {
    out.push([0, 1, 2].map((k) => [pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)] as [number, number, number]))
  }
  return out
}

describe('slopeGeometry', () => {
  const geo = slopeGeometry(slope, 0)
  const tris = triangles(geo)
  const normalY = (t: Array<[number, number, number]>) => {
    const [a, b, c] = t
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    return u[2] * v[0] - u[0] * v[2]
  }

  it('頂面每個頂點的高度都等於 slopeHeightAt', () => {
    const top = tris.filter((t) => t.every((p) => p[1] > 0))
    expect(top.length).toBeGreaterThan(0)
    for (const t of top) for (const [x, y, z] of t) expect(y).toBeCloseTo(slopeHeightAt(slope, x, z))
  })

  it('頂面三角形朝上(法線 y > 0)', () => {
    const top = tris.filter((t) => t.every((p) => p[1] > 0))
    for (const t of top) expect(normalY(t)).toBeGreaterThan(0)
  })

  it('裙邊一路收到 floorY', () => {
    const ys = tris.flat().map((p) => p[1])
    expect(Math.min(...ys)).toBeCloseTo(0)
  })

  it('floorY 可指定', () => {
    const g = slopeGeometry(slope, -1)
    const pos = g.getAttribute('position')
    let min = Infinity
    for (let i = 0; i < pos.count; i++) min = Math.min(min, pos.getY(i))
    expect(min).toBeCloseTo(-1)
  })

  it('三角形數合理:矩形頂面 2 片 + 4 邊各 2 片裙邊', () => {
    expect(tris.length).toBe(2 + 4 * 2)
  })
})

describe('slopeGeometry 峭壁(crag)', () => {
  const crag = { seed: 3, amp: 0.5, detail: 3 }
  const cs = { ...slope, crag }
  const geo = slopeGeometry(cs, 0)
  const tris = triangles(geo)
  // 頂面三角形排在緩衝區最前面,groups[0] 標出範圍
  const topTris = tris.slice(0, geo.groups[0].count / 3)
  const onOutline = (x: number, z: number) => x === 0 || x === 10 || z === 0 || z === 10

  it('細分後三角形數遠多於平面斜坡,且帶頂點色', () => {
    expect(tris.length).toBeGreaterThan(2 + 4 * 2)
    expect(geo.getAttribute('color')).toBeTruthy()
  })
  it('相同種子產生相同形狀', () => {
    const a = slopeGeometry(cs, 0).getAttribute('position').array
    expect(Array.from(a)).toEqual(Array.from(geo.getAttribute('position').array))
  })
  it('輪廓上的點不被抖動(與裙邊、相鄰地面不裂縫)', () => {
    for (const [x, y, z] of topTris.flat()) {
      if (onOutline(x, z)) expect(y).toBeCloseTo(slopeHeightAt(slope, x, z))
    }
  })
  it('內部點有高低起伏,但不超過 amp', () => {
    let maxDev = 0
    let inner = 0
    for (const [x, y, z] of topTris.flat().filter((p) => !onOutline(p[0], p[2]))) {
      inner++
      maxDev = Math.max(maxDev, Math.abs(y - slopeHeightAt(slope, x, z)))
    }
    expect(inner).toBeGreaterThan(0)
    expect(maxDev).toBeGreaterThan(0.05)
    expect(maxDev).toBeLessThanOrEqual(crag.amp + 1e-6)
  })
  it('amp 為 0 時退化成平面斜坡的高度', () => {
    const flatTris = triangles(slopeGeometry({ ...slope, crag: { ...crag, amp: 0 } }, 0))
    const tops = flatTris.filter((tr) => tr.every((p) => p[1] > 0 && Math.abs(p[1] - slopeHeightAt(slope, p[0], p[2])) < 1e-6))
    expect(tops.length).toBeGreaterThan(10)
  })

  it('側面(裙邊)也細分成稜面,且一路收到 floorY', () => {
    const wallTris = tris.filter((tr) => !topTris.includes(tr))
    expect(wallTris.length).toBeGreaterThan(4 * 2)
    expect(Math.min(...wallTris.flat().map((p) => p[1]))).toBeCloseTo(0)
  })

  it('相鄰兩面側壁在共用的角上格點一致:斜向方向線的矩形斜坡也是密閉的', () => {
    const diag = { ...slope, from: [0, 0] as Pt, to: [10, 10] as Pt } // 角 (10,0) 的頂緣高 4,兩側邊最高點不同
    const gg = slopeGeometry({ ...diag, crag }, 0)
    const edges = new Map<string, number>()
    const key = (p: number[]) => p.map((n) => Math.round(n * 1e4)).join(',')
    for (const t of triangles(gg)) {
      for (let k = 0; k < 3; k++) {
        const a = key(t[k]), b = key(t[(k + 1) % 3])
        const e = a < b ? `${a}|${b}` : `${b}|${a}`
        edges.set(e, (edges.get(e) ?? 0) + 1)
      }
    }
    const bad = [...edges].filter(([e, n]) => (e.split('|').every((p) => Number(p.split(',')[1]) === 0) ? n !== 1 : n !== 2))
    expect(bad.length).toBe(0)
  })

  it('抖動只往外/往上長,不會陷到真實地面以下(不穿透階地與島體)', () => {
    for (const [x, y, z] of topTris.flat()) expect(y).toBeGreaterThanOrEqual(slopeHeightAt(slope, x, z) - 1e-6)
  })
})

describe('slopeGeometry 峭壁 密合度(沒有裂縫)', () => {
  // 代表性的斜坡(凸五邊形 + 60° + crag,即舊九份版面的山壁形狀;九份現在改用連續地形,但斜坡仍是引擎支援的舊版資料):
  // 每條邊必須被兩個三角形共用,只有最底邊(floorY)只用一次
  const key = (p: number[]) => p.map((n) => Math.round(n * 1e4)).join(',')
  it('代表性的斜坡是密閉的:除底邊外每條邊恰好被 2 個三角形共用', () => {
    const run = 4
    const sl = {
      outline: [[-30, -20], [-15, -30], [0, -33], [15, -30], [30, -20]] as Pt[],
      from: [0, -18] as Pt,
      to: [0, -18 - run] as Pt,
      y0: 6,
      y1: 6 + run * Math.tan(Math.PI / 3),
      crag: { seed: 11, amp: 0.55, detail: 3, rockColor: '#8f8372' },
    }
    const floorY = -0.25
    const edges = new Map<string, number>()
    for (const t of triangles(slopeGeometry(sl, floorY))) {
      for (let i = 0; i < 3; i++) {
        const a = key(t[i]), b = key(t[(i + 1) % 3])
        const k = a < b ? `${a}|${b}` : `${b}|${a}`
        edges.set(k, (edges.get(k) ?? 0) + 1)
      }
    }
    const bad = [...edges].filter(([k, n]) => {
      const onFloor = k.split('|').every((p) => Number(p.split(',')[1]) === Math.round(floorY * 1e4))
      return onFloor ? n !== 1 : n !== 2
    })
    expect(bad.length).toBe(0)
  })
})
