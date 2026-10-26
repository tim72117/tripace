// bake.ts——把宣告式 Model3D「烘焙」成可實例化的靜態幾何。
//
// Model3D 是多部件 Group,直接放 150 個就是上千次繪製呼叫。這裡把一個模型的所有部件烘進世界矩陣,
// 依「材質顏色」分組、合併成一個幾何(每組之後可做成一個 InstancedMesh);有發光(emissive)的部件
// 另外收集成「燈」幾何(帶頂點色),交給燈籠層做逐盞亮起。部件動畫(sway/swing)在烘焙後會凍結在
// 初始姿態——散落的裝飾不需要動,動畫只保留在站點建築與旅人(它們直接用 buildModel 的 Group)。
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { buildModel, type Model3D } from './model'

export type BakedSolid = { color: THREE.Color; geo: THREE.BufferGeometry }
export type BakedLamps = {
  geo: THREE.BufferGeometry // 合併後的燈幾何,頂點色 = 燈亮時的顏色
  centers: THREE.Vector3[] // 每個燈部件的中心(模型空間),光暈用
}
export type BakedModel = { solids: BakedSolid[]; lamps: BakedLamps | null; height: number }

function cleaned(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ni = g.index ? g.toNonIndexed() : g
  // 只保留 position/normal:不同形狀的 uv 等屬性集合不一致會讓 mergeGeometries 回傳 null
  for (const name of Object.keys(ni.attributes)) if (name !== 'position' && name !== 'normal') ni.deleteAttribute(name)
  return ni
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(list, false)
  if (!m) throw new Error('mergeGeometries 失敗:幾何屬性不一致')
  return m
}

export function bakeModel(model: Model3D): BakedModel {
  const built = buildModel(model)
  built.root.updateMatrixWorld(true)
  const byColor = new Map<string, { color: THREE.Color; geos: THREE.BufferGeometry[] }>()
  const lampGeos: THREE.BufferGeometry[] = []
  const centers: THREE.Vector3[] = []
  const box = new THREE.Box3()

  built.root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const mat = mesh.material as THREE.MeshStandardMaterial
    const g = cleaned(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld))
    g.computeBoundingBox()
    box.union(g.boundingBox!)
    if (mat.emissive && mat.emissive.getHex() !== 0) {
      const n = g.attributes.position.count
      const colors = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) colors.set([mat.emissive.r, mat.emissive.g, mat.emissive.b], i * 3)
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      lampGeos.push(g)
      centers.push(g.boundingBox!.getCenter(new THREE.Vector3()))
    } else {
      const key = mat.color.getHexString()
      const entry = byColor.get(key) ?? { color: mat.color.clone(), geos: [] }
      entry.geos.push(g)
      byColor.set(key, entry)
    }
  })

  return {
    solids: [...byColor.values()].map(({ color, geos }) => ({ color, geo: merge(geos) })),
    lamps: lampGeos.length ? { geo: merge(lampGeos), centers } : null,
    height: Number.isFinite(box.max.y) ? box.max.y : 1,
  }
}
