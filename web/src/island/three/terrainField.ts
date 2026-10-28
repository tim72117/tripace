// terrainField.ts——連續地形(layout.terrain 高度場)的網格:頂面 + 切片側壁(three 渲染層,建構一次)。
//
// 頂面:輪廓點、平台輪廓點與抖動格點一起做 Delaunay 剖分,每個頂點的高度由 heightAt 算(與步道、建築、散落物貼地用的是同一個函式)。
// 非索引三角形加頂點色,flatShading 才有低多邊形的稜面感;每塊顏色依平台、坡度、高度決定(平台色 > 陡坡岩色 > 低處沙灘色 > 草色隨高度漸變)。
// 側壁:沿輪廓(與頂面共用同一批輪廓點,沒有裂縫)從地表高度往下收到 floorY,依深度分層上色,做出「地形切片」的土層斷面。
import * as THREE from 'three'
import type { IslandLayout, Pt } from '../data/layoutTypes'
import { delaunay } from '../logic/delaunay'
import { pointInPolygon } from '../logic/geometry'
import { mulberry32 } from '../logic/rng'

const DEFAULT_CELL = 2
const DEFAULT_SOIL = ['#7a5a3e', '#6a4d36', '#5a4331', '#4a382a']
const DEFAULT_ROCK = '#8a7f6f'
const STEEP = 0.72 // 法線 y 分量低於這個(約 44° 以上)視為陡坡;太高會讓雜訊的小稜面零星變成岩色

export type FieldTerrainGeometry = { top: THREE.BufferGeometry; wall: THREE.BufferGeometry }

const hashRnd = (x: number, z: number, salt: number) =>
  mulberry32((((Math.round(x * 1000 + 1e-6) * 73856093) ^ (Math.round(z * 1000 + 1e-6) * 19349663) ^ (salt * 83492791)) >>> 0))()

// 沿閉合多邊形每隔 ≤ step 補點(含原頂點)
export function subdivideRing(poly: ReadonlyArray<Pt>, step: number): Pt[] {
  const out: Pt[] = []
  poly.forEach(([x1, z1], i) => {
    const [x2, z2] = poly[(i + 1) % poly.length]
    const k = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / step))
    for (let j = 0; j < k; j++) out.push([x1 + ((x2 - x1) * j) / k, z1 + ((z2 - z1) * j) / k])
  })
  return out
}

function distToRing(x: number, z: number, poly: ReadonlyArray<Pt>): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i]
    const [x2, z2] = poly[(i + 1) % poly.length]
    const dx = x2 - x1, dz = z2 - z1
    const len2 = dx * dx + dz * dz
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / len2))
    best = Math.min(best, Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t)))
  }
  return best
}

// 地表網格的頂點(平面座標):輪廓點、平台輪廓點、抖動格點;太近的點略過,避免剖分出細長三角形。
export function fieldSurfacePoints(layout: Pick<IslandLayout, 'outline' | 'terrain'>): { points: Pt[]; ring: Pt[] } {
  const cell = layout.terrain?.cell ?? DEFAULT_CELL
  const ring = subdivideRing(layout.outline, cell)
  const points: Pt[] = [...ring]
  const minD = cell * 0.35
  const bucket = new Map<string, Pt[]>()
  const key = (x: number, z: number) => `${Math.floor(x / minD)},${Math.floor(z / minD)}`
  const add = (p: Pt) => {
    const kx = Math.floor(p[0] / minD), kz = Math.floor(p[1] / minD)
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const q of bucket.get(`${kx + dx},${kz + dz}`) ?? []) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < minD) return false
    }
    const k = key(p[0], p[1])
    if (!bucket.has(k)) bucket.set(k, [])
    bucket.get(k)!.push(p)
    return true
  }
  const out: Pt[] = []
  for (const p of points) if (add(p)) out.push(p)
  // 平台輪廓:稍密一點,平台邊緣才俐落
  for (const pad of layout.terrain?.pads ?? []) {
    for (const p of subdivideRing(pad.outline, cell * 0.6)) {
      if (pointInPolygon(p[0], p[1], layout.outline) && distToRing(p[0], p[1], layout.outline) > cell * 0.5 && add(p)) out.push(p)
    }
  }
  const xs = layout.outline.map((p) => p[0]), zs = layout.outline.map((p) => p[1])
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += cell) {
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += cell) {
      const p: Pt = [x + (hashRnd(x, z, 8) - 0.5) * cell * 0.7, z + (hashRnd(x, z, 9) - 0.5) * cell * 0.7]
      if (pointInPolygon(p[0], p[1], layout.outline) && distToRing(p[0], p[1], layout.outline) > cell * 0.6 && add(p)) out.push(p)
    }
  }
  return { points: out, ring: subdivideRing(layout.outline, cell) }
}

