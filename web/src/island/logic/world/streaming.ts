// streaming.ts——每格的串流與 LOD 狀態(純函式)。執行端(three/world/cellRuntime.ts)依結果開關格子、切換細節。
//
// 做法同 Unreal World Partition 的串流半徑與 WoC 的 far_lod_latch:
//   - 距離 = 鏡頭焦點到格子矩形的水平距離(grid.ts distanceToCell),在格內為 0
//   - 載入:距離 ≤ loadRadius 時載入,> unloadRadius 才卸載(unloadRadius > loadRadius,中間是緩衝區,
//     鏡頭在邊界附近晃動時格子不會反覆建了又拆)
//   - LOD:lodDistances 由小到大,第一個 > 距離的索引就是等級(0 = 最細);每個門檻也有 lodHysteresis 的緩衝
//   - hlodDistance:比它遠的格子改用整格合併的替身(HLOD),本體不畫
import { distanceToCell, type CellId, type WorldGrid } from './grid'

export type StreamingConfig = {
  loadRadius: number
  unloadRadius: number
  lodDistances: number[]
  lodHysteresis: number
  hlodDistance: number
}

// 預設:小場景全部載入、全部最細(框架先接好,數值之後依場景大小調)
export const DEFAULT_STREAMING: StreamingConfig = {
  loadRadius: Infinity,
  unloadRadius: Infinity,
  lodDistances: [],
  lodHysteresis: 4,
  hlodDistance: Infinity,
}

export type CellState = { loaded: boolean; lod: number; hlod: boolean }

export function lodFor(distance: number, prevLod: number, cfg: StreamingConfig): number {
  const ds = cfg.lodDistances
  let lod = ds.findIndex((d) => distance < d)
  if (lod < 0) lod = ds.length
  // 緩衝:往粗的方向切要多超過 lodHysteresis,往細的方向切要多進來 lodHysteresis
  if (lod > prevLod && distance < ds[prevLod] + cfg.lodHysteresis) return prevLod
  if (lod < prevLod && distance > ds[prevLod - 1] - cfg.lodHysteresis) return prevLod
  return lod
}

export function nextCellState(grid: WorldGrid, cell: CellId, x: number, z: number, prev: CellState | undefined, cfg: StreamingConfig): CellState {
  const d = distanceToCell(grid, cell, x, z)
  const wasLoaded = prev?.loaded ?? false
  const loaded = wasLoaded ? d <= cfg.unloadRadius : d <= cfg.loadRadius
  const lod = lodFor(d, prev?.lod ?? 0, cfg)
  const hlod = prev?.hlod ? d > cfg.hlodDistance - cfg.lodHysteresis : d > cfg.hlodDistance
  return { loaded, lod, hlod }
}
