import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { Poly } from '../logic/walk'
import { placementPolys } from './colliders'
import type { Model3D } from './model'

const bounds = (polys: Poly[]) => {
  const xs = polys.flat().map((p) => p[0])
  const zs = polys.flat().map((p) => p[1])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
}

// 宣告式版:一個 2×2 的牆身(高 3,落在人身高度帶);高細節版:一個 10×10 的大方塊(像把藤蔓與屋簷合併成一個網格)
const declarative: Model3D['parts'] = [{ name: 'wall', shape: { type: 'box', size: [2, 3, 2] }, position: [0, 1.5, 0] }]
const bigGlb = () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 3, 10), new THREE.MeshStandardMaterial())
  mesh.position.y = 1.5
  return new THREE.Group().add(mesh)
}
const at = { model: 'm', x: 0, y: 0, z: 0 }

describe('placementPolys', () => {
  it('宣告式版本有內容時,碰撞用它(不用 GLB 合併後的大包圍盒)', () => {
    const polys = placementPolys({ parts: declarative, glb: { scene: bigGlb(), unit: 1 } }, at)
    expect(polys).toHaveLength(1)
    const b = bounds(polys)
    expect(b.maxX - b.minX).toBeCloseTo(2, 3)
    expect(b.maxZ - b.minZ).toBeCloseTo(2, 3)
  })
  it('宣告式沒有內容時才退回 GLB', () => {
    const polys = placementPolys({ parts: [], glb: { scene: bigGlb(), unit: 1 } }, at)
    expect(polys).toHaveLength(1)
    const b = bounds(polys)
    expect(b.maxX - b.minX).toBeCloseTo(10, 3)
  })
  it('不在人身高度帶的部件不收(太高的屋簷、貼地的地板、太薄的平面)', () => {
    const parts: Model3D['parts'] = [
      { name: 'eave', shape: { type: 'box', size: [4, 0.5, 4] }, position: [0, 6, 0] },
      { name: 'slab', shape: { type: 'box', size: [4, 0.1, 4] }, position: [0, 1, 0] },
      { name: 'floor', shape: { type: 'box', size: [4, 1, 4] }, position: [0, 0.5, 0] },
    ]
    expect(placementPolys({ parts }, at)).toEqual([])
  })
})
