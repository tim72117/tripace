// snowfall.ts——北海道降雪的純邏輯(沒有 DOM、沒有 canvas):降雪強度/積雪量
// 的狀態機,以及雪片粒子的生成、每幀更新、出界回收。粒子座標是楓葉 canvas
// 的本地座標(div px − origin,與 momijiRenderer 的 toScreen 同一座標系),
// 活動範圍 SnowBox 是「北海道輪廓投影後的 bbox ∩ 畫布」,由渲染層每幀給。
// 北海道輪廓與積雪斑塊在 hokkaidoSnow.ts,繪製在 momijiRenderer.ts。

import { mulberry32 } from './momijiFrontModel'

// ===== 狀態機可調參數 =====
export const INTENSITY_ON_SEC = 1.5 // 開啟後幾秒降雪漸強到 1
export const INTENSITY_OFF_SEC = 1 // 關閉後幾秒漸弱到 0
export const COVER_INIT = 0.3 // 頁面載入就有的積雪量
export const COVER_MAX = 0.7 // 上限壓低:最大積雪時也只是零星,海岸一圈裸露
export const COVER_ACCUM_SEC = 25 // 從 COVER_INIT 累積到 COVER_MAX 的秒數
export const COVER_MELT_SEC = 3 // 關閉後從 COVER_MAX 融到 0 的秒數

// ===== 雪片可調參數 =====
// 密度:活動範圍每平方 CSS 像素幾片,上限 FLAKE_MAX。
export const FLAKE_DENSITY_PER_PX2 = 1 / 900
export const FLAKE_MIN = 60 // 預設縮放(北海道約 140px 寬)也要有足夠的雪量
export const FLAKE_MAX = 260
// 以下 [遠, 近] 依深度線性內插。
export const FLAKE_RADIUS_PX: readonly [number, number] = [1, 2.5]
export const FLAKE_FALL_SPEED_PX_S: readonly [number, number] = [22, 70]
export const FLAKE_ALPHA: readonly [number, number] = [0.5, 0.95]
export const FLAKE_SWAY_AMP_PX: readonly [number, number] = [5, 14]
// 拖尾:沿速度反方向畫一小段細線,長度 = 速度 × 秒數(近景較快所以較長)。
export const FLAKE_TRAIL_SEC = 0.12
export const FLAKE_SWAY_FREQ_RAD_S: readonly [number, number] = [0.6, 1.4]
// 整體風向:往右的水平漂移(px/s,近的吃到較多),再疊一個慢速起伏。
export const FLAKE_WIND_PX_S = 9
export const FLAKE_WIND_GUST_PERIOD_S = 11
// 超出活動範圍多遠才回收(要大於最大擺幅)。
export const FLAKE_EDGE_MARGIN_PX = 16
// 繪製分 3 個深度組(遠/中/近),每組一個 path 一次 fill;各組的線寬與 alpha 取組內中點。
export const FLAKE_BUCKETS = 3

export const FLAKE_SEED = 20261022

// 積雪快取:cover 每 COVER_CACHE_STEP 一階才重建離屏圖;錨點像素四捨五入到 0.5px。
export const COVER_CACHE_STEP = 0.03
export const SIG_PX_STEP = 0.5

// ===== 狀態機 =====

export interface SnowState {
  intensity: number // 降雪強度 0..1
  cover: number // 積雪量 0..1
}

export function createSnowState(): SnowState {
  return { intensity: 0, cover: COVER_INIT }
}

// stepSnowState——就地推進(每幀不配置物件)。開:強度漸強、積雪慢慢累積;
// 關:強度漸弱、積雪融化。
export function stepSnowState(s: SnowState, dtSec: number, on: boolean): void {
  if (on) {
    s.intensity = Math.min(1, s.intensity + dtSec / INTENSITY_ON_SEC)
    s.cover = Math.min(COVER_MAX, s.cover + (dtSec * (COVER_MAX - COVER_INIT)) / COVER_ACCUM_SEC)
  } else {
    s.intensity = Math.max(0, s.intensity - dtSec / INTENSITY_OFF_SEC)
    s.cover = Math.max(0, s.cover - (dtSec * COVER_MAX) / COVER_MELT_SEC)
  }
}