export function fieldTerrainGeometry(layout: IslandLayout, heightAt: (x: number, z: number) => number): FieldTerrainGeometry {
  const t = layout.terrain!
  const { palette, outline, topY, thickness } = layout
  const floorY = topY - thickness
  const grass = new THREE.Color(palette.grass)
  const grassHigh = new THREE.Color(palette.grassAlt)
  const rock = new THREE.Color(t.colors?.rock ?? DEFAULT_ROCK)
  const beach = new THREE.Color(t.colors?.beach ?? palette.dirt)
  const beachY = t.colors?.beachY ?? topY + 0.5
  const soil = (t.colors?.soil ?? DEFAULT_SOIL).map((c) => new THREE.Color(c))
  const padColors = (t.pads ?? []).map((p) => (p.color ? new THREE.Color(p.color) : null))

  const { points, ring } = fieldSurfacePoints(layout)
  const ys = points.map(([x, z]) => heightAt(x, z)) // 每個點只算一次高度(三角形共用頂點)
  const peak = Math.max(1, ...ys)

  // ---- 頂面 ----
  const pos: number[] = []
  const col: number[] = []
  const color = new THREE.Color()
  for (const [ia, ib, ic] of delaunay(points)) {
    const cx = (points[ia][0] + points[ib][0] + points[ic][0]) / 3
    const cz = (points[ia][1] + points[ib][1] + points[ic][1]) / 3
    if (!pointInPolygon(cx, cz, outline)) continue
    const a: [number, number, number] = [points[ia][0], ys[ia], points[ia][1]]
    let b: [number, number, number] = [points[ib][0], ys[ib], points[ib][1]]
    let c: [number, number, number] = [points[ic][0], ys[ic], points[ic][1]]
    // 法線朝上
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])
    if (ny < 0) [b, c] = [c, b]
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    const nx = uy * vz - uz * vy, nyy = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const up = Math.abs(nyy) / (Math.hypot(nx, nyy, nz) || 1)
    const hMid = (a[1] + b[1] + c[1]) / 3

    let padIdx = -1
    ;(t.pads ?? []).forEach((p, i) => { if (padColors[i] && pointInPolygon(cx, cz, p.outline)) padIdx = i })
    if (padIdx >= 0) color.copy(padColors[padIdx]!)
    else if (up < STEEP) color.copy(rock)
    else if (hMid < beachY) color.copy(beach)
    else color.copy(grass).lerp(grassHigh, Math.min(1, Math.max(0, (hMid - topY) / Math.max(1, peak - topY))))
    color.multiplyScalar(0.9 + hashRnd(a[0] + b[0] + c[0], a[2] + b[2] + c[2], 4) * 0.2)

    pos.push(...a, ...b, ...c)
    for (let k = 0; k < 3; k++) col.push(color.r, color.g, color.b)
  }
  const top = new THREE.BufferGeometry()
  top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  top.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  top.computeVertexNormals()

  // ---- 側壁(切片土層)----
  let area2 = 0
  ring.forEach(([x1, z1], i) => { const [x2, z2] = ring[(i + 1) % ring.length]; area2 += x1 * z2 - x2 * z1 })
  const wpos: number[] = []
  const wcol: number[] = []
  const maxTop = Math.max(...ring.map(([x, z]) => heightAt(x, z)))
  const rows = Math.max(1, Math.ceil((maxTop - floorY) / 1.4)) // 列數全輪廓共用,相鄰段共用的點高度才一致
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i]
    const [x2, z2] = ring[(i + 1) % ring.length]
    const top1 = heightAt(x1, z1), top2 = heightAt(x2, z2)
    const dx = x2 - x1, dz = z2 - z1
    const out: [number, number] = area2 > 0 ? [dz, -dx] : [-dz, dx]
    const at = (cIdx: number, r: number): [number, number, number] => {
      const f = r / rows
      const [x, z, tp] = cIdx === 0 ? [x1, z1, top1] : [x2, z2, top2]
      return [x, tp + (floorY - tp) * f, z]
    }
    const wtri = (p: number[], q: number[], r: number[], depthFrac: number) => {
      const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]]
      const w = [r[0] - p[0], r[1] - p[1], r[2] - p[2]]
      const nx = u[1] * w[2] - u[2] * w[1]
      const nz = u[0] * w[1] - u[1] * w[0]
      if (nx * out[0] + nz * out[1] >= 0) wpos.push(...p, ...q, ...r)
      else wpos.push(...p, ...r, ...q)
      const si = Math.min(soil.length - 1, Math.floor(depthFrac * soil.length))
      const c = soil[si].clone().multiplyScalar(0.88 + hashRnd(p[0] + q[0] + r[0], p[1] + q[1] + r[1] + p[2] + q[2] + r[2], 7) * 0.24)
      for (let m = 0; m < 3; m++) wcol.push(c.r, c.g, c.b)
    }
    for (let r = 0; r < rows; r++) {
      const f = (r + 0.5) / rows
      wtri(at(0, r), at(0, r + 1), at(1, r), f)
      wtri(at(1, r), at(0, r + 1), at(1, r + 1), f)
    }
  }
  const wall = new THREE.BufferGeometry()
  wall.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3))
  wall.setAttribute('color', new THREE.Float32BufferAttribute(wcol, 3))
  wall.computeVertexNormals()
  return { top, wall }
}
