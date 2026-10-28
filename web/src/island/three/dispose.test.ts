import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { disposeMaterial, disposeObject } from './dispose'

// 用 DataTexture(不需要 DOM/canvas)與 'dispose' 事件計數,驗證哪些東西被釋放
function counted<T extends THREE.EventDispatcher<{ dispose: object }>>(x: T): { x: T; count: () => number } {
  let n = 0
  x.addEventListener('dispose', () => { n++ })
  return { x, count: () => n }
}
const tex = () => new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1)

describe('disposeObject', () => {
  it('釋放幾何、材質,以及材質上的貼圖(含 map 以外的貼圖)', () => {
    const g = counted(new THREE.BoxGeometry())
    const map = counted(tex()), emissiveMap = counted(tex())
    const m = counted(new THREE.MeshStandardMaterial({ map: map.x, emissiveMap: emissiveMap.x }))
    const scene = new THREE.Group().add(new THREE.Mesh(g.x, m.x))
    disposeObject(scene)
    expect([g.count(), m.count(), map.count(), emissiveMap.count()]).toEqual([1, 1, 1, 1])
  })

  it('材質陣列(例如島體的草地/泥土)每一個都釋放', () => {
    const a = counted(new THREE.MeshStandardMaterial()), b = counted(new THREE.MeshStandardMaterial())
    disposeObject(new THREE.Mesh(new THREE.BoxGeometry(), [a.x, b.x]))
    expect([a.count(), b.count()]).toEqual([1, 1])
  })

  it('Points 的材質與貼圖、ShaderMaterial uniform 裡的貼圖也釋放', () => {
    const t1 = counted(tex()), t2 = counted(tex())
    const pm = counted(new THREE.PointsMaterial({ map: t1.x }))
    const sm = counted(new THREE.ShaderMaterial({ uniforms: { uMap: { value: t2.x }, uNum: { value: 3 } } }))
    const scene = new THREE.Group()
    scene.add(new THREE.Points(new THREE.BufferGeometry(), pm.x), new THREE.Mesh(new THREE.BoxGeometry(), sm.x))
    disposeObject(scene)
    expect([pm.count(), t1.count(), sm.count(), t2.count()]).toEqual([1, 1, 1, 1])
  })

  it('實例化網格:額外釋放 instanceMatrix 的 GPU 屬性(InstancedMesh.dispose)', () => {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 4)
    const c = counted(im as unknown as THREE.EventDispatcher<{ dispose: object }>)
    disposeObject(im)
    expect(c.count()).toBe(1)
  })

  it('沒有 geometry/material 的節點(Group、Light)不會丟錯;空場景安全', () => {
    const scene = new THREE.Group().add(new THREE.Group(), new THREE.HemisphereLight())
    expect(() => disposeObject(scene)).not.toThrow()
    expect(() => disposeObject(new THREE.Object3D())).not.toThrow()
  })

  it('釋放後材質仍可再次使用(model.ts 的材質是全域快取,這點很重要):重複釋放不丟錯', () => {
    const m = new THREE.MeshStandardMaterial({ map: tex() })
    disposeMaterial(m)
    expect(() => disposeMaterial(m)).not.toThrow()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), m)
    expect(mesh.material).toBe(m)
  })

  it('標了 userData.sharedResource 的幾何/材質(GLB 的)不釋放;自己擁有的照常釋放', () => {
    const sharedG = counted(new THREE.BoxGeometry())
    sharedG.x.userData.sharedResource = true
    const sharedM = counted(new THREE.MeshStandardMaterial())
    sharedM.x.userData.sharedResource = true
    const ownG = counted(new THREE.BoxGeometry())
    const ownM = counted(new THREE.MeshStandardMaterial())
    disposeObject(new THREE.Group().add(new THREE.Mesh(sharedG.x, sharedM.x), new THREE.Mesh(ownG.x, ownM.x)))
    expect([sharedG.count(), sharedM.count()]).toEqual([0, 0])
    expect([ownG.count(), ownM.count()]).toEqual([1, 1])
  })
})
