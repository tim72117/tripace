// sceneFormat.ts——場景檔案格式(資料檔,JSON)與組裝(純函式,不 import three)。
//
// 一個場景 = 一個目錄 scenes/<id>/world/,依用途分層(類似 Unreal 的 Data Layers)、擺放物件依空間一格一檔
// (類似 World Partition 的格子):
//
//   scene.json         清單:格式版本、格子規格、場景種子、各程序化圖層的設定、島的厚度/海/河
//   terrain.json       地形層:外形輪廓 + 高度場參數(ramp/features/noise/pads)
//   paths.json         步道層:折線 [x, z, 腳底高度] 與寬度
//   stops.json         站點層:文章各站的錨點
//   camera.json        鏡頭層:封面與各站的導覽鏡頭
//   lighting.json      光線層:日夜關鍵時刻與色票
//   cells/<ix>_<iz>.json  擺放物件:每格一檔,每筆標明圖層(layer)與來源(source)
//
// source: 'hand' = 手擺,烘焙時保留;'rule' = 程序化規則烘焙的結果(scenes/<id>/rules.ts),重烤時整批替換。
// 規則讀其他各層的資料決定擺放,輸出寫回 cells/(做法同 Unreal PCG 在編輯器生成後存檔);執行時只讀資料。
import type { IslandLayout, LayoutCamera, LightKey, PadSpec, Placement, Pt, StopAnchor, TerrainSpec } from '../../data/layoutTypes'
import { baseFieldAt } from '../heightfield'
import { pointInPolygon } from '../geometry'
import { cellBounds, cellKey, cellOf, parseCellKey, type WorldGrid } from './grid'

export const SCENE_FORMAT_VERSION = 1

export type LayerConfig = { seed?: number }

export type SceneManifest = {
  format: number
  id: string
  grid: WorldGrid
  seed: number // 場景種子:圖層沒指定 seed 時,由它與圖層名稱推出(grid.ts 的 layerSeed)
  layers: Record<string, LayerConfig> // 程序化擺放的圖層(名稱 → 設定),順序即規則執行順序
  topY: number
  thickness: number
  sea?: { y: number; color: string }
  river: { points: Pt[]; width: number }
}

// 平台:y 寫 'auto' = 取範圍內原地形的平均(每 autoPadY.sample 取樣、取到 autoPadY.step 的倍數)
export type PadFile = Omit<PadSpec, 'y'> & { id: string; kind?: string; y: number | 'auto' }
export type TerrainFile = {
  outline: Pt[]
  terrain: Omit<TerrainSpec, 'pads'> & { pads?: PadFile[] }
  autoPadY?: { sample: number; step: number }
}
export type PathsFile = { width: number; points: Array<[number, number, number]> }
export type StopsFile = { stops: StopAnchor[] }
export type CameraFile = LayoutCamera
export type LightingFile = { keys: LightKey[]; palette: IslandLayout['palette'] }

export type PlacementSource = 'hand' | 'rule'
export type CellPlacement = Placement & { layer: string; source: PlacementSource }
export type CellFile = { format: number; cell: string; placements: CellPlacement[] }

export type SceneFiles = {
  scene: SceneManifest
  terrain: TerrainFile
  paths: PathsFile
  stops: StopsFile
  camera: CameraFile
  lighting: LightingFile
  cells: CellFile[]
}

export type AssembledScene = {
  manifest: SceneManifest
  layout: IslandLayout
  pathPointY: number[]
  pads: Array<PadFile & { y: number }> // 平台(y 已解出),規則依 id/kind 取用
}

// autoPadY——平台範圍內原地形的平均高度
export function autoPadY(terrain: TerrainFile['terrain'], outline: Pt[], sample: number, step: number): number {
  const xs = outline.map((p) => p[0])
  const zs = outline.map((p) => p[1])
  let sum = 0
  let n = 0
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += sample) {
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += sample) {
      if (pointInPolygon(x, z, outline)) { sum += baseFieldAt({ ...terrain, pads: [] }, x, z); n++ }
    }
  }
  if (n === 0) throw new Error('autoPadY:平台範圍內沒有任何取樣點(平台太小或 sample 太大)')
  return Math.round(sum / n / step) * step
}

