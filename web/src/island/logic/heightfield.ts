// heightfield.ts——連續地形的高度場(純函式,不依賴 three)。
//
// 高度 = ramp(基底斜面) + Σ features(bump 隆起、ridge 山脊) + noise(低頻起伏),最後依序套用 pads(削平的平台,後面的蓋前面的)。
// 全部是平滑、連續的函式,沒有垂直落差:這是跟舊的疊層階地最大的差別(階地會做出同心的環)。
// 平台內部高度精確等於 pad.y(房子、站點放上去才不會懸空),外圍 blend 格內用 smoothstep 接回原地形。
import type { BumpSpec, NoiseSpec, PadSpec, Pt, RampSpec, RidgeSpec, TerrainSpec } from '../data/layoutTypes'
import { pointInPolygon } from './geometry'

const smoothstep = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c) }
// 餘弦衰減:r=0 → 1,r>=1 → 0,中間平滑(兩端斜率為 0)
const cosFall = (r: number) => (r >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * Math.max(0, r))))

export function rampAt(r: RampSpec, x: number, z: number): number {
  const dx = r.to[0] - r.from[0]
  const dz = r.to[1] - r.from[1]
  const len2 = dx * dx + dz * dz
  if (len2 === 0) return r.y0
  const t = Math.max(0, Math.min(1, ((x - r.from[0]) * dx + (z - r.from[1]) * dz) / len2))
  return r.y0 + (r.y1 - r.y0) * t
}

export function bumpAt(b: BumpSpec, x: number, z: number): number {
  const c = Math.cos(b.rot ?? 0), s = Math.sin(b.rot ?? 0)
  const dx = x - b.x, dz = z - b.z
  const u = (dx * c + dz * s) / b.rx
  const v = (-dx * s + dz * c) / b.rz
  return b.height * cosFall(Math.hypot(u, v))
}

// 山脊:取到折線最近點的距離 d 與該點內插出的脊高,橫斷面餘弦衰減到 halfWidth。
export function ridgeAt(r: RidgeSpec, x: number, z: number): number {
  let bestD = Infinity
  let bestH = 0
  for (let i = 0; i < r.points.length - 1; i++) {
    const [ax, az, ah] = r.points[i]
    const [bx, bz, bh] = r.points[i + 1]
    const dx = bx - ax, dz = bz - az
    const len2 = dx * dx + dz * dz
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2))
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t))
    if (d < bestD) { bestD = d; bestH = ah + (bh - ah) * t }
  }
  if (r.points.length === 1) { bestD = Math.hypot(x - r.points[0][0], z - r.points[0][1]); bestH = r.points[0][2] }
  return bestH * cosFall(bestD / r.halfWidth)
}

// 格點雜湊 → [0,1)(決定性)
function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// 平滑值雜訊,範圍約 [-amp, amp]
export function noiseAt(n: NoiseSpec, x: number, z: number): number {
  const fx = x / n.scale, fz = z / n.scale
  const ix = Math.floor(fx), iz = Math.floor(fz)
  const tx = smoothstep(fx - ix), tz = smoothstep(fz - iz)
  const a = hash2(ix, iz, n.seed), b = hash2(ix + 1, iz, n.seed), c = hash2(ix, iz + 1, n.seed), d = hash2(ix + 1, iz + 1, n.seed)
  const v = a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz
  return (v * 2 - 1) * n.amp
}

function distToPolygonEdge(x: number, z: number, poly: ReadonlyArray<Pt>): number {
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

// 平台權重:內部 1,外圍 blend 格內從 1 平滑降到 0(blend = 0 時是陡邊)。
export function padWeight(p: PadSpec, x: number, z: number): number {
  if (pointInPolygon(x, z, p.outline)) return 1
  if (p.blend <= 0) return 0
  return 1 - smoothstep(distToPolygonEdge(x, z, p.outline) / p.blend)
}

// 平台以外的地形(ramp + features + noise)
export function baseFieldAt(t: TerrainSpec, x: number, z: number): number {
  let h = t.ramp ? rampAt(t.ramp, x, z) : 0
  for (const f of t.features ?? []) h += f.kind === 'bump' ? bumpAt(f, x, z) : ridgeAt(f, x, z)
  if (t.noise) h += noiseAt(t.noise, x, z)
  return h
}

export function heightFieldAt(t: TerrainSpec, x: number, z: number): number {
  let h = baseFieldAt(t, x, z)
  for (const p of t.pads ?? []) {
    const w = padWeight(p, x, z)
    if (w > 0) h += (p.y - h) * w
  }
  return h
}
