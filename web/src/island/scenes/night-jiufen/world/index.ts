// world/index.ts——「夜遊九份」的場景資料(檔案格式見 logic/world/sceneFormat.ts,編輯方式見同目錄 README.md)。
// 各層 JSON 與 cells/ 在這裡組成引擎用的 IslandLayout。cells/ 的程序化部分由 ../rules.ts 烘焙產生,不要手改
// source 為 "rule" 的筆數(下次烘焙會被覆蓋);手擺的請寫 source "hand"。
import type { CellFile, SceneFiles } from '../../../logic/world/sceneFormat'
import { assembleScene } from '../../../logic/world/sceneFormat'
import { heightAt } from '../../../logic/terrain'
import camera from './camera.json'
import lighting from './lighting.json'
import paths from './paths.json'
import scene from './scene.json'
import stops from './stops.json'
import terrain from './terrain.json'

const cells = Object.values(import.meta.glob<CellFile>('./cells/*.json', { eager: true, import: 'default' }))

export const NIGHT_JIUFEN = assembleScene({ scene, terrain, paths, stops, camera, lighting, cells } as unknown as SceneFiles)

export const ISLAND_LAYOUT = NIGHT_JIUFEN.layout
// 與 path.points 一一對應的腳底高度(石階段地面被切溝壓低在踏面之下,所以高度要明確給,不能由地形推)
export const PATH_POINT_Y = NIGHT_JIUFEN.pathPointY

// 某點的地表高度(與渲染層、貼地物件用同一個函式)
export function groundY(x: number, z: number): number {
  return heightAt(ISLAND_LAYOUT, x, z)
}
