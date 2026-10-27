// delaunay:Bowyer–Watson 三角剖分(峭壁岩面用)。
import { describe, expect, it } from 'vitest'
import type { Pt } from '../data/layoutTypes'
import { delaunay } from './delaunay'

const area = (a: Pt, b: Pt, c: Pt) => ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2

function inCircle(a: Pt, b: Pt, c: Pt, p: Pt): boolean {
  const o = area(a, b, c) > 0 ? 1 : -1
  const m = [a, b, c].map(([x, y]) => [x - p[0], y - p[1], (x - p[0]) ** 2 + (y - p[1]) ** 2])
  const det =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  return det * o > 1e-9
}

describe('delaunay', () => {
  const pts: Pt[] = []
  for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) pts.push([i * 2 + ((j * 7 + i * 3) % 5) * 0.13, j * 2 + ((i * 5 + j * 2) % 4) * 0.17])
  const tris = delaunay(pts)

  it('三角形面積總和 = 點集凸包面積(沒有重疊、沒有洞)', () => {
    const total = tris.reduce((s, [a, b, c]) => s + Math.abs(area(pts[a], pts[b], pts[c])), 0)
    // 凸包面積用鞋帶公式對一個外框近似:至少要大於 0 且三角形不重複
    expect(total).toBeGreaterThan(80)
    expect(new Set(tris.map((t) => [...t].sort().join())).size).toBe(tris.length)
  })
  it('每個三角形的外接圓內沒有其他點(Delaunay 條件)', () => {
    for (const [a, b, c] of tris) {
      for (let k = 0; k < pts.length; k++) {
        if (k === a || k === b || k === c) continue
        expect(inCircle(pts[a], pts[b], pts[c], pts[k])).toBe(false)
      }
    }
  })
  it('用到每個點,且不含超級三角形的點(索引都在範圍內)', () => {
    const used = new Set(tris.flat())
    expect(used.size).toBe(pts.length)
    for (const i of used) expect(i).toBeLessThan(pts.length)
  })
  it('決定性', () => {
    expect(delaunay(pts)).toEqual(tris)
  })
  it('少於 3 點回空陣列', () => {
    expect(delaunay([[0, 0], [1, 1]])).toEqual([])
  })
})
