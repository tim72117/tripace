// pathMesh.ts——步道帶狀網格(貼地、高度平滑、帶石階條紋),以及「弧長 → 地面高度」查詢。
//
// 契約的步道只有平面座標,高度由階地高度推得:沿曲線取樣 heightAt,再做移動平均把階地交界的
// 垂直落差變成緩坡(旅人不會瞬間跳高),貼圖用橫向條紋暗示一級一級的石階。
import * as THREE from 'three'
import type { IslandLayout } from '../data/layoutTypes'
import type { PathCurve } from '../logic/pathCurve'

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
): PathMesh {
  const ctrlArcs = controlY && controlY.length === layout.path.points.length
    ? layout.path.points.map(([x, z]) => curve.nearestArc(x, z))
    : null
  const profileY = (s: number, x: number, z: number): number => {
    if (!ctrlArcs || !controlY) return heightAt(x, z)
    if (s <= ctrlArcs[0]) return controlY[0]
    for (let i = 0; i < ctrlArcs.length - 1; i++) {
      if (s <= ctrlArcs[i + 1]) {
        const span = ctrlArcs[i + 1] - ctrlArcs[i]
        const t = span <= 0 ? 1 : (s - ctrlArcs[i]) / span
        return controlY[i] + (controlY[i + 1] - controlY[i]) * t
      }
    }
    return controlY[controlY.length - 1]
  }
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
  // 移動平均(半徑 3 個樣本)把落差變緩坡
  const R = 3
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
    const y = smooth[i] + 0.06
    pos.push(p.x + ox, y, p.z + oz, p.x - ox, y, p.z - oz)
    uv.push(0, s / 1.2, 1, s / 1.2)
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
