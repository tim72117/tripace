import { describe, expect, it } from 'vitest'
import type { IslandLayout, TerrainSpec } from '../data/layoutTypes'
import { baseFieldAt, bumpAt, heightFieldAt, noiseAt, padWeight, rampAt, ridgeAt } from './heightfield'
import { resolveScatter } from './scatterResolve'
import { heightAt } from './terrain'
import { validateLayout } from './validateLayout'

describe('rampAt', () => {
  it('沿方向線線性升高,兩端外夾住,橫向不影響', () => {
    const r = { from: [0, 0] as [number, number], to: [0, -10] as [number, number], y0: 0, y1: 10 }
    expect(rampAt(r, 5, 0)).toBe(0)
    expect(rampAt(r, 5, -5)).toBeCloseTo(5)
    expect(rampAt(r, -3, -10)).toBe(10)
    expect(rampAt(r, 0, -99)).toBe(10)
    expect(rampAt(r, 0, 99)).toBe(0)
  })
})

describe('bumpAt', () => {
  const b = { kind: 'bump' as const, x: 10, z: 0, rx: 5, rz: 5, height: 4 }
  it('中心 = height,邊緣與外面 = 0,中間單調下降', () => {
    expect(bumpAt(b, 10, 0)).toBeCloseTo(4)
    expect(bumpAt(b, 15, 0)).toBeCloseTo(0)
    expect(bumpAt(b, 40, 0)).toBe(0)
    expect(bumpAt(b, 11, 0)).toBeGreaterThan(bumpAt(b, 13, 0))
  })
  it('負高度是窪地;橢圓依 rot 旋轉', () => {
    expect(bumpAt({ ...b, height: -2 }, 10, 0)).toBeCloseTo(-2)
    const e = { kind: 'bump' as const, x: 0, z: 0, rx: 10, rz: 2, height: 1 }
    expect(bumpAt(e, 6, 0)).toBeGreaterThan(0)
    expect(bumpAt(e, 0, 6)).toBe(0)
    expect(bumpAt({ ...e, rot: Math.PI / 2 }, 0, 6)).toBeGreaterThan(0)
  })
})

describe('ridgeAt', () => {
  const r = { kind: 'ridge' as const, points: [[0, 0, 2], [10, 0, 6]] as Array<[number, number, number]>, halfWidth: 4 }
  it('沿線高度內插、橫向衰減到 halfWidth 為 0', () => {
    expect(ridgeAt(r, 0, 0)).toBeCloseTo(2)
    expect(ridgeAt(r, 5, 0)).toBeCloseTo(4)
    expect(ridgeAt(r, 10, 0)).toBeCloseTo(6)
    expect(ridgeAt(r, 5, 4)).toBeCloseTo(0)
    expect(ridgeAt(r, 5, 10)).toBe(0)
    expect(ridgeAt(r, 5, 2)).toBeGreaterThan(0)
  })
})

describe('noiseAt', () => {
  const n = { amp: 1.5, scale: 8, seed: 3 }
  it('決定性、在 ±amp 內、連續(相鄰很近的點差很小)', () => {
    expect(noiseAt(n, 3.3, -4.1)).toBe(noiseAt(n, 3.3, -4.1))
    for (let i = 0; i < 200; i++) expect(Math.abs(noiseAt(n, i * 1.37 - 50, i * 0.91 - 30))).toBeLessThanOrEqual(1.5)
    expect(Math.abs(noiseAt(n, 5, 5) - noiseAt(n, 5.01, 5))).toBeLessThan(0.05)
  })
  it('不同種子結果不同', () => {
    expect(noiseAt({ ...n, seed: 4 }, 3.3, -4.1)).not.toBe(noiseAt(n, 3.3, -4.1))
  })
})

describe('pad 平台', () => {
  const pad = { outline: [[0, 0], [10, 0], [10, 10], [0, 10]] as Array<[number, number]>, y: 5, blend: 4 }
  it('內部權重 1、外圍 blend 內平滑降到 0', () => {
    expect(padWeight(pad, 5, 5)).toBe(1)
    expect(padWeight(pad, 12, 5)).toBeGreaterThan(0)
    expect(padWeight(pad, 12, 5)).toBeLessThan(1)
    expect(padWeight(pad, 14, 5)).toBeCloseTo(0)
    expect(padWeight(pad, 30, 5)).toBe(0)
    expect(padWeight({ ...pad, blend: 0 }, 11, 5)).toBe(0)
  })
  it('平台內高度精確等於 y(不受 ramp/bump/noise 影響),平台外接回原地形', () => {
    const t: TerrainSpec = { ramp: { from: [0, 20], to: [0, -20], y0: 0, y1: 12 }, features: [{ kind: 'bump', x: 5, z: 5, rx: 12, rz: 12, height: 6 }], noise: { amp: 1, scale: 5, seed: 1 }, pads: [pad] }
    for (const [x, z] of [[1, 1], [5, 5], [9, 9], [2, 8]]) expect(heightFieldAt(t, x, z)).toBe(5)
    expect(heightFieldAt(t, 40, 40)).toBeCloseTo(baseFieldAt(t, 40, 40))
  })
  it('後面的平台蓋過前面的', () => {
    const t: TerrainSpec = { pads: [{ ...pad, y: 5 }, { outline: [[4, 4], [6, 4], [6, 6], [4, 6]], y: 9, blend: 0 }] }
    expect(heightFieldAt(t, 5, 5)).toBe(9)
    expect(heightFieldAt(t, 1, 1)).toBe(5)
  })
})

