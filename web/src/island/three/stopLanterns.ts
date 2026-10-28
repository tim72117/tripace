// stopLanterns.ts——站點建築上的紅燈籠:建築 GLB 不含燈籠幾何,只有一批名稱以 lantern_ 開頭的空節點(錨點,Blender 腳本用
// kit.anchor 放),這裡讀出錨點的世界矩陣,用兩個 InstancedMesh(發光的燈身、不發光的蓋子/吊繩/掛鉤)一次畫完所有燈籠。
// 好處:GLB 少掉每盞燈的幾何(檔案變小)、繪製呼叫從幾十個降成 2 個、燈籠外觀集中在這一處調整。
//
// 燈籠幾何固定(對齊 tools/blender/amei_teahouse.py 的 lantern():r = 0.24、h = 0.36,單位公尺,原點在燈身中心);
// 錨點的矩陣已包含建築的縮放(GLB 單位換算、站點 scale)與旋轉,所以實例直接用世界矩陣。
// 燈身的發光材質由 stops.ts 收進 glowMats,隨站點亮度日夜連動(與原本 GLB 裡的發光材質同一個機制)。
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export const LANTERN_ANCHOR_PREFIX = 'lantern_'
// 燈身發光強度的基準:Blender 的 3.0 除以 glbLoader 的 EMISSIVE_DIVISOR(4),維持與原本 GLB 燈籠相同的亮度。
export const LANTERN_GLOW_BASE = 0.75

const COLORS = { gold: '#c9a24a', red: '#a02620', wood: '#4a2f22', body: '#d63a2f', glow: '#ff4a2a' }

// collectLanternAnchors——找出場景裡的燈籠錨點(名稱前綴相符、沒有網格的節點),回傳它們的世界矩陣(呼叫前要 updateMatrixWorld)。
export function collectLanternAnchors(root: THREE.Object3D): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = []
  root.updateWorldMatrix(true, true)
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh && o.name.startsWith(LANTERN_ANCHOR_PREFIX)) out.push(o.matrixWorld.clone())
  })
  return out
}

function part(geo: THREE.BufferGeometry, y: number, color: string): THREE.BufferGeometry {
  geo.translate(0, y, 0)
  const c = new THREE.Color(color)
  const n = geo.getAttribute('position').count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return geo
}

// buildLanternGeometries——燈身(橢球)與其餘部件(上下金蓋、紅吊繩、木掛鉤,頂點色)。
export function buildLanternGeometries(): { body: THREE.BufferGeometry; trim: THREE.BufferGeometry } {
  const r = 0.24, h = 0.36
  const body = new THREE.SphereGeometry(1, 12, 7)
  body.scale(r, h / 2, r)
  const rod = (len: number, w: number, y: number, color: string) => part(new THREE.CylinderGeometry(w, w, len, 4), y, color)
  const trimParts = [
    part(new THREE.CylinderGeometry(0.06, 0.07, 0.06, 8), h / 2 + 0.03, COLORS.gold), // 上蓋
    part(new THREE.CylinderGeometry(0.05, 0.06, 0.05, 8), -h / 2 - 0.02, COLORS.gold), // 下蓋
    rod(0.22, 0.025, -h / 2 - 0.15, COLORS.red), // 下方吊穗
    rod(0.24, 0.015, h / 2 + 0.18, COLORS.wood), // 上方掛鉤
  ].map((g) => (g.index ? g.toNonIndexed() : g))
  const trim = mergeGeometries(trimParts, false)!
  trimParts.forEach((g) => g.dispose())
  return { body, trim }
}

export type StopLanterns = {
  group: THREE.Group
  bodyMaterial: THREE.MeshStandardMaterial // 發光燈身材質:由呼叫端依站點亮度調 emissiveIntensity
}

// buildStopLanterns——anchors 為空回 null。幾何與材質由這個物件自己擁有(場景卸載時 disposeObject 會釋放)。
export function buildStopLanterns(anchors: ReadonlyArray<THREE.Matrix4>): StopLanterns | null {
  if (anchors.length === 0) return null
  const { body, trim } = buildLanternGeometries()
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: COLORS.body, emissive: COLORS.glow, emissiveIntensity: LANTERN_GLOW_BASE, roughness: 0.5 })
  const trimMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 })
  const bodies = new THREE.InstancedMesh(body, bodyMaterial, anchors.length)
  const trims = new THREE.InstancedMesh(trim, trimMaterial, anchors.length)
  anchors.forEach((m, i) => { bodies.setMatrixAt(i, m); trims.setMatrixAt(i, m) })
  for (const mesh of [bodies, trims]) {
    mesh.instanceMatrix.needsUpdate = true
    mesh.castShadow = false // 很小,不投影,省陰影 pass
    mesh.frustumCulled = false // InstancedMesh 的包圍球只算基底幾何,實例散在整棟建築上,不剔除(只有 2 次繪製呼叫)
  }
  bodies.name = 'stop-lantern-bodies'
  trims.name = 'stop-lantern-trims'
  return { group: new THREE.Group().add(bodies, trims), bodyMaterial }
}
