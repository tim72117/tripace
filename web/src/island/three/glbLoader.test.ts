import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { describe, expect, it } from 'vitest'
import { pointInPolygon } from '../logic/geometry'
import { ISLAND_LAYOUT } from '../scenes/night-jiufen/world'
import { placementPolys } from './colliders'
import { EMISSIVE_DIVISOR, prepareGlbScene } from './glbLoader'
import { collectLanternAnchors } from './stopLanterns'
import { buildModel, type Model3D } from './model'

// 阿妹茶樓的高細節版(Blender 腳本產出)。用真實檔案驗證:尺寸、發光、與版面的配合,而不是只測假資料。
const file = readFileSync(resolve(process.cwd(), 'src/island/scenes/night-jiufen/assets/amei-teahouse.glb')) // 測試從 web/ 目錄執行
const parse = () =>
  new Promise<THREE.Object3D>((ok, fail) => {
    // 在測試環境自己建緩衝區:Node 的 Buffer 切出來的 ArrayBuffer 在 jsdom 下 `instanceof ArrayBuffer` 為 false,GLTFLoader 會誤判格式
    const buf = new ArrayBuffer(file.byteLength)
    new Uint8Array(buf).set(file)
    new GLTFLoader().parse(buf, '', (g) => ok(g.scene), fail)
  })
const UNIT = 1 / 11
const triangles = (root: THREE.Object3D) => {
  let n = 0
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) n += m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3 })
  return n
}
const emissiveMats = (root: THREE.Object3D) => {
  const out: THREE.MeshStandardMaterial[] = []
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { const mat = m.material as THREE.MeshStandardMaterial; if (mat.emissive.getHex() !== 0) out.push(mat) } })
  return out
}

describe('阿妹茶樓 GLB(真實檔案)', () => {
  it('尺寸與原點:約 11.5 公尺高、腳底在 y = 0,正面朝 +z', async () => {
    const box = new THREE.Box3().setFromObject(await parse())
    expect(box.max.y - box.min.y).toBeGreaterThan(11)
    expect(box.max.y - box.min.y).toBeLessThan(12.2)
    expect(Math.abs(box.min.y)).toBeLessThan(0.02)
    // 正面(窗與門)朝 +z:台階在 +z 側,所以 +z 方向比 -z 方向突出得多
    expect(box.max.z).toBeGreaterThan(Math.abs(box.min.z) - 0.5)
  })
  it('面數與材質有上限,不會悄悄變重', async () => {
    const root = await parse()
    expect(triangles(root)).toBeLessThan(60000)
    const mats = new Set<THREE.Material>()
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) mats.add(m.material as THREE.Material) })
    expect(mats.size).toBeLessThanOrEqual(16)
  })
  it('有窗光發光材質(燈籠已改成錨點,不在 GLB 裡);載入處理把強度換算成島上的基準', async () => {
    const root = await parse()
    const before = emissiveMats(root).map((m) => m.emissiveIntensity)
    expect(before.length).toBeGreaterThanOrEqual(1)
    expect(Math.max(...before)).toBeGreaterThan(2) // Blender 的強度(窗光 2.4)
    prepareGlbScene(root)
    const after = emissiveMats(root).map((m) => m.emissiveIntensity)
    after.forEach((v, i) => expect(v).toBeCloseTo(before[i] / EMISSIVE_DIVISOR, 6))
    expect(Math.max(...after)).toBeLessThan(1) // 島上「基準 × (0.2 + 2.2 × 日夜強度)」的基準約 0.6
  })
  it('燈籠是錨點(lantern_*,空節點)不是幾何:數量合理、都落在建築範圍內、沒有「lantern」材質的網格', async () => {
    const root = await parse()
    const anchors = collectLanternAnchors(root)
    expect(anchors.length).toBeGreaterThanOrEqual(20)
    expect(anchors.length).toBeLessThanOrEqual(60)
    const box = new THREE.Box3().setFromObject(root).expandByScalar(1.5)
    for (const m of anchors) expect(box.containsPoint(new THREE.Vector3().setFromMatrixPosition(m))).toBe(true)
    const mats = new Set<string>()
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) mats.add((m.material as THREE.Material).name) })
    expect([...mats].some((n) => /lantern/i.test(n))).toBe(false)
  })
  it('buildModel:有 glb 就用它(根節點內以模型單位表示,擺放乘上 unit 後是公尺),沒有 glb 還是畫宣告式後備', async () => {
    const scene = prepareGlbScene(await parse())
    const decl: Model3D = { parts: [{ name: 'box', shape: { type: 'box', size: [1, 1, 1] }, position: [0, 0.5, 0] }] }
    const withGlb = new THREE.Box3().setFromObject(buildModel({ ...decl, unit: 1 / UNIT, glb: { scene } }).root)
    expect(withGlb.max.y).toBeCloseTo(11.5 * UNIT, 1) // 約 1.05:跟宣告式版(高約 1)同一個尺度
    const meshes: string[] = []
    buildModel({ ...decl, unit: 1 / UNIT, glb: { scene } }).root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o.name) })
    expect(meshes).not.toContain('box') // 宣告式的部件沒有被一起畫(不重疊)
    const fallback = new THREE.Box3().setFromObject(buildModel(decl).root)
    expect(fallback.max.y).toBeCloseTo(1, 5)
  })
  it('放在版面的錨點上:主體完全落在地形平台內,探索模式有碰撞體', async () => {
    const scene = prepareGlbScene(await parse())
    const stop = ISLAND_LAYOUT.stops.find((s) => s.model === 'stop-amei-teahouse')!
    const pad = ISLAND_LAYOUT.terrain!.pads!.find((p) => pointInPolygon(stop.x, stop.z, p.outline))!
    expect(pad).toBeTruthy()
    const k = stop.scale ?? 1 // GLB 是公尺:主體 11 × 5.6 公尺
    for (const [x, z] of [[-5.5, -2.8], [5.5, -2.8], [5.5, 2.8], [-5.5, 2.8]]) {
      expect(pointInPolygon(stop.x + x * k, stop.z + z * k, pad.outline)).toBe(true)
    }
    const polys = placementPolys({ parts: [], unit: 1 / UNIT, glb: { scene } }, { model: stop.model, x: stop.x, y: pad.y, z: stop.z, rotY: stop.rotY, scale: stop.scale })
    expect(polys.length).toBeGreaterThan(0)
  })
})
