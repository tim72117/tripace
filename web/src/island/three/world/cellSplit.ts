// cellSplit.ts——把非索引三角形網格依三角形中心點分到世界格子(執行時切塊,做法同 WoC 的地形分塊)。
// 每格成為獨立的 BufferGeometry,各自有包圍球,three 的視錐剔除才能整格略過。
// 三角形不切開(依中心點歸屬),所以格子邊界是鋸齒狀,但相鄰格子共用同一批頂點座標,不會有縫。
import * as THREE from 'three'
import { cellKey, cellOf, type WorldGrid } from '../../logic/world/grid'

export const DEFAULT_GRID: WorldGrid = { cellSize: 32 }

export function splitByCell(geo: THREE.BufferGeometry, grid: WorldGrid): Map<string, THREE.BufferGeometry> {
  if (geo.index) throw new Error('splitByCell 只接受非索引幾何(每個三角形 3 個獨立頂點)')
  const pos = geo.getAttribute('position')
  const names = Object.keys(geo.attributes)
  const buckets = new Map<string, number[]>() // 格子鍵 → 三角形索引
  for (let t = 0; t < pos.count / 3; t++) {
    const cx = (pos.getX(t * 3) + pos.getX(t * 3 + 1) + pos.getX(t * 3 + 2)) / 3
    const cz = (pos.getZ(t * 3) + pos.getZ(t * 3 + 1) + pos.getZ(t * 3 + 2)) / 3
    const k = cellKey(cellOf(grid, cx, cz))
    const arr = buckets.get(k) ?? []
    arr.push(t)
    buckets.set(k, arr)
  }
  const out = new Map<string, THREE.BufferGeometry>()
  for (const [k, tris] of [...buckets].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const g = new THREE.BufferGeometry()
    for (const name of names) {
      const src = geo.getAttribute(name)
      const size = src.itemSize
      const arr = new Float32Array(tris.length * 3 * size)
      tris.forEach((t, i) => {
        for (let v = 0; v < 3; v++) for (let c = 0; c < size; c++) arr[(i * 3 + v) * size + c] = src.array[(t * 3 + v) * size + c]
      })
      g.setAttribute(name, new THREE.BufferAttribute(arr, size))
    }
    g.computeBoundingSphere()
    out.set(k, g)
  }
  return out
}
