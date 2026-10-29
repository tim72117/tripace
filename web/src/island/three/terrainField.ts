// terrainField.ts——連續地形(layout.terrain 高度場)的網格:頂面 + 切片側壁(three 渲染層,建構一次)。
//
// 頂面:輪廓點、平台輪廓點與抖動格點一起做 Delaunay 剖分,每個頂點的高度由 heightAt 算(與步道、建築、散落物貼地用的是同一個函式)。
// 非索引三角形加頂點色,flatShading 才有低多邊形的稜面感;每塊顏色依平台、坡度、高度決定(平台色 > 陡坡岩色 > 低處沙灘色 > 草色隨高度漸變)。
// 側壁:沿輪廓(與頂面共用同一批輪廓點,沒有裂縫)從地表高度往下收到 floorY,依深度分層上色,做出「地形切片」的土層斷面。
import * as THREE from 'three'
import type { IslandLayout, Pt } from '../data/layoutTypes'
import { delaunay } from '../logic/delaunay'
import { fbmAt } from '../logic/heightfield'
import { sampledHeight, surfaceMetrics, surfaceWeights } from '../logic/terrainShade'
import { pointInPolygon } from '../logic/geometry'
import { mulberry32 } from '../logic/rng'

const DEFAULT_CELL = 3.13
const DEFAULT_SOIL = ['#7a5a3e', '#6a4d36', '#5a4331', '#4a382a']
const DEFAULT_ROCK = '#8a7f6f'
const SHADE_SEED = 31 // 著色用雜訊的種子(只影響顏色,不影響形狀)
// 著色的長度基準(公尺):雜訊斑塊大小、沙灘過渡寬、地層條紋間距、曲率門檻都以這個長度為 1 調出來
// (世界單位改成 1 格 = 1 m 之前的 1 格 ≈ 1.56 m),乘上它外觀才和調整時一致。
const SHADE_LEN = 1.5625

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
  if (outline.length < 3) throw new Error(`地形輪廓至少需要 3 個點(目前 ${outline.length} 個)`)
  const floorY = topY - thickness
  const grass = new THREE.Color(palette.grass)
  const grassHigh = new THREE.Color(palette.grassAlt)
  const rock = new THREE.Color(t.colors?.rock ?? DEFAULT_ROCK)
  const beach = new THREE.Color(t.colors?.beach ?? palette.dirt)
  const beachY = t.colors?.beachY ?? topY + 0.78
  const soil = (t.colors?.soil ?? DEFAULT_SOIL).map((c) => new THREE.Color(c))
  const padColors = (t.pads ?? []).map((p) => (p.color ? new THREE.Color(p.color) : null))
  const dirtC = new THREE.Color(palette.dirt)
  const dryC = new THREE.Color(palette.grassAlt).lerp(beach, 0.35)
  const grassDark = new THREE.Color(palette.grass).multiplyScalar(0.82)
  const eps = (t.cell ?? DEFAULT_CELL) * 0.6 // 坡度/曲率的差分步長:略比格距小,讀得到網格能表現的起伏
  const bx = outline.map((p) => p[0]), bz = outline.map((p) => p[1])
  // 著色用的高度格網(步長 = eps,差分的取樣點剛好落在格點上);外留 2×eps 邊,差分在輪廓邊緣也讀得到
  const shadeH = sampledHeight(heightAt, Math.min(...bx), Math.max(...bx), Math.min(...bz), Math.max(...bz), eps, eps * 2.2)

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
    const hMid = (a[1] + b[1] + c[1]) / 3

    let padIdx = -1
    ;(t.pads ?? []).forEach((p, i) => { if (padColors[i] && pointInPolygon(cx, cz, p.outline)) padIdx = i })
    let ao = 1
    if (padIdx >= 0) color.copy(padColors[padIdx]!)
    else {
      // 坡度與曲率取自高度場(不是三角形法線),著色與網格疏密無關
      const sm = surfaceMetrics(shadeH, cx, cz, eps)
      const w = surfaceWeights({ grade: sm.grade, concavity: sm.concavity * SHADE_LEN }, fbmAt(cx, cz, SHADE_SEED, 7 * SHADE_LEN, 2))
      ao = w.ao
      // 草:隨高度漸變,再用低頻雜訊疊出深淺斑塊
      const patch = fbmAt(cx, cz, SHADE_SEED + 11, 9 * SHADE_LEN, 3)
      color.copy(grass).lerp(grassHigh, Math.min(1, Math.max(0, (hMid - topY) / Math.max(1, peak - topY))))
      color.lerp(patch > 0 ? grassHigh : grassDark, Math.abs(patch) * 0.55)
      color.lerp(dryC, w.dry).lerp(dirtC, w.dirt)
      // 低處沙灘:邊界隨雜訊彎曲,不呈一條等高線
      const shore = THREE.MathUtils.smoothstep(beachY + fbmAt(cx, cz, SHADE_SEED + 23, 5 * SHADE_LEN, 2) * 0.45 * SHADE_LEN - hMid, 0, 0.35 * SHADE_LEN)
      color.lerp(beach, shore)
      // 岩石:依高度分層(地層)的明暗條紋
      const strata = 1 + 0.07 * Math.sin((hMid / SHADE_LEN) * 2.6 + fbmAt(cx, cz, SHADE_SEED + 37, 4 * SHADE_LEN, 2) * 2)
      color.lerp(rock.clone().multiplyScalar(strata), w.rock * (1 - shore))
    }
    color.multiplyScalar(ao * (0.92 + hashRnd(a[0] + b[0] + c[0], a[2] + b[2] + c[2], 4) * 0.16))

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
  const rows = Math.max(1, Math.ceil((maxTop - floorY) / (1.4 * SHADE_LEN))) // 列數全輪廓共用,相鄰段共用的點高度才一致
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
