import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildModel, prismGeometry, type Model3D } from './model'

// 三角形法線與「由中心指向該三角形」的方向同向 = 法線朝外(three 預設只畫正面,朝內的面從外面看不見)
function outwardRatio(g: THREE.BufferGeometry, center: THREE.Vector3): number {
  const pos = g.getAttribute('position')
  let out = 0
  const n = pos.count / 3
  for (let t = 0; t < n; t++) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, t * 3)
    const b = new THREE.Vector3().fromBufferAttribute(pos, t * 3 + 1)
    const c = new THREE.Vector3().fromBufferAttribute(pos, t * 3 + 2)
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize()
    const centroid = a.clone().add(b).add(c).divideScalar(3)
    if (normal.dot(centroid.sub(center)) > 0) out++
  }
  return out / n
}

describe('prismGeometry(三角柱屋頂)', () => {
  it('8 個三角形,每個面的法線都朝外', () => {
    const g = prismGeometry(4, 2, 6)
    expect(g.getAttribute('position').count).toBe(24)
    expect(outwardRatio(g, new THREE.Vector3(0, 2 / 3, 0))).toBe(1)
  })
  it('尺寸:長 length(x)、跨度 span(z)、高 height(y),底面在 y = 0', () => {
    const box = new THREE.Box3().setFromBufferAttribute(prismGeometry(4, 2, 6).getAttribute('position') as THREE.BufferAttribute)
    expect(box.min.toArray()).toEqual([-3, 0, -2])
    expect(box.max.toArray()).toEqual([3, 2, 2])
  })
  it('兩端山牆各朝 -X、+X,底面朝下', () => {
    const g = prismGeometry(4, 2, 6)
    const pos = g.getAttribute('position')
    const normalOf = (t: number) => {
      const [a, b, c] = [0, 1, 2].map((i) => new THREE.Vector3().fromBufferAttribute(pos, t * 3 + i))
      return new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize()
    }
    expect(normalOf(0).x).toBeLessThan(-0.99) // -X 山牆
    expect(normalOf(1).x).toBeGreaterThan(0.99) // +X 山牆
    expect(normalOf(6).y).toBeLessThan(-0.99) // 底面
  })
})

const meshOf = (model: Model3D) => {
  const built = buildModel(model)
  const meshes: THREE.Mesh[] = []
  built.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh) })
  return meshes
}

describe('buildModel 的形狀', () => {
  it('lathe:依剖面與分段數旋轉出網格', () => {
    const [m] = meshOf({ parts: [{ shape: { type: 'lathe', profile: [[0.5, 0], [0.5, 1], [0.2, 1.5]], segments: 8 } }] })
    const box = new THREE.Box3().setFromObject(m)
    expect(box.max.y).toBeCloseTo(1.5, 5)
    expect(box.max.x).toBeCloseTo(0.5, 5)
    expect(m.geometry.getAttribute('position').count).toBeGreaterThan(0)
  })
  it('extrude:厚度置中於 ±depth/2;有倒角時總厚度不變', () => {
    for (const bevel of [0, 0.05]) {
      const [m] = meshOf({ parts: [{ shape: { type: 'extrude', outline: [[0, 0], [2, 0], [2, 1], [0, 1]], depth: 0.4, bevel } }] })
      const box = new THREE.Box3().setFromObject(m)
      expect(box.min.z).toBeCloseTo(-0.2, 3)
      expect(box.max.z).toBeCloseTo(0.2, 3)
    }
  })
  it('材質:只有明確指定的選項記在 userData.explicit;相同參數共用同一個材質', () => {
    const [a, b, c] = meshOf({
      parts: [
        { shape: { type: 'box', size: [1, 1, 1] }, color: '#aabbcc' },
        { shape: { type: 'box', size: [1, 1, 1] }, color: '#aabbcc' },
        { shape: { type: 'box', size: [1, 1, 1] }, color: '#aabbcc', smooth: true, rough: 0.3, metal: 0.9 },
      ],
    })
    expect(a.material).toBe(b.material)
    expect(a.material).not.toBe(c.material)
    expect((c.material as THREE.MeshStandardMaterial).userData.explicit).toEqual({ smooth: true, rough: 0.3, metal: 0.9 })
    expect((c.material as THREE.MeshStandardMaterial).roughness).toBe(0.3)
    expect((a.material as THREE.MeshStandardMaterial).userData.explicit).toEqual({ smooth: false, rough: undefined, metal: undefined })
  })
})
