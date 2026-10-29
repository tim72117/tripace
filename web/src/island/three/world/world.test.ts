import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createCellRuntime } from './cellRuntime'
import { splitByCell } from './cellSplit'

const grid = { cellSize: 10 }

describe('splitByCell', () => {
  it('三角形依中心點分到格子,總數不變、頂點屬性跟著搬;每格有包圍球', () => {
    // 兩個三角形:中心分別在 (1, 1) 與 (15, 1)
    const pos = [0, 0, 0, 2, 0, 0, 1, 0, 3, 14, 0, 0, 16, 0, 0, 15, 0, 3]
    const col = pos.map((_, i) => i / 100)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    const out = splitByCell(g, grid)
    expect([...out.keys()]).toEqual(['0_0', '1_0'])
    expect(out.get('1_0')!.getAttribute('position').getX(0)).toBe(14)
    expect(out.get('1_0')!.getAttribute('color').getX(0)).toBeCloseTo(0.09)
    expect([...out.values()].reduce((n, q) => n + q.getAttribute('position').count, 0)).toBe(6)
    expect(out.get('0_0')!.boundingSphere).not.toBeNull()
  })
  it('索引幾何直接報錯(要先 toNonIndexed)', () => {
    expect(() => splitByCell(new THREE.BoxGeometry(), grid)).toThrow()
  })
})

describe('createCellRuntime', () => {
  it('依串流半徑開關格子的物件與 BatchedMesh 實例;LOD 變化時通知', () => {
    const near = new THREE.Object3D(), far = new THREE.Object3D()
    const batch = new THREE.BatchedMesh(2, 100, 100, new THREE.MeshBasicMaterial())
    const geo = batch.addGeometry(new THREE.BoxGeometry())
    const farInst = batch.addInstance(geo)
    const lods: Array<[string, number]> = []
    const rt = createCellRuntime(grid, { loadRadius: 15, unloadRadius: 20, lodDistances: [5], lodHysteresis: 1, hlodDistance: Infinity }, { onLod: (c, l) => lods.push([c, l]) })
    rt.add('0_0', { objects: [near] })
    rt.add('3_0', { objects: [far], instances: [{ mesh: batch, id: farInst }] })
    rt.update(5, 5) // 在 0_0 格內;3_0 距離 25
    expect(near.visible).toBe(true)
    expect(far.visible).toBe(false)
    expect(batch.getVisibleAt(farInst)).toBe(false)
    rt.update(18, 5) // 0_0 距離 8(LOD 1)、3_0 距離 12(載入)
    expect(far.visible).toBe(true)
    expect(batch.getVisibleAt(farInst)).toBe(true)
    expect(lods).toEqual([['0_0', 1]])
  })
})
