import { describe, expect, it } from 'vitest'
import { JAPAN_LAND } from './japanLand'
import { pointInRing } from './momijiFrontModel'
import { COVER_MAX } from './snowfall'
import {
  DAISETSUZAN, HOKKAIDO_PATCHES, HOKKAIDO_RING, PATCH_ALPHA, PATCH_COUNT, PATCH_RAMP, PATCH_RADIUS, RING_MAX_POINTS, SAPPORO,
  createSnowPatches, distanceToRing, patchGrowth, pickRingContaining, ringBbox, thinRing,
} from './hokkaidoSnow'

describe('北海道輪廓', () => {
  it('挑到的環非空、點數不超過上限', () => {
    expect(HOKKAIDO_RING.length).toBeGreaterThan(3)
    expect(HOKKAIDO_RING.length).toBeLessThanOrEqual(RING_MAX_POINTS)
  })
  it('包住札幌,不包住青森與函館以南的本州點', () => {
    expect(pointInRing(SAPPORO.lng, SAPPORO.lat, HOKKAIDO_RING)).toBe(true)
    expect(pointInRing(140.74, 40.82, HOKKAIDO_RING)).toBe(false)
    expect(pointInRing(141.0, 41.3, HOKKAIDO_RING)).toBe(false)
    expect(pointInRing(141.0, 41.3, JAPAN_LAND[0])).toBe(true)
  })
  it('bbox 落在北海道範圍(lat 41.3–45.6 / lng 139.3–145.9)', () => {
    const b = ringBbox(HOKKAIDO_RING)
    expect(b.minLat).toBeGreaterThan(41.3)
    expect(b.maxLat).toBeLessThan(45.6)
    expect(b.minLng).toBeGreaterThan(139.3)
    expect(b.maxLng).toBeLessThan(145.9)
  })
  it('pickRingContaining 找不到時回 null;thinRing 等距抽稀並保留首點', () => {
    expect(pickRingContaining(JAPAN_LAND, 150, 50)).toBeNull()
    const ring = Array.from({ length: 1000 }, (_, i) => [i, i] as const)
    const thin = thinRing(ring, 100)
    expect(thin.length).toBe(100)
    expect(thin[0]).toEqual([0, 0])
    expect(thin[50]).toEqual([500, 500])
    expect(thinRing(ring, 2000)).toBe(ring)
  })
})

describe('積雪斑塊', () => {
  it('數量正確、全部落在輪廓內、同 seed 一致', () => {
    expect(HOKKAIDO_PATCHES.length).toBe(PATCH_COUNT)
    for (const p of HOKKAIDO_PATCHES) {
      expect(pointInRing(p.lng, p.lat, HOKKAIDO_RING)).toBe(true)
      expect(p.rx).toBeGreaterThanOrEqual(PATCH_RADIUS[0])
      expect(p.rx).toBeLessThanOrEqual(PATCH_RADIUS[1])
      expect(p.ry).toBeLessThan(p.rx)
      expect(p.alpha).toBeGreaterThanOrEqual(PATCH_ALPHA[0])
      expect(p.alpha).toBeLessThanOrEqual(PATCH_ALPHA[1])
      expect(p.inland).toBeGreaterThanOrEqual(0)
      expect(p.inland).toBeLessThanOrEqual(1)
      expect(p.threshold).toBeGreaterThanOrEqual(0)
    }
    expect(createSnowPatches(HOKKAIDO_RING, PATCH_COUNT, 20261022)).toEqual(HOKKAIDO_PATCHES)
  })
  it('distanceToRing:輪廓上為 0、內陸大雪山一帶比海岸遠', () => {
    const [lng, lat] = HOKKAIDO_RING[0]
    expect(distanceToRing(lng, lat, HOKKAIDO_RING)).toBeCloseTo(0)
    expect(distanceToRing(DAISETSUZAN.lng, DAISETSUZAN.lat, HOKKAIDO_RING)).toBeGreaterThan(0.3)
    expect(distanceToRing(SAPPORO.lng, SAPPORO.lat, HOKKAIDO_RING)).toBeLessThan(distanceToRing(DAISETSUZAN.lng, DAISETSUZAN.lat, HOKKAIDO_RING))
  })
  it('內陸先白、海岸最後:最內陸的門檻低於最靠海的;積雪上限時海岸一圈仍裸露', () => {
    const byInland = [...HOKKAIDO_PATCHES].sort((a, b) => b.inland - a.inland)
    const inner = byInland.slice(0, 20)
    const outer = byInland.slice(-20)
    const avg = (ps: typeof inner) => ps.reduce((s, p) => s + p.threshold, 0) / ps.length
    expect(avg(inner)).toBeLessThan(avg(outer) - 0.3)
    const grown = (cover: number) => HOKKAIDO_PATCHES.filter((p) => patchGrowth(cover, p.threshold) > 0).length
    expect(grown(0)).toBeLessThan(PATCH_COUNT * 0.1)
    expect(grown(0.3)).toBeGreaterThan(PATCH_COUNT * 0.05)
    expect(grown(COVER_MAX)).toBeLessThan(PATCH_COUNT)
    expect(grown(COVER_MAX)).toBeGreaterThan(PATCH_COUNT * 0.35)
    expect(grown(1 + PATCH_RAMP + 0.1)).toBe(PATCH_COUNT)
  })
  it('patchGrowth 在門檻到門檻+ramp 之間平滑由 0 到 1', () => {
    expect(patchGrowth(0.2, 0.3)).toBe(0)
    expect(patchGrowth(0.3, 0.3)).toBe(0)
    expect(patchGrowth(0.3 + PATCH_RAMP / 2, 0.3)).toBeCloseTo(0.5)
    expect(patchGrowth(0.3 + PATCH_RAMP, 0.3)).toBe(1)
    expect(patchGrowth(1, 0.3)).toBe(1)
  })
})