// ===== 雪片 =====

// 每片雪在 Float32Array 裡的欄位(stride = FLAKE_STRIDE)。
export const F_X = 0 // 基準 x(不含擺動)
export const F_Y = 1
export const F_DEPTH = 2
export const F_RADIUS = 3
export const F_SPEED = 4
export const F_ALPHA = 5
export const F_PHASE = 6
export const F_SWAY_AMP = 7
export const F_SWAY_FREQ = 8
export const FLAKE_STRIDE = 9

export interface SnowBox { x0: number; y0: number; x1: number; y1: number }

export interface SnowFlakes {
  data: Float32Array // 預先配置 FLAKE_MAX 片
  count: number // 目前活動的片數(依活動範圍面積)
  rng: () => number
}

const lerp = (range: readonly [number, number], t: number) => range[0] + (range[1] - range[0]) * t

export function createSnowFlakes(seed = FLAKE_SEED): SnowFlakes {
  return { data: new Float32Array(FLAKE_MAX * FLAKE_STRIDE), count: 0, rng: mulberry32(seed) }
}

// flakeCount——依活動範圍面積決定片數,夾在 [FLAKE_MIN, FLAKE_MAX];範圍無效時 0。
export function flakeCount(box: SnowBox): number {
  const area = (box.x1 - box.x0) * (box.y1 - box.y0)
  if (!(area > 0)) return 0
  return Math.max(FLAKE_MIN, Math.min(FLAKE_MAX, Math.round(area * FLAKE_DENSITY_PER_PX2)))
}

// spawnFlake——第 i 片重新生成在活動範圍內;fromTop=true 放上緣外(回收再用),
// 否則隨機散在整個範圍(新增片數時,避免上方一片、下方全空)。
export function spawnFlake(flakes: SnowFlakes, i: number, box: SnowBox, fromTop: boolean): void {
  const { data, rng } = flakes
  const o = i * FLAKE_STRIDE
  const depth = rng()
  const radius = lerp(FLAKE_RADIUS_PX, depth)
  data[o + F_X] = box.x0 + rng() * (box.x1 - box.x0)
  data[o + F_Y] = fromTop ? box.y0 - radius * 2 - rng() * 30 : box.y0 + rng() * (box.y1 - box.y0)
  data[o + F_DEPTH] = depth
  data[o + F_RADIUS] = radius
  data[o + F_SPEED] = lerp(FLAKE_FALL_SPEED_PX_S, depth) * (0.85 + rng() * 0.3)
  data[o + F_ALPHA] = lerp(FLAKE_ALPHA, depth)
  data[o + F_PHASE] = rng() * Math.PI * 2
  data[o + F_SWAY_AMP] = lerp(FLAKE_SWAY_AMP_PX, depth) * (0.7 + rng() * 0.6)
  data[o + F_SWAY_FREQ] = lerp(FLAKE_SWAY_FREQ_RAD_S, depth) * (0.8 + rng() * 0.4)
}

// syncFlakeCount——活動範圍改變(平移/縮放)時調整片數:變多就補生成新片,
// 變少只縮 count,不配置新陣列。
export function syncFlakeCount(flakes: SnowFlakes, box: SnowBox): void {
  const next = flakeCount(box)
  for (let i = flakes.count; i < next; i++) spawnFlake(flakes, i, box, false)
  flakes.count = next
}

// shiftFlakes——canvas 重新定位(origin 改變)時整批平移,留在原本的螢幕位置。
export function shiftFlakes(flakes: SnowFlakes, dx: number, dy: number): void {
  const { data, count } = flakes
  for (let i = 0; i < count; i++) {
    data[i * FLAKE_STRIDE + F_X] -= dx
    data[i * FLAKE_STRIDE + F_Y] -= dy
  }
}

// windAt——當下的整體風速(px/s,正=往右),慢速起伏讓漂移不是定速。
export function windAt(timeSec: number): number {
  return FLAKE_WIND_PX_S * (0.55 + 0.45 * Math.sin((timeSec * Math.PI * 2) / FLAKE_WIND_GUST_PERIOD_S))
}

