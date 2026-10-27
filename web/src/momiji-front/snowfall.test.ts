import { describe, expect, it } from 'vitest'
import {
  COVER_CACHE_STEP, COVER_INIT, COVER_MAX, F_ALPHA, F_DEPTH, F_RADIUS, F_SPEED, F_SWAY_AMP, F_X, F_Y, FLAKE_ALPHA,
  FLAKE_BUCKETS, FLAKE_EDGE_MARGIN_PX, FLAKE_FALL_SPEED_PX_S, FLAKE_MAX, FLAKE_MIN, FLAKE_RADIUS_PX, FLAKE_STRIDE,
  FLAKE_WIND_PX_S, INTENSITY_OFF_SEC, INTENSITY_ON_SEC, COVER_ACCUM_SEC, COVER_MELT_SEC, bucketMidDepth, createSnowFlakes,
  createSnowState, flakeBucket, flakeCount, flakeDrawX, lerpRange, pointInPolyPx, quantizeCover, quantizePx, setSnowCacheSig,
  shiftFlakes, stepFlakes, stepSnowState, syncFlakeCount, windAt, type SnowBox, type SnowCacheSig,
} from './snowfall'

const BOX: SnowBox = { x0: 100, y0: 50, x1: 500, y1: 350 }

describe('狀態機', () => {
  it('載入就有初始積雪、沒有降雪', () => {
    expect(createSnowState()).toEqual({ intensity: 0, cover: COVER_INIT })
  })
  it('開啟:強度約 INTENSITY_ON_SEC 秒到 1,積雪約 COVER_ACCUM_SEC 秒到上限', () => {
    const s = createSnowState()
    stepSnowState(s, INTENSITY_ON_SEC / 2, true)
    expect(s.intensity).toBeCloseTo(0.5)
    expect(s.cover).toBeGreaterThan(COVER_INIT)
    expect(s.cover).toBeLessThan(COVER_MAX)
    for (let i = 0; i < 100; i++) stepSnowState(s, COVER_ACCUM_SEC / 50, true)
    expect(s.intensity).toBe(1)
    expect(s.cover).toBe(COVER_MAX)
  })
  it('關閉:強度約 INTENSITY_OFF_SEC 秒到 0,積雪約 COVER_MELT_SEC 秒融光', () => {
    const s = { intensity: 1, cover: COVER_MAX }
    stepSnowState(s, INTENSITY_OFF_SEC / 2, false)
    expect(s.intensity).toBeCloseTo(0.5)
    expect(s.cover).toBeCloseTo(COVER_MAX * (1 - INTENSITY_OFF_SEC / 2 / COVER_MELT_SEC))
    stepSnowState(s, COVER_MELT_SEC, false)
    expect(s).toEqual({ intensity: 0, cover: 0 })
  })
})

describe('繪製輔助', () => {
  it('深度分組:0..1 均分成 FLAKE_BUCKETS 組,中點深度在組內', () => {
    expect(flakeBucket(0)).toBe(0)
    expect(flakeBucket(0.999)).toBe(FLAKE_BUCKETS - 1)
    expect(flakeBucket(1)).toBe(FLAKE_BUCKETS - 1)
    for (let b = 0; b < FLAKE_BUCKETS; b++) expect(flakeBucket(bucketMidDepth(b))).toBe(b)
    expect(lerpRange([2, 4], 0.5)).toBe(3)
  })
  it('pointInPolyPx:投影後輪廓的點在多邊形判斷', () => {
    const sq = new Float32Array([0, 0, 10, 0, 10, 10, 0, 10])
    expect(pointInPolyPx(sq, 4, 5, 5)).toBe(true)
    expect(pointInPolyPx(sq, 4, 11, 5)).toBe(false)
    expect(pointInPolyPx(sq, 4, -1, 5)).toBe(false)
    // 凹多邊形(L 形)的缺口在外
    const L = new Float32Array([0, 0, 10, 0, 10, 4, 4, 4, 4, 10, 0, 10])
    expect(pointInPolyPx(L, 6, 2, 8)).toBe(true)
    expect(pointInPolyPx(L, 6, 8, 8)).toBe(false)
  })
  it('積雪快取簽名:錨點量化到 0.5px、cover 量化、深淺色與畫布尺寸改變才算不同', () => {
    const sig: SnowCacheSig = { ax: NaN, ay: NaN, bx: NaN, by: NaN, coverQ: -1, dark: false, width: 0, height: 0, dpr: 0 }
    expect(setSnowCacheSig(sig, 10.2, 20.3, 30.4, 40.6, 0.5, false, 800, 600, 1.5)).toBe(true)
    expect(sig).toMatchObject({ ax: 10, ay: 20.5, bx: 30.5, by: 40.5, coverQ: quantizeCover(0.5), dark: false })
    // 同一階內的小變動不重建
    expect(setSnowCacheSig(sig, 10.1, 20.4, 30.3, 40.7, 0.5 + COVER_CACHE_STEP * 0.3, false, 800, 600, 1.5)).toBe(false)
    expect(setSnowCacheSig(sig, 10.1, 20.4, 30.3, 40.7, 0.5 + COVER_CACHE_STEP * 1.2, false, 800, 600, 1.5)).toBe(true)
    expect(setSnowCacheSig(sig, 10.1, 20.4, 30.3, 40.7, 0.5 + COVER_CACHE_STEP * 1.2, true, 800, 600, 1.5)).toBe(true)
    expect(setSnowCacheSig(sig, 10.1, 20.4, 30.3, 40.7, 0.5 + COVER_CACHE_STEP * 1.2, true, 900, 600, 1.5)).toBe(true)
    expect(setSnowCacheSig(sig, 12, 20.4, 30.3, 40.7, 0.5 + COVER_CACHE_STEP * 1.2, true, 900, 600, 1.5)).toBe(true)
    expect(quantizePx(0.26)).toBe(0.5)
    expect(quantizePx(0.24)).toBe(0)
  })
})

