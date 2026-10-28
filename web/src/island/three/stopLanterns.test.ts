import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { LANTERN_GLOW_BASE, buildLanternGeometries, buildStopLanterns, collectLanternAnchors } from './stopLanterns'

const anchor = (name: string, x: number, y: number, z: number) => {
  const o = new THREE.Object3D()
  o.name = name
  o.position.set(x, y, z)
  return o
}

describe('collectLanternAnchors', () => {
  it('只收名稱以 lantern_ 開頭、沒有網格的節點;矩陣含父層的縮放與旋轉', () => {
    const scene = new THREE.Group()
    scene.add(anchor('lantern_00', 1, 2, 3), anchor('lantern_01', -1, 0, 0), anchor('window_0', 9, 9, 9))
    const trap = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    trap.name = 'lantern_mesh' // 有網格的不算錨點
    scene.add(trap)
    const root = new THREE.Group()
    root.position.set(10, 0, 0)
    root.scale.setScalar(0.5)
    root.rotation.y = Math.PI / 2
    root.add(scene)
    const ms = collectLanternAnchors(root)
    expect(ms).toHaveLength(2)
    const p = new THREE.Vector3().setFromMatrixPosition(ms[0])
    // (1,2,3) 先縮放 0.5 → (0.5,1,1.5),繞 Y 轉 90°:x' = z、z' = -x → (1.5,1,-0.5),再平移 +10
    expect(p.x).toBeCloseTo(11.5, 5)
    expect(p.y).toBeCloseTo(1, 5)
    expect(p.z).toBeCloseTo(-0.5, 5)
    expect(new THREE.Vector3().setFromMatrixScale(ms[0]).x).toBeCloseTo(0.5, 5)
  })
  it('沒有錨點回空陣列', () => {
    expect(collectLanternAnchors(new THREE.Group())).toEqual([])
  })
})

describe('buildLanternGeometries', () => {
  it('燈身是 r=0.24、半高 0.18 的橢球;其餘部件有頂點色,且都在燈身上下', () => {
    const { body, trim } = buildLanternGeometries()
    const bb = new THREE.Box3().setFromBufferAttribute(body.getAttribute('position') as THREE.BufferAttribute)
    expect(bb.max.x).toBeLessThanOrEqual(0.2401) // 12 分段的橢球,最寬處略小於 r
    expect(bb.max.x).toBeGreaterThan(0.22)
    expect(bb.max.y).toBeCloseTo(0.18, 3)
    expect(trim.getAttribute('color').count).toBe(trim.getAttribute('position').count)
    const tb = new THREE.Box3().setFromBufferAttribute(trim.getAttribute('position') as THREE.BufferAttribute)
    expect(tb.max.y).toBeGreaterThan(0.3) // 上方掛鉤
    expect(tb.min.y).toBeLessThan(-0.3) // 下方吊穗
    for (const g of [body, trim]) {
      const arr = g.getAttribute('position').array as Float32Array
      expect(arr.every((v) => Number.isFinite(v))).toBe(true)
    }
  })
})

describe('buildStopLanterns', () => {
  it('沒有錨點回 null', () => {
    expect(buildStopLanterns([])).toBeNull()
  })
  it('兩個 InstancedMesh(燈身、其餘),實例數 = 錨點數,矩陣原樣放入;燈身材質是發光的', () => {
    const ms = [new THREE.Matrix4().makeTranslation(1, 2, 3), new THREE.Matrix4().makeTranslation(4, 5, 6), new THREE.Matrix4().makeTranslation(7, 8, 9)]
    const l = buildStopLanterns(ms)!
    const meshes = l.group.children as THREE.InstancedMesh[]
    expect(meshes).toHaveLength(2)
    for (const m of meshes) {
      expect(m.isInstancedMesh).toBe(true)
      expect(m.count).toBe(3)
    }
    const got = new THREE.Matrix4()
    meshes[0].getMatrixAt(1, got)
    expect(new THREE.Vector3().setFromMatrixPosition(got).toArray()).toEqual([4, 5, 6])
    expect(l.bodyMaterial.emissiveIntensity).toBe(LANTERN_GLOW_BASE)
    expect(l.bodyMaterial.emissive.getHex()).not.toBe(0)
  })
})