// stepFlakes——推進一幀:下落、風漂移(近的吃到較多)、出界回收。左右越界繞到
// 另一側,掉出下緣或離開範圍(縮放後 bbox 變了)就回到上緣重生。
export function stepFlakes(flakes: SnowFlakes, dtSec: number, timeSec: number, box: SnowBox): void {
  const { data, count } = flakes
  const wind = windAt(timeSec)
  const m = FLAKE_EDGE_MARGIN_PX
  const span = box.x1 - box.x0 + m * 2
  for (let i = 0; i < count; i++) {
    const o = i * FLAKE_STRIDE
    const depth = data[o + F_DEPTH]
    const y = (data[o + F_Y] += data[o + F_SPEED] * dtSec)
    let x = data[o + F_X] + wind * (0.4 + 0.6 * depth) * dtSec
    if (x > box.x1 + m) x -= span
    else if (x < box.x0 - m) x += span
    data[o + F_X] = x
    if (y > box.y1 + m || y < box.y0 - m * 4) spawnFlake(flakes, i, box, true)
  }
}

// flakeBucket——深度分組索引 0..FLAKE_BUCKETS-1(0=最遠)。
export function flakeBucket(depth: number): number {
  return Math.min(FLAKE_BUCKETS - 1, Math.floor(depth * FLAKE_BUCKETS))
}
// bucketMidDepth——該組的中點深度,算該組共用的線寬/alpha 用。
export function bucketMidDepth(b: number): number {
  return (b + 0.5) / FLAKE_BUCKETS
}
export function lerpRange(range: readonly [number, number], t: number): number {
  return lerp(range, t)
}

// pointInPolyPx——射線法:(x, y) 是否在投影後的輪廓(px 陣列 [x0,y0,x1,y1,...],n 個點)內。
// 取代 ctx.clip:雪片逐片判斷,只畫在北海道陸地上的。
export function pointInPolyPx(px: Float32Array, n: number, x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = px[i * 2]
    const yi = px[i * 2 + 1]
    const xj = px[j * 2]
    const yj = px[j * 2 + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// ===== 積雪離屏快取簽名 =====
// 兩個錨點的投影像素(涵蓋 origin/zoom/pan)、cover 量化值、深淺色、畫布尺寸、dpr
// 任一改變才重建;cover 增長緩慢,量化後多數幀都命中快取。
export interface SnowCacheSig {
  ax: number; ay: number; bx: number; by: number
  coverQ: number
  dark: boolean
  width: number; height: number; dpr: number
}

export function quantizeCover(cover: number): number {
  return Math.round(cover / COVER_CACHE_STEP)
}
export function quantizePx(v: number): number {
  return Math.round(v / SIG_PX_STEP) * SIG_PX_STEP
}

// setSnowCacheSig——就地寫入(每幀不配置);回傳是否與原值不同(需重建)。
export function setSnowCacheSig(
  sig: SnowCacheSig, ax: number, ay: number, bx: number, by: number, cover: number, dark: boolean,
  width: number, height: number, dpr: number,
): boolean {
  const qax = quantizePx(ax)
  const qay = quantizePx(ay)
  const qbx = quantizePx(bx)
  const qby = quantizePx(by)
  const coverQ = quantizeCover(cover)
  const changed = sig.ax !== qax || sig.ay !== qay || sig.bx !== qbx || sig.by !== qby || sig.coverQ !== coverQ ||
    sig.dark !== dark || sig.width !== width || sig.height !== height || sig.dpr !== dpr
  if (changed) {
    sig.ax = qax; sig.ay = qay; sig.bx = qbx; sig.by = qby
    sig.coverQ = coverQ; sig.dark = dark; sig.width = width; sig.height = height; sig.dpr = dpr
  }
  return changed
}

// flakeDrawX——畫面上的 x:基準 x 加上各自相位的正弦擺動。
export function flakeDrawX(data: Float32Array, i: number, timeSec: number): number {
  const o = i * FLAKE_STRIDE
  return data[o + F_X] + Math.sin(timeSec * data[o + F_SWAY_FREQ] + data[o + F_PHASE]) * data[o + F_SWAY_AMP]
}
