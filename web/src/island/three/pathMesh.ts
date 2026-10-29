// pathMesh.ts——步道帶狀網格(貼地、高度平滑、帶石階條紋),以及「弧長 → 地面高度」查詢。
//
// 契約的步道只有平面座標,高度由階地高度推得:沿曲線取樣 heightAt,再做移動平均把階地交界的
// 垂直落差變成緩坡(旅人不會瞬間跳高),貼圖用橫向條紋暗示一級一級的石階。
import * as THREE from 'three'
import type { IslandLayout, Placement } from '../data/layoutTypes'
import type { PathCurve } from '../logic/pathCurve'
import { buildPathProfile } from '../logic/pathProfile'
import { placementScale, type Model3D } from './model'

// 步道經過自己畫路面的模型(石階)時沉進模型裡的深度(m):比一階踢面深,斜坡才不會在每一階後段穿出踏面
const COVERED_SINK = 0.3

// pathCoverTest——(x, z) 是否落在某個 coversPath 模型(石階)的範圍內。模型的 -Z/+Z 是長度方向,rotY 依 three 的 rotation.y。
export function pathCoverTest(placements: ReadonlyArray<Placement>, models: Record<string, Model3D>): (x: number, z: number) => boolean {
  const covers = placements.flatMap((p) => {
    const m = models[p.model]
    if (!m?.coversPath) return []
    return [{ p, k: placementScale(m, p.scale), c: Math.cos(p.rotY ?? 0), s: Math.sin(p.rotY ?? 0), ...m.coversPath }]
  })
  return (x, z) => covers.some(({ p, k, c, s, halfWidth, halfLength }) => {
    const dx = x - p.x, dz = z - p.z
    const lx = (dx * c - dz * s) / k, lz = (dx * s + dz * c) / k
    return Math.abs(lx) <= halfWidth && Math.abs(lz) <= halfLength
  })
}

export type PathMesh = {
  mesh: THREE.Mesh
  // heightAtArc——弧長 s 處的步道面高度(旅人腳底高度用)
  heightAtArc(s: number): number
}

function stoneTexture(base: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = base
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = 'rgba(0,0,0,0.13)'
  g.fillRect(0, 0, 64, 6) // 每個重複單位一條「踏面邊緣」的暗帶
  g.fillStyle = 'rgba(255,255,255,0.07)'
  g.fillRect(0, 6, 64, 10)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// controlY——選填:與 layout.path.points 一一對應的腳底高度(Fable 的版面另外匯出 PATH_POINT_Y)。
// 有的話用它沿弧長線性內插步道高度(石階爬升比由階地高度推得更準);沒有就由 heightAt 推。
export function buildPathMesh(
  layout: IslandLayout,
  curve: PathCurve,
  heightAt: (x: number, z: number) => number,
  controlY?: ReadonlyArray<number>,
  covered?: (x: number, z: number) => boolean,
): PathMesh {
  const profile = buildPathProfile(layout.path.points, curve, heightAt, controlY)
  const profileY = (s: number, x: number, z: number): number => profile.at(s, x, z)
  const half = layout.path.width / 2
  const step = 1 // 每 1 格取一個樣
  const n = Math.max(2, Math.ceil(curve.length / step))
  const arcs: number[] = []
  const ys: number[] = []
  for (let i = 0; i <= n; i++) {
    const s = (curve.length * i) / n
    const p = curve.at(s)
    arcs.push(s)
    ys.push(profileY(s, p.x, p.z))
  }
  // 移動平均(半徑 3 個樣本)把「由地形推出」的高度落差變緩坡。有 controlY 時剖面本身就是分段線性、已經是緩坡,
  // 不再平滑:平滑會把平台接下坡石階的轉折削低(例如基山街 9.4 接豎崎路下坡),路面就離開地面與踏面。
  const R = profile.hasControl ? 0 : 3
  const smooth = ys.map((_, i) => {
    let sum = 0, cnt = 0
    for (let k = -R; k <= R; k++) { const j = i + k; if (j >= 0 && j <= n) { sum += ys[j]; cnt++ } }
    return sum / cnt
  })

  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  arcs.forEach((s, i) => {
    const p = curve.at(s)
    const ox = -p.dirZ * half
    const oz = p.dirX * half
    const y = smooth[i] + (covered?.(p.x, p.z) ? -COVERED_SINK : 0.06)
    pos.push(p.x + ox, y, p.z + oz, p.x - ox, y, p.z - oz)
    uv.push(0, s / 1.88, 1, s / 1.88)
    if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  const mat = new THREE.MeshStandardMaterial({
    map: stoneTexture(layout.palette.path),
    roughness: 1,
    flatShading: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  const mesh = new THREE.Mesh(g, mat)
  mesh.receiveShadow = true

  return {
    mesh,
    heightAtArc(s) {
      const q = Math.max(0, Math.min(curve.length, s))
      const f = (q / curve.length) * n
      const i = Math.min(n - 1, Math.floor(f))
      const t = f - i
      return smooth[i] * (1 - t) + smooth[i + 1] * t + 0.06
    },
  }
}
