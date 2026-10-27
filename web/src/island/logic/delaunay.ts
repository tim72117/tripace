// delaunay.ts——Bowyer–Watson 三角剖分(純函式,決定性)。點數在幾百個內夠用(O(n²))。
// 回傳三角形的點索引 [a, b, c];輸出不含超級三角形。
import type { Pt } from '../data/layoutTypes'

export function delaunay(points: ReadonlyArray<Pt>): Array<[number, number, number]> {
  const n = points.length
  if (n < 3) return []
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  const d = Math.max(maxX - minX, maxY - minY, 1) * 20
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  const pts: Pt[] = [...points, [cx - d, cy - d], [cx + d, cy - d], [cx, cy + d]]

  type Tri = { a: number; b: number; c: number; ux: number; uy: number; r2: number }
  const make = (a: number, b: number, c: number): Tri => {
    const [ax, ay] = pts[a], [bx, by] = pts[b], [cx2, cy2] = pts[c]
    const dd = 2 * (ax * (by - cy2) + bx * (cy2 - ay) + cx2 * (ay - by))
    const ux = ((ax * ax + ay * ay) * (by - cy2) + (bx * bx + by * by) * (cy2 - ay) + (cx2 * cx2 + cy2 * cy2) * (ay - by)) / dd
    const uy = ((ax * ax + ay * ay) * (cx2 - bx) + (bx * bx + by * by) * (ax - cx2) + (cx2 * cx2 + cy2 * cy2) * (bx - ax)) / dd
    return { a, b, c, ux, uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 }
  }

  let tris: Tri[] = [make(n, n + 1, n + 2)]
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[i]
    const bad: Tri[] = []
    const keep: Tri[] = []
    for (const t of tris) ((px - t.ux) ** 2 + (py - t.uy) ** 2 < t.r2 - 1e-12 ? bad : keep).push(t)
    // 壞三角形的外圍邊(只出現一次的邊)
    const count = new Map<string, [number, number, number]>()
    for (const t of bad) {
      for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as Array<[number, number]>) {
        const k = u < v ? `${u},${v}` : `${v},${u}`
        const e = count.get(k)
        if (e) e[2]++
        else count.set(k, [u, v, 1])
      }
    }
    tris = keep
    for (const [u, v, c] of count.values()) if (c === 1) tris.push(make(u, v, i))
  }
  return tris.filter((t) => t.a < n && t.b < n && t.c < n).map((t) => [t.a, t.b, t.c])
}
