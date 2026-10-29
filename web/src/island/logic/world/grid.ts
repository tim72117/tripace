// grid.ts——世界格子規格(純函式,不 import three)。
//
// 大型場景的所有系統都用同一套空間切分(做法同 Unreal World Partition 的格子、WoC 的地形分塊):
//   - 編輯時:擺放物件一格一檔(scenes/<id>/world/cells/<ix>_<iz>.json,見 sceneFormat.ts)
//   - 執行時:地形、散落物依格子各自成組,做剔除、串流、LOD(見 three/world/cellRuntime.ts)
//   - 程序化擺放:每格的亂數種子由「圖層種子 + 格子座標」決定(cellSeed),重烤一格不影響其他格
// 格子以世界原點對齊,邊長 cellSize(公尺,1 格 = 1 m)。格子 (ix, iz) 涵蓋 [ix·s, (ix+1)·s) × [iz·s, (iz+1)·s)。
import { mulberry32 } from '../rng'

export type WorldGrid = { cellSize: number }
export type CellId = { ix: number; iz: number }
export type CellBounds = { minX: number; minZ: number; maxX: number; maxZ: number }

export function cellOf(grid: WorldGrid, x: number, z: number): CellId {
  return { ix: Math.floor(x / grid.cellSize), iz: Math.floor(z / grid.cellSize) }
}

// 檔名與 Map 鍵用同一個格式,例如 "-2_1"
export function cellKey(c: CellId): string {
  return `${c.ix}_${c.iz}`
}

export function parseCellKey(key: string): CellId {
  const m = /^(-?\d+)_(-?\d+)$/.exec(key)
  if (!m) throw new Error(`格子鍵格式錯誤:${key}(應為 <ix>_<iz>,例如 -2_1)`)
  return { ix: Number(m[1]), iz: Number(m[2]) }
}

export function cellBounds(grid: WorldGrid, c: CellId): CellBounds {
  const s = grid.cellSize
  return { minX: c.ix * s, minZ: c.iz * s, maxX: (c.ix + 1) * s, maxZ: (c.iz + 1) * s }
}

export function cellCenter(grid: WorldGrid, c: CellId): [number, number] {
  const s = grid.cellSize
  return [(c.ix + 0.5) * s, (c.iz + 0.5) * s]
}

// 與一個矩形範圍重疊的所有格子(依 iz、ix 排序,輸出穩定)
export function cellsInBounds(grid: WorldGrid, b: CellBounds): CellId[] {
  const a = cellOf(grid, b.minX, b.minZ)
  const z = cellOf(grid, b.maxX, b.maxZ)
  const out: CellId[] = []
  for (let iz = a.iz; iz <= z.iz; iz++) for (let ix = a.ix; ix <= z.ix; ix++) out.push({ ix, iz })
  return out
}

// 點到格子矩形的水平距離(在格子內 = 0):串流與 LOD 用它判斷格子遠近,比用格子中心穩定
export function distanceToCell(grid: WorldGrid, c: CellId, x: number, z: number): number {
  const b = cellBounds(grid, c)
  const dx = Math.max(b.minX - x, 0, x - b.maxX)
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ)
  return Math.hypot(dx, dz)
}

// cellSeed——某圖層在某格的亂數種子:同一個 (layerSeed, ix, iz) 永遠得到同一個值,與其他格、其他圖層無關
export function cellSeed(layerSeed: number, c: CellId): number {
  let h = Math.imul(layerSeed | 0, 0x9e3779b1) ^ Math.imul(c.ix | 0, 0x85ebca6b) ^ Math.imul(c.iz | 0, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return (h ^ (h >>> 16)) >>> 0
}

export function cellRng(layerSeed: number, c: CellId): () => number {
  return mulberry32(cellSeed(layerSeed, c))
}

// layerSeed——由圖層名稱與場景種子得出圖層種子(manifest 沒指定 seed 時用)
export function layerSeed(sceneSeed: number, layer: string): number {
  let h = sceneSeed >>> 0
  for (let i = 0; i < layer.length; i++) h = Math.imul(h ^ layer.charCodeAt(i), 16777619) >>> 0
  return h
}