// 檢查格子檔:檔名 = 格子鍵、每筆擺放都落在自己的格子內、圖層有在清單登記
export function validateCells(manifest: SceneManifest, cells: CellFile[]): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const f of cells) {
    if (f.format !== SCENE_FORMAT_VERSION) errors.push(`cells/${f.cell}.json:格式版本 ${f.format} 不支援`)
    if (seen.has(f.cell)) errors.push(`cells/${f.cell}.json:重複的格子`)
    seen.add(f.cell)
    const id = parseCellKey(f.cell)
    const b = cellBounds(manifest.grid, id)
    f.placements.forEach((p, i) => {
      if (p.x < b.minX || p.x >= b.maxX || p.z < b.minZ || p.z >= b.maxZ) errors.push(`cells/${f.cell}.json[${i}] ${p.model} (${p.x}, ${p.z}) 不在這一格內`)
      if (p.source === 'rule' && !(p.layer in manifest.layers)) errors.push(`cells/${f.cell}.json[${i}] 圖層 ${p.layer} 沒有在 scene.json 登記`)
    })
  }
  return errors
}

export function assembleScene(f: SceneFiles): AssembledScene {
  if (f.scene.format !== SCENE_FORMAT_VERSION) throw new Error(`scene.json 格式版本 ${f.scene.format} 不支援(目前 ${SCENE_FORMAT_VERSION})`)
  const errors = validateCells(f.scene, f.cells)
  if (errors.length) throw new Error(`場景 ${f.scene.id} 的格子檔有誤:\n${errors.join('\n')}`)
  const auto = f.terrain.autoPadY
  const pads = (f.terrain.terrain.pads ?? []).map((p) => {
    if (p.y !== 'auto') return { ...p, y: p.y }
    if (!auto) throw new Error(`terrain.json 平台 ${p.id} 的 y 是 auto,但沒有設定 autoPadY`)
    return { ...p, y: autoPadY(f.terrain.terrain, p.outline, auto.sample, auto.step) }
  })
  const terrain: TerrainSpec = { ...f.terrain.terrain, pads: pads.map(({ outline, y, blend, color }) => ({ outline, y, blend, color })) }
  // 擺放依格子鍵排序後串接,輸出穩定(與檔案載入順序無關)
  const scatter = [...f.cells].sort((a, b) => (a.cell < b.cell ? -1 : a.cell > b.cell ? 1 : 0)).flatMap((c) => c.placements)
  const layout: IslandLayout = {
    grid: f.scene.grid,
    outline: f.terrain.outline,
    topY: f.scene.topY,
    terrain,
    camera: f.camera,
    sea: f.scene.sea,
    thickness: f.scene.thickness,
    river: f.scene.river,
    path: { points: f.paths.points.map(([x, z]) => [x, z] as Pt), width: f.paths.width },
    stops: f.stops.stops,
    scatter,
    lighting: f.lighting.keys,
    palette: f.lighting.palette,
  }
  return { manifest: f.scene, layout, pathPointY: f.paths.points.map(([, , y]) => y), pads }
}

// 把擺放依格子分檔(烘焙輸出用)。existing 裡 source = 'hand' 的保留,'rule' 的由 generated 整批替換。
export function bakeCells(grid: WorldGrid, existing: CellFile[], generated: CellPlacement[]): CellFile[] {
  const byCell = new Map<string, CellPlacement[]>()
  const push = (p: CellPlacement) => {
    const k = cellKey(cellOf(grid, p.x, p.z))
    const arr = byCell.get(k) ?? []
    arr.push(p)
    byCell.set(k, arr)
  }
  for (const f of existing) for (const p of f.placements) if (p.source === 'hand') push(p)
  for (const p of generated) push({ ...p, source: 'rule' })
  return [...byCell.keys()].sort().map((cell) => ({ format: SCENE_FORMAT_VERSION, cell, placements: byCell.get(cell)! }))
}
