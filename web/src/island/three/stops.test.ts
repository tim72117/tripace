// stops.ts 的站點索引測試(three 的物件與 CSS2D 在 jsdom 就能跑,不需要 WebGL)。
//
// 重點:views[i].index 是「站點在清單中的索引」,glowPerStop 以這個索引為鍵。若某一站沒有建築被跳過,
// 後面站點的亮度仍必須對到自己的索引,不能因為 views 少一個而往前錯位。
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { IslandStop } from '../logic/articleToIsland'
import type { Model3D } from './model'
import { buildStops } from './stops'

const LAMP: Model3D = { parts: [{ shape: { type: 'box', size: [1, 1, 1] }, color: '#ffffff', emissive: '#ff0000' }] }
const stop = (i: number, withAnchor: boolean): IslandStop => ({
  stopId: `s${i}`, order: i, index: String(i), name: `站${i}`, excerpt: '', time: '17:30', timeSource: 'layout',
  anchor: withAnchor ? { stopId: `s${i}`, model: 'lamp', x: i * 10, z: 0, label: `站${i}`, time: '17:30' } : null,
})
const flat = () => 0

describe('buildStops 的站點索引', () => {
  it('全部都有版面:views[i].index === i', () => {
    const s = buildStops([stop(0, true), stop(1, true), stop(2, true)], { lamp: LAMP }, flat, () => {})
    expect(s.views.map((v) => v.index)).toEqual([0, 1, 2])
  })

  it('中間一站被跳過:後面的站仍保有自己的索引,亮度以索引為鍵(不會錯位到前一站)', () => {
    const s = buildStops([stop(0, true), stop(1, false), stop(2, true)], { lamp: LAMP }, flat, () => {})
    expect(s.views.map((v) => v.index)).toEqual([0, 2]) // 跳過了索引 1
    const glow: number[] = []
    glow[0] = 0.1
    glow[2] = 0.9
    s.update(0, glow, -1, -1)
    const intensity = (k: number) => s.views[k].glowMats[0].m.emissiveIntensity
    const base = s.views[0].glowMats[0].base
    expect(intensity(0)).toBeCloseTo(base * (0.2 + 2.2 * 0.1))
    expect(intensity(1)).toBeCloseTo(base * (0.2 + 2.2 * 0.9)) // 索引 2 的站,用的是 glow[2]
  })

  it('標籤的 is-active / is-selected 以站點索引判斷', () => {
    const s = buildStops([stop(0, true), stop(1, false), stop(2, true)], { lamp: LAMP }, flat, () => {})
    s.update(0, [0, 0, 0], 2, 2)
    expect(s.views[0].labelEl.classList.contains('is-active')).toBe(false)
    expect(s.views[1].labelEl.classList.contains('is-active')).toBe(true) // 第二個 view 就是索引 2
    expect(s.views[1].labelEl.classList.contains('is-selected')).toBe(true)
  })

  it('點標籤觸發 onLabelClick(站點索引,不是 views 的順序);標籤只有序號與站名,沒有時間;建築模型本身不可點選', () => {
    const clicked = vi.fn()
    const s = buildStops([stop(0, true), stop(1, false), stop(2, true)], { lamp: LAMP }, flat, clicked)
    s.views[1].labelEl.click()
    expect(clicked).toHaveBeenCalledWith(2)
    expect(s.views[1].labelEl.querySelector('em')).toBeNull()
    expect(s.views[1].labelEl.textContent).not.toMatch(/\d{1,2}:\d{2}/)
    expect('pick' in s).toBe(false)
  })
})

describe('buildStops 的燈籠錨點', () => {
  // 建築的高細節 GLB:一個牆面網格加兩個燈籠錨點(空節點);縮放 0.5
  const glbScene = () => {
    const g = new THREE.Group()
    g.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: '#444444' })))
    for (const [n, x] of [['lantern_00', -1], ['lantern_01', 1]] as const) {
      const a = new THREE.Object3D()
      a.name = n
      a.position.set(x, 1, 1)
      g.add(a)
    }
    return g
  }
  const HOUSE: Model3D = { parts: [], glb: { scene: glbScene() } }
  const anchored: IslandStop = { ...stop(0, true), anchor: { stopId: 's0', model: 'house', x: 10, z: 20, label: '站0', time: '17:30' } }

  it('錨點用實例畫(2 個 InstancedMesh),位置跟著站點的位置與縮放;燈身發光材質收進 glowMats', () => {
    const s = buildStops([anchored], { house: HOUSE }, flat, () => {})
    const v = s.views[0]
    const instanced: THREE.InstancedMesh[] = []
    s.group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) instanced.push(o as THREE.InstancedMesh) })
    expect(instanced).toHaveLength(2)
    expect(instanced.every((m) => m.count === 2)).toBe(true)
    const mat = new THREE.Matrix4()
    instanced[0].getMatrixAt(1, mat)
    const p = new THREE.Vector3().setFromMatrixPosition(mat)
    expect([p.x, p.y, p.z]).toEqual([11, 1, 21]) // GLB 是公尺、放進場景不換算:(1,1,1) + 站點位置 (10,0,20)
    expect(v.glowMats.some((g) => instanced[0].material === g.m)).toBe(true)
  })

  it('燈籠亮度與站點亮度連動(與建築其他發光部件同一個公式)', () => {
    const s = buildStops([anchored], { house: HOUSE }, flat, () => {})
    const body = (s.group.children.flatMap((c) => c.children) as THREE.InstancedMesh[]).find((m) => m.name === 'stop-lantern-bodies')!
    const mat = body.material as THREE.MeshStandardMaterial
    s.update(0, [0], -1, -1)
    const dark = mat.emissiveIntensity
    s.update(0, [1], -1, -1)
    expect(mat.emissiveIntensity).toBeGreaterThan(dark * 5)
  })

  it('沒有錨點的建築不多出任何實例', () => {
    const s = buildStops([stop(0, true)], { lamp: LAMP }, flat, () => {})
    let n = 0
    s.group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) n++ })
    expect(n).toBe(0)
  })
})
