// colliders.ts——由「擺在島上的模型」算出人物會撞到的固體(three 渲染層,探索模式第一次進入時建構一次)。
//
// 每個模型的每個網格部件,取它的包圍盒轉到世界座標,投影到平面成凸多邊形;只收「人身高度帶」裡的實心部件:
// 離腳底太高(屋簷、燈串、招牌在頭頂)、太低(地板、貼地的花紋)、太薄(平面)、發光的(燈籠、窗)都不收。
// 站點的石階模型整個略過:人走在石階上的高度與路徑由步道剖面決定(見 walkWorld.ts),石階兩側的牆靠高度差限制擋住。
import * as THREE from 'three'
import { convexHull, type Poly } from '../logic/walk'
import { buildModel, placementScale, type Model3D } from './model'

export type ColliderPlacement = { model: string; x: number; y: number; z: number; rotY?: number; scale?: number }

// 不擋人的模型:會動或很小的(貓、蒸氣、燈籠)、頭頂的(燈串)。石階(走在上面)不列在這裡:
// 有宣告 coversPath(自己畫路面)的模型一律不擋人,豎崎路長短兩版與之後新增的石階都適用
const NO_COLLIDE = /^(deco-cat|deco-steam|deco-lantern-red|deco-lantern-string|deco-street-lamp|traveler-)/

// 部件名稱是「路面/地板/階梯」的不算固體:人走在它上面(輕便路模型的路面是一段段會抬高的方塊)
const NO_COLLIDE_PART = /^(road|ground|floor|path|step|stair)/i

// 人身高度帶(相對模型原點的腳底,單位:世界格):部件的垂直範圍要和 [BAND_LO, BAND_HI] 重疊才算擋
export const BAND_LO = 0.35
export const BAND_HI = 1.8
const MIN_THICKNESS = 0.12

export function placementPolys(model: Model3D, p: ColliderPlacement): Poly[] {
  // 高細節 GLB 是「每個材質合併成一個網格」,逐網格取包圍盒會讓藤蔓、屋簷、台階各變成整棟大小的實心方塊(隱形牆)。
  // 所以有宣告式版本(parts)時,碰撞一律用它(輪廓是設計好的近似);只有宣告式沒有內容時才退回 GLB。
  const built = buildModel(model.glb && model.parts.length > 0 ? { ...model, glb: undefined } : model)
  built.root.position.set(p.x, p.y, p.z)
  built.root.rotation.y = p.rotY ?? 0
  built.root.scale.setScalar(placementScale(model, p.scale))
  built.root.updateMatrixWorld(true)
  const out: Poly[] = []
  const v = new THREE.Vector3()
  built.root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const mat = mesh.material as THREE.MeshStandardMaterial
    if (mat.emissive && mat.emissive.getHex() !== 0) return
    if (NO_COLLIDE_PART.test(mesh.name)) return
    mesh.geometry.computeBoundingBox()
    const b = mesh.geometry.boundingBox!
    const pts: Array<[number, number]> = []
    let yMin = Infinity, yMax = -Infinity
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      v.set(x, y, z).applyMatrix4(mesh.matrixWorld)
      pts.push([v.x, v.z])
      yMin = Math.min(yMin, v.y)
      yMax = Math.max(yMax, v.y)
    }
    const lo = yMin - p.y, hi = yMax - p.y
    if (hi - lo < MIN_THICKNESS || hi < BAND_LO || lo > BAND_HI) return
    out.push(convexHull(pts))
  })
  return out
}

export function buildColliderPolys(placements: ReadonlyArray<ColliderPlacement>, models: Readonly<Record<string, Model3D>>): Poly[] {
  const out: Poly[] = []
  for (const p of placements) {
    const m = models[p.model]
    if (!m || m.coversPath || NO_COLLIDE.test(p.model)) continue
    out.push(...placementPolys(m, p))
  }
  return out
}
