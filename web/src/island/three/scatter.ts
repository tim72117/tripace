// scatter.ts——裝飾散落物 → InstancedMesh(依「模型 × 顏色」一組)。
//
// 輸入是 scatterResolve 避障貼地後的位置。每種模型烘焙一次(bake.ts),每個顏色組一個 InstancedMesh,
// 所以 150 個裝飾只有大約 20 次繪製呼叫。燈(emissive 部件)不在這裡畫,收集成 LampSource 交給燈籠層。
import * as THREE from 'three'
import type { Placement } from '../data/layoutTypes'
import { mulberry32 } from '../logic/rng'
import { bakeModel, type BakedLamps } from './bake'
import type { Model3D } from './model'

export type LampSource = {
  model: string
  lamps: BakedLamps
  matrices: THREE.Matrix4[] // 每個擺放一個
  positions: Array<[number, number]> // 每個擺放的 (x, z),算沿步道的位置用
}

// 會投影的模型(樹、屋、路燈、竹);小石頭、灌木、貓不投影,省陰影 pass
const CASTS = /^(deco-tree|deco-house|deco-street-lamp|deco-bamboo|deco-stall)/

export function buildScatter(
  placements: ReadonlyArray<Placement & { y: number }>,
  models: Record<string, Model3D>,
  opts: { shadows: boolean },
): { group: THREE.Group; lampSources: LampSource[]; heights: Map<string, number> } {
  const group = new THREE.Group()
  const lampSources: LampSource[] = []
  const heights = new Map<string, number>()
  const byModel = new Map<string, Array<Placement & { y: number }>>()
  for (const p of placements) {
    if (!models[p.model]) continue
    const arr = byModel.get(p.model) ?? []
    arr.push(p)
    byModel.set(p.model, arr)
  }
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const qTilt = new THREE.Quaternion()
  const eTilt = new THREE.Euler()
  const s = new THREE.Vector3()
  const pos = new THREE.Vector3()

  for (const [name, list] of byModel) {
    const baked = bakeModel(models[name])
    heights.set(name, baked.height)
    const matrices = list.map((p, i) => {
      const r = mulberry32((p.seed ?? i) * 7919 + 13)
      const sc = (p.scale ?? 1) * (0.93 + r() * 0.14)
      e.set(0, p.rotY ?? r() * Math.PI * 2, 0)
      q.setFromEuler(e)
      // 貼坡:先繞自己的上方轉 rotY,再整個傾斜到坡面法線
      if (p.tilt) q.premultiply(qTilt.setFromEuler(eTilt.set(p.tilt[0], 0, p.tilt[1])))
      m4.compose(pos.set(p.x, p.y, p.z), q, s.set(sc, sc, sc))
      return m4.clone()
    })
    const jitter = list.map((p, i) => 0.94 + mulberry32((p.seed ?? i) * 31 + 5)() * 0.12)

    for (const solid of baked.solids) {
      const mat = new THREE.MeshStandardMaterial({ color: solid.color, flatShading: true, roughness: 0.88, metalness: 0 })
      const mesh = new THREE.InstancedMesh(solid.geo, mat, matrices.length)
      const c = new THREE.Color()
      matrices.forEach((m, i) => { mesh.setMatrixAt(i, m); mesh.setColorAt(i, c.setScalar(jitter[i])) })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.castShadow = opts.shadows && CASTS.test(name)
      mesh.receiveShadow = true
      mesh.frustumCulled = false // 實例分佈在整座島,以單一幾何的包圍盒裁切會誤殺
      group.add(mesh)
    }
    if (baked.lamps) lampSources.push({ model: name, lamps: baked.lamps, matrices, positions: list.map((p) => [p.x, p.z]) })
  }
  return { group, lampSources, heights }
}
