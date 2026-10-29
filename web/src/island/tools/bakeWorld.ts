// bakeWorld.ts——烘焙:執行場景的程序化規則,把結果依格子寫進 world/cells/*.json(手擺的保留)。
// 執行:cd web && npm run island:bake -- <sceneId>(見 web/scripts/island-world.mjs)
import { assembleScene, bakeCells, type CellPlacement } from '../logic/world/sceneFormat'
import { readWorld, worldDir, writeCells } from './worldFs'
import type { AssembledScene } from '../logic/world/sceneFormat'

// 各場景的規則(新場景在這裡登記)。用動態 import,場景規則只在烘焙時載入。
const RULES: Record<string, () => Promise<{ generatePlacements(scene: AssembledScene): CellPlacement[] }>> = {
  'night-jiufen': () => import('../scenes/night-jiufen/rules'),
}

export async function bake(sceneId: string): Promise<{ cells: number; rule: number; hand: number }> {
  const load = RULES[sceneId]
  if (!load) throw new Error(`場景 ${sceneId} 沒有程序化規則(在 tools/bakeWorld.ts 的 RULES 登記)`)
  const dir = worldDir(sceneId)
  const files = readWorld(dir)
  const scene = assembleScene(files)
  const generated = (await load()).generatePlacements(scene)
  const cells = bakeCells(files.scene.grid, files.cells, generated)
  writeCells(dir, cells)
  const all = cells.flatMap((c) => c.placements)
  return { cells: cells.length, rule: all.filter((p) => p.source === 'rule').length, hand: all.filter((p) => p.source === 'hand').length }
}