describe('片數', () => {
  it('依活動範圍面積縮放、上限 FLAKE_MAX、無效範圍為 0', () => {
    expect(flakeCount({ x0: 0, y0: 0, x1: 0, y1: 100 })).toBe(0)
    expect(flakeCount({ x0: 10, y0: 10, x1: 5, y1: 100 })).toBe(0)
    expect(flakeCount({ x0: 0, y0: 0, x1: 2000, y1: 2000 })).toBe(FLAKE_MAX)
    expect(flakeCount({ x0: 0, y0: 0, x1: 20, y1: 20 })).toBe(FLAKE_MIN)
    const mid = flakeCount(BOX)
    expect(mid).toBeGreaterThan(FLAKE_MIN)
    expect(mid).toBeLessThan(FLAKE_MAX)
  })
  it('範圍改變時調整片數,陣列預先配置不重建', () => {
    const f = createSnowFlakes()
    const data = f.data
    expect(data.length).toBe(FLAKE_MAX * FLAKE_STRIDE)
    syncFlakeCount(f, BOX)
    expect(f.count).toBe(flakeCount(BOX))
    syncFlakeCount(f, { x0: 0, y0: 0, x1: 2000, y1: 2000 })
    expect(f.count).toBe(FLAKE_MAX)
    syncFlakeCount(f, BOX)
    expect(f.count).toBe(flakeCount(BOX))
    expect(f.data).toBe(data)
  })
})

describe('生成', () => {
  const f = createSnowFlakes()
  syncFlakeCount(f, BOX)
  it('初始散在活動範圍內,同 seed 結果一致', () => {
    for (let i = 0; i < f.count; i++) {
      const o = i * FLAKE_STRIDE
      expect(f.data[o + F_X]).toBeGreaterThanOrEqual(BOX.x0)
      expect(f.data[o + F_X]).toBeLessThanOrEqual(BOX.x1)
      expect(f.data[o + F_Y]).toBeGreaterThanOrEqual(BOX.y0)
      expect(f.data[o + F_Y]).toBeLessThanOrEqual(BOX.y1)
    }
    const g = createSnowFlakes()
    syncFlakeCount(g, BOX)
    expect(g.data).toEqual(f.data)
  })
  it('景深:近的較大、較快、較不透明,各欄位在設定範圍內', () => {
    const d = f.data
    let near = 0
    let far = 0
    for (let i = 0; i < f.count; i++) {
      const o = i * FLAKE_STRIDE
      if (d[o + F_DEPTH] > d[near * FLAKE_STRIDE + F_DEPTH]) near = i
      if (d[o + F_DEPTH] < d[far * FLAKE_STRIDE + F_DEPTH]) far = i
      expect(d[o + F_RADIUS]).toBeGreaterThanOrEqual(FLAKE_RADIUS_PX[0])
      expect(d[o + F_RADIUS]).toBeLessThanOrEqual(FLAKE_RADIUS_PX[1])
      expect(d[o + F_ALPHA]).toBeGreaterThanOrEqual(FLAKE_ALPHA[0])
      expect(d[o + F_ALPHA]).toBeLessThanOrEqual(FLAKE_ALPHA[1])
      expect(d[o + F_SPEED]).toBeGreaterThanOrEqual(FLAKE_FALL_SPEED_PX_S[0] * 0.85)
      expect(d[o + F_SPEED]).toBeLessThanOrEqual(FLAKE_FALL_SPEED_PX_S[1] * 1.15)
    }
    const n = near * FLAKE_STRIDE
    const fa = far * FLAKE_STRIDE
    expect(d[n + F_RADIUS]).toBeGreaterThan(d[fa + F_RADIUS])
    expect(d[n + F_SPEED]).toBeGreaterThan(d[fa + F_SPEED])
    expect(d[n + F_ALPHA]).toBeGreaterThan(d[fa + F_ALPHA])
  })
})