describe('heightAt 與連續地形', () => {
  const layout = { topY: 0, terrain: { ramp: { from: [0, 10], to: [0, -10], y0: -3, y1: 8 } } } as Pick<IslandLayout, 'topY' | 'terrain'>
  it('有 terrain 時用高度場,並夾在 topY 以上', () => {
    expect(heightAt(layout, 0, 10)).toBe(0) // 高度場 -3 → 夾在 topY
    expect(heightAt(layout, 0, -10)).toBeCloseTo(8)
  })
  it('沒有 terrain 時行為不變(階地)', () => {
    expect(heightAt({ topY: 0, terraces: [{ outline: [[0, 0], [4, 0], [4, 4], [0, 4]], y: 3 }] }, 2, 2)).toBe(3)
  })
})

describe('scatterResolve 在連續地形上', () => {
  const layout = {
    outline: [[-20, -20], [20, -20], [20, 20], [-20, 20]] as Array<[number, number]>, topY: 0, stops: [], river: { points: [], width: 0 },
    terrain: { ramp: { from: [0, 20], to: [0, -20], y0: 0, y1: 8 } },
  } as unknown as Parameters<typeof resolveScatter>[1]
  const opts = { pathLine: [], pathWidth: 2, stopClear: 4, edgeClear: 1, radiusOf: () => 1 } as unknown as Parameters<typeof resolveScatter>[2]
  it('緩坡上的物件保留、高度貼地;太陡的才剔除', () => {
    const gentle = resolveScatter([{ model: 'm', x: 0, z: 0 }], layout, opts)
    expect(gentle.kept).toHaveLength(1)
    expect(gentle.kept[0].y).toBeCloseTo(4)
    const steep = { ...layout, terrain: { ramp: { from: [0, 1], to: [0, -1], y0: 0, y1: 8 } } } as typeof layout
    const r = resolveScatter([{ model: 'm', x: 0, z: 0 }], steep, opts)
    expect(r.dropped[0]?.reason).toBe('坡太陡')
  })
})

describe('validateLayout 的 terrain 檢查', () => {
  const base = {
    outline: [[-20, -20], [20, -20], [20, 20], [-20, 20]], topY: 0, thickness: 5, river: { points: [], width: 1 }, path: { points: [[0, 0], [5, 5]], width: 2 },
    stops: [], scatter: [], lighting: [], palette: { grass: '#000000', grassAlt: '#000000', dirt: '#000000', water: '#000000', waterDeep: '#000000', path: '#000000' },
  } as unknown as IslandLayout
  const errors = (terrain: TerrainSpec) => validateLayout({ ...base, terrain }, new Set(), []).filter((i) => i.level === 'error' && i.path.startsWith('terrain'))
  it('合法的設定沒有 error', () => {
    expect(errors({ ramp: { from: [0, 0], to: [0, 1], y0: 0, y1: 1 }, features: [{ kind: 'bump', x: 0, z: 0, rx: 3, rz: 3, height: 1 }], noise: { amp: 1, scale: 4, seed: 1 }, pads: [{ outline: [[0, 0], [4, 0], [4, 4]], y: 2, blend: 1 }] })).toEqual([])
  })
  it('不合法的設定回報 error', () => {
    expect(errors({ features: [{ kind: 'bump', x: 0, z: 0, rx: 0, rz: 3, height: 1 }] })).toHaveLength(1)
    expect(errors({ features: [{ kind: 'ridge', points: [[0, 0, 1]], halfWidth: 0 }] }).length).toBeGreaterThan(0)
    expect(errors({ noise: { amp: 1, scale: 0, seed: 1 } })).toHaveLength(1)
    expect(errors({ cell: 0.1 })).toHaveLength(1)
    expect(errors({ pads: [{ outline: [[0, 0], [1, 1]], y: 1, blend: 1 }] })).toHaveLength(1)
    expect(errors({ pads: [{ outline: [[0, 0], [4, 0], [4, 4]], y: 1, blend: -1 }] })).toHaveLength(1)
  })
})
