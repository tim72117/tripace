// worldFs.ts——在 Node 讀寫場景目錄(scenes/<id>/world/)。只給烘焙腳本與測試用,瀏覽器不會載入。
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { CellFile, SceneFiles } from '../logic/world/sceneFormat'

// 場景目錄(相對 web/)
export function worldDir(sceneId: string): string {
  return resolve(process.cwd(), 'src/island/scenes', sceneId, 'world')
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

export function readWorld(dir: string): SceneFiles {
  const cellsDir = join(dir, 'cells')
  let cellNames: string[] = []
  try { cellNames = readdirSync(cellsDir).filter((n) => n.endsWith('.json')) } catch { cellNames = [] }
  return {
    scene: readJson(join(dir, 'scene.json')),
    terrain: readJson(join(dir, 'terrain.json')),
    paths: readJson(join(dir, 'paths.json')),
    stops: readJson(join(dir, 'stops.json')),
    camera: readJson(join(dir, 'camera.json')),
    lighting: readJson(join(dir, 'lighting.json')),
    cells: cellNames.sort().map((n) => readJson<CellFile>(join(cellsDir, n))),
  }
}

// 一筆擺放一行,diff 才看得出改了哪一筆(多人改不同格子時也不會互相衝突)
export function formatCell(c: CellFile): string {
  const rows = c.placements.map((p) => `    ${JSON.stringify(p)}`).join(',\n')
  return `{\n  "format": ${c.format},\n  "cell": ${JSON.stringify(c.cell)},\n  "placements": [\n${rows}\n  ]\n}\n`
}

export function writeJson(path: string, data: unknown): void {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
}

// 寫出全部格子檔;不再有內容的格子檔刪除
export function writeCells(dir: string, cells: CellFile[]): void {
  const cellsDir = join(dir, 'cells')
  mkdirSync(cellsDir, { recursive: true })
  const keep = new Set(cells.map((c) => `${c.cell}.json`))
  for (const n of readdirSync(cellsDir)) if (n.endsWith('.json') && !keep.has(n)) rmSync(join(cellsDir, n))
  for (const c of cells) writeFileSync(join(cellsDir, `${c.cell}.json`), formatCell(c))
}
