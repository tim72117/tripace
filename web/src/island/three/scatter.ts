// scatter.ts——裝飾散落物 → BatchedMesh(依「材質 × 是否投影」一批)。
//
// 輸入是 scatterResolve 避障貼地後的位置。每種模型烘焙一次(bake.ts),同材質參數的部件不論模型、顏色都放進同一個
// BatchedMesh(顏色存在每個實例上),所以整座島只有幾次繪製呼叫;BatchedMesh 會逐個實例做視錐剔除
// (做法類似 Unreal 的 HISM),鏡頭外的實例不送 GPU。燈(emissive 部件)不在這裡畫,收集成 LampSource 交給燈籠層。
// cellInstances 記下每個世界格子有哪些實例,給 three/world/cellRuntime.ts 做串流(整格開關)。
import * as THREE from 'three'
import type { Placement } from '../data/layoutTypes'
import { mulberry32 } from '../logic/rng'
import { bakeModel, type BakedLamps, type BakedSolid as BakeSolid } from './bake'
import { cellKey, cellOf, type WorldGrid } from '../logic/world/grid'
import { placementScale, type Model3D } from './model'
import { DEFAULT_GRID } from './world/cellSplit'

export type CellInstance = { mesh: THREE.BatchedMesh; id: number }

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
  opts: { shadows: boolean; grid?: WorldGrid },
): { group: THREE.Group; lampSources: LampSource[]; heights: Map<string, number>; cellInstances: Map<string, CellInstance[]> } {
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

  // 第一輪:烘焙每種模型、算矩陣;依材質參數分批,統計每批的實例數與頂點數(BatchedMesh 要先決定容量)
  type Entry = { name: string; solid: BakeSolid; matrices: THREE.Matrix4[]; jitter: number[]; cells: string[] }
  const batches = new Map<string, { smooth: boolean; rough?: number; metal?: number; casts: boolean; entries: Entry[]; instances: number; vertices: number }>()
  const grid = opts.grid ?? DEFAULT_GRID
  for (const [name, list] of byModel) {
    const baked = bakeModel(models[name])
    heights.set(name, baked.height)
    const matrices = list.map((p, i) => {
      const r = mulberry32((p.seed ?? i) * 7919 + 13)
      const sc = placementScale(models[name], p.scale) * (0.93 + r() * 0.14)
      e.set(0, p.rotY ?? r() * Math.PI * 2, 0)
      q.setFromEuler(e)
      // 貼坡:先繞自己的上方轉 rotY,再整個傾斜到坡面法線
      if (p.tilt) q.premultiply(qTilt.setFromEuler(eTilt.set(p.tilt[0], 0, p.tilt[1])))
      m4.compose(pos.set(p.x, p.y, p.z), q, s.set(sc, sc, sc))
      return m4.clone()
    })
    const jitter = list.map((p, i) => 0.94 + mulberry32((p.seed ?? i) * 31 + 5)() * 0.12)

    const cells = list.map((p) => cellKey(cellOf(grid, p.x, p.z)))
    const casts = opts.shadows && CASTS.test(name)
    for (const solid of baked.solids) {
      const key = `${solid.smooth ? 's' : 'f'}|${solid.rough ?? ''}|${solid.metal ?? ''}|${casts ? 'c' : ''}`
      const b = batches.get(key) ?? { smooth: solid.smooth, rough: solid.rough, metal: solid.metal, casts, entries: [], instances: 0, vertices: 0 }
      b.entries.push({ name, solid, matrices, jitter, cells })
      b.instances += matrices.length
      b.vertices += solid.geo.getAttribute('position').count
      batches.set(key, b)
    }
    if (baked.lamps) lampSources.push({ model: name, lamps: baked.lamps, matrices, positions: list.map((p) => [p.x, p.z]) })
  }

  // 第二輪:每批一個 BatchedMesh;同一個部件幾何只加一次,每個擺放一個實例(矩陣 + 顏色 × 亮度抖動)
  const cellInstances = new Map<string, CellInstance[]>()
  const c = new THREE.Color()
  for (const b of batches.values()) {
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: !b.smooth, roughness: b.rough ?? 0.88, metalness: b.metal ?? 0 })
    const mesh = new THREE.BatchedMesh(b.instances, b.vertices, b.vertices, mat)
    for (const e of b.entries) {
      const geoId = mesh.addGeometry(e.solid.geo)
      e.matrices.forEach((m, i) => {
        const id = mesh.addInstance(geoId)
        mesh.setMatrixAt(id, m)
        mesh.setColorAt(id, c.copy(e.solid.color).multiplyScalar(e.jitter[i]))
        const list = cellInstances.get(e.cells[i]) ?? []
        list.push({ mesh, id })
        cellInstances.set(e.cells[i], list)
      })
    }
    mesh.computeBoundingBox()
    mesh.computeBoundingSphere()
    mesh.castShadow = b.casts
    mesh.receiveShadow = true
    group.add(mesh)
  }
  return { group, lampSources, heights, cellInstances }
}
