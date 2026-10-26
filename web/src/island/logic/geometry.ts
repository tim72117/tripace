// geometry.ts——平面幾何小工具(純函式)。座標是 layoutTypes.ts 的 (x, z)。
import type { Pt } from '../data/layoutTypes'

// pointInPolygon——射線法,判斷 (x, z) 是否在多邊形內(邊界上的結果不保證)。
export function pointInPolygon(x: number, z: number, poly: ReadonlyArray<Pt>): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

export function polygonCentroid(poly: ReadonlyArray<Pt>): Pt {
  let sx = 0
  let sz = 0
  for (const [x, z] of poly) { sx += x; sz += z }
  return [sx / poly.length, sz / poly.length]
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

// distToPolyline——點到折線的最短距離(用來檢查散落物是否擋在步道上)。
export function distToPolyline(x: number, z: number, line: ReadonlyArray<Pt>): number {
  let best = Infinity
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i]
    const [bx, bz] = line[i + 1]
    const dx = bx - ax
    const dz = bz - az
    const len2 = dx * dx + dz * dz
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2))
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)))
  }
  return best
}
