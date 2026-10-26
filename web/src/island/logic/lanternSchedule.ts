// lanternSchedule.ts——燈籠「一盞一盞亮起」的排程(純函式)。
//
// 全域亮度 globalGlow(0..1,來自光照關鍵幀的 lanternGlow)只告訴我們「整體多亮」。
// 這裡把它拆成每盞燈各自的亮度:每盞燈有一個沿步道的位置 u(0=起點基山街,1=終點阿妹茶樓),
// globalGlow 升起時,u 小的燈先亮,像一波光沿著步道往上爬;每盞再加一點隨機前後(jitter),
// 避免整齊得像跑馬燈。
//
//   glow_i = smoothstep(0, ramp, g × (1 + spread) − u_i × spread − jitter_i)
//
// 性質(有測試):g=0 全暗、g=1 全亮;g 遞增時每盞單調不減;u 小的先亮;結果都在 [0, 1];同 seed 同結果。
// 條件:jitter ∈ [0, jitterMax],且 ramp + jitterMax ≤ 1,g=1 時才保證每盞都到 1。
import type { Pt } from '../data/layoutTypes'
import type { PathCurve } from './pathCurve'
import { mulberry32 } from './rng'

export type LanternOpts = { spread: number; ramp: number }
export const DEFAULT_LANTERN_OPTS: LanternOpts = { spread: 0.9, ramp: 0.3 }
export const LANTERN_JITTER_MAX = 0.12

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

// lanternOrder——每盞燈投影到步道的相對位置 u(0..1)。
export function lanternOrder(lanterns: ReadonlyArray<Pt>, curve: PathCurve): number[] {
  return lanterns.map(([x, z]) => (curve.length === 0 ? 0 : curve.nearestArc(x, z) / curve.length))
}

export function lanternJitter(n: number, seed: number): number[] {
  const r = mulberry32(seed)
  return Array.from({ length: n }, () => r() * LANTERN_JITTER_MAX)
}

export function lanternGlowAt(
  globalGlow: number,
  order: ReadonlyArray<number>,
  jitter: ReadonlyArray<number>,
  opts: LanternOpts = DEFAULT_LANTERN_OPTS,
): Float32Array {
  const g = Math.max(0, Math.min(1, globalGlow))
  const out = new Float32Array(order.length)
  for (let i = 0; i < order.length; i++) {
    out[i] = smoothstep(0, opts.ramp, g * (1 + opts.spread) - order[i] * opts.spread - (jitter[i] ?? 0))
  }
  return out
}
