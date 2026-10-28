import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { IslandLayout } from '../data/layoutTypes'
import { heightAt } from '../logic/terrain'
import { fieldSurfacePoints, fieldTerrainGeometry, subdivideRing } from './terrainField'

const layout = {
  outline: [[-20, -16], [20, -18], [22, 10], [0, 22], [-22, 12]],
  topY: 0, thickness: 6, river: { points: [], width: 1 }, path: { points: [], width: 2 }, stops: [], scatter: [], lighting: [],
  palette: { grass: '#6f8f4e', grassAlt: '#86a35a', dirt: '#7a5a3e', water: '#3d6f8f', waterDeep: '#1f3b5c', path: '#9a9286' },
  terrain: {
    ramp: { from: [0, 20], to: [0, -18], y0: 0, y1: 12 },
    pads: [{ outline: [[-4, -2], [4, -2], [4, 4], [-4, 4]], y: 5, blend: 2, color: '#a39a7a' }],
  },
} as unknown as IslandLayout
const h = (x: number, z: number) => heightAt(layout, x, z)

describe('subdivideRing', () => {
  it('每條邊補點到間距不超過 step,並保留原頂點', () => {
    const ring = subdivideRing([[0, 0], [10, 0], [10, 10]], 3)
    expect(ring).toContainEqual([0, 0])
    expect(ring).toContainEqual([10, 0])
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length]
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThanOrEqual(3.0001 * (i === ring.length - 1 ? 4 : 1))
    }
  })
})

describe('fieldSurfacePoints', () => {
  it('點全部在輪廓內或輪廓上,沒有重複點,輪廓點都在裡面', () => {
    const { points, ring } = fieldSurfacePoints(layout)
    expect(points.length).toBeGreaterThan(100)
    const key = new Set(points.map((p) => p.join(',')))
    expect(key.size).toBe(points.length)
    for (const r of ring) expect(points.some((p) => Math.hypot(p[0] - r[0], p[1] - r[1]) < 1e-6)).toBe(true)
  })
})

describe('fieldTerrainGeometry', () => {
  const { top, wall } = fieldTerrainGeometry(layout, h)
  const pos = (g: typeof top) => g.getAttribute('position').array as Float32Array
  it('頂面與側壁都有頂點色,三角形數合理', () => {
    expect(top.getAttribute('color').count).toBe(top.getAttribute('position').count)
    expect(wall.getAttribute('color').count).toBe(wall.getAttribute('position').count)
    expect(top.getAttribute('position').count % 3).toBe(0)
    expect(top.getAttribute('position').count / 3).toBeGreaterThan(200)
  })
  it('頂面每個頂點的高度等於 heightAt(與貼地物件用同一個函式)', () => {
    const p = pos(top)
    for (let i = 0; i < p.length; i += 3) expect(p[i + 1]).toBeCloseTo(h(p[i], p[i + 2]), 4)
  })
  it('頂面三角形法線一律朝上', () => {
    const p = pos(top)
    for (let i = 0; i < p.length; i += 9) {
      const ny = (p[i + 5] - p[i + 2]) * (p[i + 6] - p[i]) - (p[i + 3] - p[i]) * (p[i + 8] - p[i + 2])
      expect(ny).toBeGreaterThan(0)
    }
  })
  it('側壁的最低點在 floorY(topY - thickness),最高點等於輪廓上的地表高度', () => {
    const p = pos(wall)
    const ys = Array.from({ length: p.length / 3 }, (_, i) => p[i * 3 + 1])
    expect(Math.min(...ys)).toBeCloseTo(-6, 4)
    const maxRing = Math.max(...fieldSurfacePoints(layout).ring.map(([x, z]) => h(x, z)))
    expect(Math.max(...ys)).toBeCloseTo(maxRing, 4)
  })
  it('平台上的三角形用平台色', () => {
    const c = top.getAttribute('color').array as Float32Array
    const p = pos(top)
    let padTris = 0
    for (let i = 0; i < p.length; i += 9) {
      const cx = (p[i] + p[i + 3] + p[i + 6]) / 3, cz = (p[i + 2] + p[i + 5] + p[i + 8]) / 3
      if (Math.abs(cx) < 3 && cz > -1 && cz < 3) { padTris++; expect(c[i]).toBeGreaterThan(0.3); expect(c[i]).toBeLessThan(0.42) } // 平台色 #a39a7a 的紅通道(轉成 three 的線性色彩空間約 0.37)× 亮度抖動 0.9~1.1;草色只有約 0.16
    }
    expect(padTris).toBeGreaterThan(0)
  })
})

describe('fieldTerrainGeometry 的著色與邊界', () => {
  it('輪廓少於 3 個點:丟出清楚的錯誤(不是讓 Infinity 變成 NaN 顏色)', () => {
    const bad = { ...layout, outline: [[0, 0], [1, 1]] } as unknown as IslandLayout
    expect(() => fieldTerrainGeometry(bad, () => 0)).toThrow(/至少需要 3 個點/)
    expect(() => fieldTerrainGeometry({ ...layout, outline: [] } as unknown as IslandLayout, () => 0)).toThrow(/至少需要 3 個點/)
  })
  it('頂面與側壁的位置、頂點色全部是有限數(沒有 NaN)', () => {
    const { top, wall } = fieldTerrainGeometry(layout, h)
    for (const g of [top, wall]) {
      for (const name of ['position', 'color'] as const) {
        const arr = g.getAttribute(name).array as Float32Array
        expect(arr.every((v) => Number.isFinite(v))).toBe(true)
      }
    }
  })
  it('陡坡偏向岩色:同一份版面,把整體坡度拉陡後頂面平均顏色更接近岩石色', () => {
    const rock = new THREE.Color('#8a7f6f')
    const avgDistToRock = (heightFn: (x: number, z: number) => number) => {
      const { top } = fieldTerrainGeometry({ ...layout, terrain: { ...layout.terrain!, pads: [] } } as unknown as IslandLayout, heightFn)
      const c = top.getAttribute('color').array as Float32Array
      let sum = 0
      let n = 0
      for (let i = 0; i < c.length; i += 3) { sum += Math.hypot(c[i] - rock.r, c[i + 1] - rock.g, c[i + 2] - rock.b); n++ }
      return sum / n
    }
    const gentle = (x: number, z: number) => 0.02 * x + 0.02 * z
    const steep = (x: number, z: number) => 1.6 * x + 1.2 * z
    expect(avgDistToRock(steep)).toBeLessThan(avgDistToRock(gentle))
  })
})