describe('每幀更新', () => {
  it('往下掉,且不配置新陣列', () => {
    const f = createSnowFlakes()
    syncFlakeCount(f, BOX)
    const before = Array.from(f.data)
    const data = f.data
    stepFlakes(f, 0.01, 0, BOX)
    expect(f.data).toBe(data)
    for (let i = 0; i < f.count; i++) {
      expect(f.data[i * FLAKE_STRIDE + F_Y]).toBeGreaterThan(before[i * FLAKE_STRIDE + F_Y])
    }
  })
  it('掉出下緣後回到上緣重生,x 仍在範圍內', () => {
    const f = createSnowFlakes()
    syncFlakeCount(f, BOX)
    f.data[F_Y] = BOX.y1 - 1
    f.data[F_SPEED] = 1000
    stepFlakes(f, 0.1, 0, BOX)
    expect(f.data[F_Y]).toBeLessThan(BOX.y0)
    expect(f.data[F_X]).toBeGreaterThanOrEqual(BOX.x0)
    expect(f.data[F_X]).toBeLessThanOrEqual(BOX.x1)
  })
  it('縮放後範圍改變、雪片遠在範圍上方時回收重生', () => {
    const f = createSnowFlakes()
    syncFlakeCount(f, BOX)
    f.data[F_Y] = BOX.y0 - FLAKE_EDGE_MARGIN_PX * 10
    stepFlakes(f, 0.01, 0, BOX)
    expect(f.data[F_Y]).toBeGreaterThanOrEqual(BOX.y0 - 2 * FLAKE_RADIUS_PX[1] - 30)
    expect(f.data[F_Y]).toBeLessThan(BOX.y0)
  })
  it('風往右漂,越過右側邊界時繞回左側', () => {
    const f = createSnowFlakes()
    syncFlakeCount(f, BOX)
    f.data[F_X] = BOX.x1 + FLAKE_EDGE_MARGIN_PX - 0.01
    f.data[F_SPEED] = 0
    stepFlakes(f, 1, 0, BOX)
    expect(f.data[F_X]).toBeLessThan(BOX.x0)
    expect(f.data[F_X]).toBeGreaterThanOrEqual(BOX.x0 - FLAKE_EDGE_MARGIN_PX)
  })
  it('canvas 重新定位時整批平移', () => {
    const f = createSnowFlakes()
    syncFlakeCount(f, BOX)
    const x = f.data[F_X]
    const y = f.data[F_Y]
    shiftFlakes(f, 10, -5)
    expect(f.data[F_X]).toBeCloseTo(x - 10)
    expect(f.data[F_Y]).toBeCloseTo(y + 5)
  })
  it('整體風速有起伏但不反向、不超過設定值', () => {
    let min = Infinity
    let max = -Infinity
    for (let t = 0; t < 30; t += 0.25) {
      const w = windAt(t)
      min = Math.min(min, w)
      max = Math.max(max, w)
    }
    expect(min).toBeGreaterThan(0)
    expect(max).toBeLessThanOrEqual(FLAKE_WIND_PX_S)
    expect(max - min).toBeGreaterThan(FLAKE_WIND_PX_S * 0.5)
  })
  it('左右擺動在各自擺幅內,且不是直線下落', () => {
    const f = createSnowFlakes()
    syncFlakeCount(f, BOX)
    const base = f.data[F_X]
    const amp = f.data[F_SWAY_AMP]
    const xs = new Set<number>()
    for (let t = 0; t < 10; t += 0.5) {
      const x = flakeDrawX(f.data, 0, t)
      expect(Math.abs(x - base)).toBeLessThanOrEqual(amp + 1e-6)
      xs.add(Math.round(x * 100))
    }
    expect(xs.size).toBeGreaterThan(1)
  })
})
