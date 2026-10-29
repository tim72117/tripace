import { describe, expect, it } from 'vitest'
import { initGovernor, stepGovernor, type GovernorCfg } from './governor'
import { quantizeHalf, shadowHalfSize, snapToTexel } from './shadowFrame'
import { DEFAULT_STREAMING, lodFor, nextCellState, type StreamingConfig } from './streaming'

const grid = { cellSize: 32 }

describe('streaming', () => {
  const cfg: StreamingConfig = { loadRadius: 50, unloadRadius: 70, lodDistances: [40, 100], lodHysteresis: 5, hlodDistance: 150 }
  it('預設設定:全部載入、最細、不用替身', () => {
    expect(nextCellState(grid, { ix: 9, iz: 9 }, 0, 0, undefined, DEFAULT_STREAMING)).toEqual({ loaded: true, lod: 0, hlod: false })
  })
  it('載入/卸載有緩衝區:50 內載入,已載入的要超過 70 才卸載', () => {
    const c = { ix: 2, iz: 0 } // x 64~96
    expect(nextCellState(grid, c, 0, 16, undefined, cfg).loaded).toBe(false) // 距離 64
    expect(nextCellState(grid, c, 20, 16, undefined, cfg).loaded).toBe(true) // 距離 44
    expect(nextCellState(grid, c, 0, 16, { loaded: true, lod: 0, hlod: false }, cfg).loaded).toBe(true) // 64 ≤ 70
    expect(nextCellState(grid, c, -10, 16, { loaded: true, lod: 0, hlod: false }, cfg).loaded).toBe(false) // 74
  })
  it('LOD 門檻有緩衝,不會在邊界來回切', () => {
    expect(lodFor(30, 0, cfg)).toBe(0)
    expect(lodFor(42, 0, cfg)).toBe(0) // 剛過 40,還在緩衝內
    expect(lodFor(46, 0, cfg)).toBe(1)
    expect(lodFor(38, 1, cfg)).toBe(1) // 剛回到 40 以內,還在緩衝內
    expect(lodFor(30, 1, cfg)).toBe(0)
    expect(lodFor(120, 1, cfg)).toBe(2)
  })
})

describe('shadowFrame', () => {
  const cfg = { mapSize: 2048, minHalf: 24, maxHalf: 75, distanceFactor: 0.6 }
  it('半寬隨鏡頭距離縮放並夾住上下限;量化後只會變大一點、不超過上限', () => {
    expect(shadowHalfSize(10, cfg)).toBe(24)
    expect(shadowHalfSize(100, cfg)).toBe(60)
    expect(shadowHalfSize(1000, cfg)).toBe(75)
    const q = quantizeHalf(61, cfg)
    expect(q).toBeGreaterThanOrEqual(61)
    expect(q).toBeLessThanOrEqual(75)
  })
  it('中心對齊到一個陰影像素寬', () => {
    const half = 51.2, texel = (half * 2) / 2048
    const [u, v] = snapToTexel(10.013, -3.02, half, 2048)
    expect(Math.abs(u / texel - Math.round(u / texel))).toBeLessThan(1e-9)
    expect(Math.abs(v / texel - Math.round(v / texel))).toBeLessThan(1e-9)
  })
})

describe('governor', () => {
  const cfg: GovernorCfg = { targetMs: 20, downRatio: 1.15, upRatio: 0.7, holdS: 1, cooldownS: 2, levels: 3 }
  const run = (s: ReturnType<typeof initGovernor>, dtS: number, seconds: number) => {
    for (let t = 0; t < seconds; t += dtS) s = stepGovernor(s, dtS, cfg)
    return s
  }
  it('持續太慢降一級,之後冷卻期間不再動', () => {
    const s = run(initGovernor(2), 0.04, 1.5) // 25 fps
    expect(s.level).toBe(1)
    expect(run(s, 0.04, 1).level).toBe(1) // 冷卻中
  })
  it('單幀卡頓不會降級;持續有餘裕才升級', () => {
    let s = initGovernor(1)
    s = run(s, 1 / 60, 1)
    s = stepGovernor(s, 0.2, cfg) // 一次 200 ms 卡頓
    s = run(s, 1 / 60, 0.5)
    expect(s.level).toBe(1)
    expect(run(s, 1 / 120, 3).level).toBe(2)
  })
})
