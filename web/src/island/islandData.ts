// islandData.ts——島的資料組裝:場景資料(版面、模型、文章)→ 站點(純資料與純邏輯,不 import three)。
//
// 場景資料由 scenes/registry 動態載入(只含該版面用到的模型);完整版(IslandPage/mountIsland)與縮小版
// (mini/loadMini,首頁 hero 用)共用同一個載入與快取,不各自再載入一次。
import { articleToIsland, displayableStops } from './logic/articleToIsland'
import { validateLayout } from './logic/validateLayout'
import { loadScene } from './scenes/registry'
import type { SceneData } from './scenes/types'

// buildIslandData——純函式:已載入的場景資料 → 引擎與 HUD 要的資料。
export function buildIslandData(scene: SceneData) {
  const island = articleToIsland(scene.article, scene.layout, scene.byline)
  const issues = [
    ...validateLayout(scene.layout, new Set(Object.keys(scene.models)), island.stops.map((s) => s.stopId)),
    ...island.issues,
  ]
  // stops:島上實際會顯示的站(過濾後的唯一清單)——HUD 與 3D 場景都用它,「第 i 站」才會指向同一站
  return {
    layout: scene.layout,
    models: scene.models,
    island,
    stops: displayableStops(island.stops, scene.models),
    issues,
    controlY: scene.pathPointY,
    slug: scene.article.slug,
  }
}

export type IslandData = ReturnType<typeof buildIslandData>

export async function loadIslandData(sceneId: string): Promise<IslandData> {
  return buildIslandData(await loadScene(sceneId))
}
