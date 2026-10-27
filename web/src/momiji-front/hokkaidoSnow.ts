// hokkaidoSnow.ts——北海道降雪/積雪的純邏輯(沒有 DOM、沒有 Maps):挑出
// 北海道本島輪廓、在輪廓內決定性地撒積雪斑塊,並依「離海岸多遠」決定每個
// 斑塊的出現門檻(內陸大雪山一帶先白、海岸最後)。降雪粒子與強度/積雪量的
// 狀態機在 snowfall.ts,繪製在 momijiRenderer.ts。

import { JAPAN_LAND } from './japanLand'
import { mulberry32, pointInRing, type LandRing } from './momijiFrontModel'

// 札幌:用「環內含札幌」挑北海道,不能只用緯度(本州最北的下北半島 lat 約 41.5)。
export const SAPPORO = { lng: 141.35, lat: 43.06 } as const
// 大雪山:積雪最早出現的內陸中心。
export const DAISETSUZAN = { lng: 142.85, lat: 43.66 } as const
// 輪廓點數上限:每幀都要投影一次,超過就等距抽稀。
export const RING_MAX_POINTS = 300

// ===== 積雪斑塊可調參數 =====
// 零星分布(2026-10 使用者要求「不要蓋滿地上」):數量少、斑塊之間看得到陸地與楓葉。
export const PATCH_COUNT = 130
export const PATCH_SEED = 20261022
// 斑塊半徑(畫布單位,渲染層乘 unit),[最小, 最大];ry 是 rx 的壓扁比例。
export const PATCH_RADIUS: readonly [number, number] = [3.5, 7.5]
export const PATCH_FLATTEN: readonly [number, number] = [0.55, 0.9]
export const PATCH_ALPHA: readonly [number, number] = [0.75, 1]
// 出現門檻 = (1 − 內陸程度) × SCALE ± NOISE:海岸門檻接近 1,高於 cover 上限
// (snowfall.ts COVER_MAX ≈ 0.8),所以最大積雪時海岸一圈仍是裸露陸地。
export const PATCH_THRESHOLD_SCALE = 1
export const PATCH_THRESHOLD_NOISE = 0.07
// 內陸程度 = COAST_WEIGHT × 離海岸距離 + (1 − COAST_WEIGHT) × 靠近大雪山程度(都歸一化)。
export const PATCH_COAST_WEIGHT = 0.75
// ramp 是從門檻到完全長滿的 cover 跨度。
export const PATCH_RAMP = 0.12

const COS_LAT = Math.cos((43 * Math.PI) / 180)

export function pickRingContaining(land: ReadonlyArray<LandRing>, lng: number, lat: number): LandRing | null {
  return land.find((ring) => pointInRing(lng, lat, ring)) ?? null
}

// thinRing——點數超過 max 時等距抽稀(保留首點),否則原樣回傳。
export function thinRing(ring: LandRing, max: number): LandRing {
  if (ring.length <= max) return ring
  const step = ring.length / max
  const out: Array<readonly [number, number]> = []
  for (let i = 0; i < max; i++) out.push(ring[Math.floor(i * step)])
  return out
}

export interface LngLatBbox { minLng: number; maxLng: number; minLat: number; maxLat: number }

export function ringBbox(ring: LandRing): LngLatBbox {
  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const [x, y] of ring) {
    if (x < minLng) minLng = x
    if (x > maxLng) maxLng = x
    if (y < minLat) minLat = y
    if (y > maxLat) maxLat = y
  }
  return { minLng, maxLng, minLat, maxLat }
}

// distanceToRing——點到輪廓各線段的最短距離(度,經度乘 cos 43° 的平面近似)。
export function distanceToRing(lng: number, lat: number, ring: LandRing): number {
  const px = lng * COS_LAT
  let best = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0] * COS_LAT
    const ay = ring[j][1]
    const bx = ring[i][0] * COS_LAT
    const by = ring[i][1]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (lat - ay) * dy) / len2)) : 0
    const ex = ax + dx * t - px
    const ey = ay + dy * t - lat
    const d2 = ex * ex + ey * ey
    if (d2 < best) best = d2
  }
  return Math.sqrt(best)
}

export const HOKKAIDO_RING: LandRing = (() => {
  const ring = pickRingContaining(JAPAN_LAND, SAPPORO.lng, SAPPORO.lat)
  if (!ring) throw new Error('JAPAN_LAND 找不到包含札幌的環')
  return thinRing(ring, RING_MAX_POINTS)
})()

export interface SnowPatch {
  lat: number
  lng: number
  rx: number // 畫布單位
  ry: number
  alpha: number // 各自的不透明度,疊出斑駁
  inland: number // 內陸程度 0..1(1=最內陸)
  threshold: number // cover 超過這個值才開始長出來
}

// createSnowPatches——在輪廓 bbox 均勻取樣、落在環內才收;門檻依內陸程度
// (離海岸距離 + 靠近大雪山)加一點雜訊,所以積雪從內陸山區一塊一塊長向海岸。
export function createSnowPatches(ring: LandRing, count: number, seed: number): SnowPatch[] {
  const radius = PATCH_RADIUS
  const rng = mulberry32(seed)
  const { minLng, maxLng, minLat, maxLat } = ringBbox(ring)
  const raw: Array<Omit<SnowPatch, 'inland' | 'threshold'> & { coast: number; center: number; noise: number }> = []
  let guard = 0
  while (raw.length < count && guard++ < count * 400) {
    const lng = minLng + rng() * (maxLng - minLng)
    const lat = minLat + rng() * (maxLat - minLat)
    if (!pointInRing(lng, lat, ring)) continue
    const rx = radius[0] + rng() * (radius[1] - radius[0])
    raw.push({
      lat, lng, rx,
      ry: rx * (PATCH_FLATTEN[0] + rng() * (PATCH_FLATTEN[1] - PATCH_FLATTEN[0])),
      alpha: PATCH_ALPHA[0] + rng() * (PATCH_ALPHA[1] - PATCH_ALPHA[0]),
      coast: distanceToRing(lng, lat, ring),
      center: Math.hypot((lng - DAISETSUZAN.lng) * COS_LAT, lat - DAISETSUZAN.lat),
      noise: (rng() - 0.5) * 2 * PATCH_THRESHOLD_NOISE,
    })
  }
  const maxCoast = Math.max(1e-9, ...raw.map((p) => p.coast))
  const maxCenter = Math.max(1e-9, ...raw.map((p) => p.center))
  return raw.map(({ coast, center, noise, ...p }) => {
    const inland = PATCH_COAST_WEIGHT * (coast / maxCoast) + (1 - PATCH_COAST_WEIGHT) * (1 - center / maxCenter)
    return { ...p, inland, threshold: Math.max(0, (1 - inland) * PATCH_THRESHOLD_SCALE + noise) }
  })
}

// patchGrowth——斑塊目前長到幾成(0..1),門檻到門檻+PATCH_RAMP 之間 smoothstep。
export function patchGrowth(cover: number, threshold: number): number {
  const p = Math.max(0, Math.min(1, (cover - threshold) / PATCH_RAMP))
  return p * p * (3 - 2 * p)
}

export const HOKKAIDO_PATCHES: SnowPatch[] = createSnowPatches(HOKKAIDO_RING, PATCH_COUNT, PATCH_SEED)
