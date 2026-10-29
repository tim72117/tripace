// buildScatter:Placement.tilt 讓物件的「上方」對齊坡面法線(貼著斜坡)。
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { Model3D } from './model'
import { buildScatter } from './scatter'

const models: Record<string, Model3D> = { rock: { parts: [{ shape: { type: 'box', size: [1, 1, 1] }, color: '#888888' }] } }

function up(tilt: [number, number] | undefined, rotY: number) {
  const { group } = buildScatter([{ model: 'rock', x: 1, y: 2, z: 3, rotY, tilt }], models, { shadows: false })
  const mesh = group.children[0] as THREE.BatchedMesh
  const m = new THREE.Matrix4()
  mesh.getMatrixAt(0, m)
  const v = new THREE.Vector3(0, 1, 0).transformDirection(m)
  return { v, pos: new THREE.Vector3().setFromMatrixPosition(m) }
}

describe('buildScatter tilt', () => {
  it('沒有 tilt 時上方仍朝 +y', () => {
    const { v } = up(undefined, 1.2)
    expect(v.y).toBeCloseTo(1)
  })
  it('tilt [60°, 0] 讓上方朝 (0, cos60°, sin60°),與 rotY 無關', () => {
    for (const rotY of [0, 0.7, 2.5]) {
      const { v, pos } = up([Math.PI / 3, 0], rotY)
      expect(v.x).toBeCloseTo(0)
      expect(v.y).toBeCloseTo(0.5)
      expect(v.z).toBeCloseTo(Math.sin(Math.PI / 3))
      expect(pos.toArray().map((n) => Math.round(n))).toEqual([1, 2, 3])
    }
  })
})
