import { describe, expect, it } from 'vitest'
import { fbmAt } from './heightfield'
import { MAX_SHADE_GRID_CELLS, sampledHeight, surfaceMetrics, surfaceWeights } from './terrainShade'

describe('surfaceMetrics', () => {
  it('平面:坡度 0、曲率 0', () => {
    const m = surfaceMetrics(() => 3, 5, 5, 1)
    expect(m.grade).toBeCloseTo(0, 6)
    expect(m.concavity).toBeCloseTo(0, 6)
  })
  it('斜面:坡度 = 斜率,曲率 0', () => {
    const m = surfaceMetrics((x) => 0.5 * x, 2, 2, 1)
    expect(m.grade).toBeCloseTo(0.5, 6)
    expect(m.concavity).toBeCloseTo(0, 6)
  })
  it('碗(谷)曲率為正、丘(山頂)為負', () => {
    expect(surfaceMetrics((x, z) => 0.1 * (x * x + z * z), 0, 0, 1).concavity).toBeCloseTo(0.4, 6)
    expect(surfaceMetrics((x, z) => -0.1 * (x * x + z * z), 0, 0, 1).concavity).toBeCloseTo(-0.4, 6)
  })
})

describe('sampledHeight', () => {
  it('格點上等於原函式,線性函式在任意位置都精確', () => {
    const f = (x: number, z: number) => 2 * x - 0.5 * z + 3
    const g = sampledHeight(f, -10, 10, -10, 10, 1.2)
    expect(g(0, 0)).toBeCloseTo(f(0, 0), 4)
    expect(g(3.7, -4.2)).toBeCloseTo(f(3.7, -4.2), 3)
  })
  it('範圍外夾在邊界(不會丟錯或給 NaN)', () => {
    const g = sampledHeight((x) => x, 0, 10, 0, 10, 1)
    expect(Number.isFinite(g(-50, 99))).toBe(true)
  })
  it('用格網算出的坡度與曲率,與直接用原函式相近', () => {
    const f = (x: number, z: number) => 0.05 * (x * x + z * z) + 0.3 * x
    const g = sampledHeight(f, -20, 20, -20, 20, 1.2, 3)
    const a = surfaceMetrics(f, 4.3, -2.1, 1.2), b = surfaceMetrics(g, 4.3, -2.1, 1.2)
    expect(b.grade).toBeCloseTo(a.grade, 1)
    expect(b.concavity).toBeCloseTo(a.concavity, 1)
  })
})

describe('surfaceWeights', () => {
  const flat = { grade: 0.05, concavity: 0 }
  it('平地沒有岩石、泥土、乾草,ao = 1', () => {
    expect(surfaceWeights(flat, 0)).toEqual({ rock: 0, dirt: 0, dry: 0, ao: 1 })
  })
  it('坡度越陡岩石越多(單調),很陡時全岩', () => {
    const r = [0.6, 0.9, 1.1, 1.4].map((g) => surfaceWeights({ grade: g, concavity: 0 }, 0).rock)
    for (let i = 1; i < r.length; i++) expect(r[i]).toBeGreaterThanOrEqual(r[i - 1])
    expect(r[0]).toBe(0)
    expect(r[3]).toBe(1)
  })
  it('雜訊讓岩石邊界彎曲:同樣的坡度,雜訊為負的地方岩石更多', () => {
    const m = { grade: 0.95, concavity: 0 }
    expect(surfaceWeights(m, -1).rock).toBeGreaterThan(surfaceWeights(m, 1).rock)
  })
  it('溝壑:凹且偏陡,沒到岩石門檻也露出岩石', () => {
    expect(surfaceWeights({ grade: 0.7, concavity: 0.8 }, 0).rock).toBeGreaterThan(surfaceWeights({ grade: 0.7, concavity: 0 }, 0).rock)
  })
  it('坡腳積土只出現在凹且平緩處;乾草只出現在凸且平緩處', () => {
    expect(surfaceWeights({ grade: 0.2, concavity: 0.6 }, 0).dirt).toBeGreaterThan(0)
    expect(surfaceWeights({ grade: 0.2, concavity: -0.6 }, 0).dirt).toBe(0)
    expect(surfaceWeights({ grade: 0.2, concavity: -0.6 }, 0).dry).toBeGreaterThan(0)
    expect(surfaceWeights({ grade: 0.2, concavity: 0.6 }, 0).dry).toBe(0)
  })
  it('ao:凹處比凸處暗', () => {
    expect(surfaceWeights({ grade: 0.2, concavity: 1 }, 0).ao).toBeLessThan(surfaceWeights({ grade: 0.2, concavity: -1 }, 0).ao)
  })
  it('權重都在合理範圍', () => {
    for (const g of [0, 0.4, 0.9, 1.6]) for (const c of [-2, -0.5, 0, 0.5, 2]) for (const n of [-1, 0, 1]) {
      const w = surfaceWeights({ grade: g, concavity: c }, n)
      for (const v of [w.rock, w.dirt, w.dry]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
      expect(w.ao).toBeGreaterThan(0.7)
      expect(w.ao).toBeLessThan(1.1)
    }
  })
})

describe('fbmAt', () => {
  it('決定性、範圍在 [-1, 1]、不同位置不同值', () => {
    const vs = Array.from({ length: 200 }, (_, i) => fbmAt(i * 0.7, i * 1.3, 5, 6))
    for (const v of vs) { expect(Math.abs(v)).toBeLessThanOrEqual(1); }
    expect(fbmAt(3, 4, 5, 6)).toBe(fbmAt(3, 4, 5, 6))
    expect(new Set(vs.map((v) => v.toFixed(4))).size).toBeGreaterThan(100)
  })
})

describe('sampledHeight 的邊界', () => {
  it('參數無效(非有限數、step ≤ 0)丟出清楚的錯誤,不是算出 NaN 格網', () => {
    const f = () => 0
    expect(() => sampledHeight(f, Infinity, 10, 0, 10, 1)).toThrow(/參數無效/)
    expect(() => sampledHeight(f, 0, NaN, 0, 10, 1)).toThrow(/參數無效/)
    expect(() => sampledHeight(f, 0, 10, 0, 10, 0)).toThrow(/參數無效/)
    expect(() => sampledHeight(f, 0, 10, 0, 10, -1)).toThrow(/參數無效/)
  })
  it('格網有大小上限:大範圍配極小 step 時放寬取樣間距,取樣次數不超過上限,結果仍然連續有限', () => {
    let calls = 0
    const f = (x: number, z: number) => { calls++; return 0.01 * x + 0.02 * z }
    const g = sampledHeight(f, 0, 100000, 0, 100000, 0.01)
    expect(calls).toBeLessThanOrEqual(MAX_SHADE_GRID_CELLS * 1.1)
    expect(g(50000, 50000)).toBeCloseTo(f(50000, 50000), 0)
    expect(Number.isFinite(g(-1, 1e9))).toBe(true)
  })
})
