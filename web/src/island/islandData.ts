// islandData.ts——島的資料組裝:模型、版面、部落客文章 → 站點(純資料與純邏輯,不 import three)。
//
// 完整版(IslandPage/mountIsland)與縮小版(mini/loadMini,首頁 hero 用)共用同一份資料,
// 不各自再載入一次。模型檔只用 `import type` 引用 three 的型別,執行期不帶 three。
import article from './data/night-jiufen.json'
import { ISLAND_LAYOUT, PATH_POINT_Y } from './data/layout'
import { articleToIsland, displayableStops, type ArticleSource, type Byline } from './logic/articleToIsland'
import { validateLayout } from './logic/validateLayout'
import type { Model3D } from './three/model'

const modelModules = import.meta.glob<Model3D>('./models/*.ts', { eager: true, import: 'default' })
// 模型:./models/<name>.ts 的 default export,檔名即模型 id
export const MODELS: Record<string, Model3D> = Object.fromEntries(
  Object.entries(modelModules).map(([path, m]) => [path.replace(/^.*\/(.+)\.ts$/, '$1'), m]),
)

export const ISLAND_SOURCE = article as unknown as ArticleSource
// 署名:文章資料只有 ownerId,沒有顯示名稱;網址 /u/tim72117/night-jiufen 的 handle 是作者的帳號名稱。
export const ISLAND_BYLINE: Byline = { name: 'tim72117', handle: 'tim72117', articleUrl: '/u/tim72117/night-jiufen' }

export function loadIslandData() {
  const island = articleToIsland(ISLAND_SOURCE, ISLAND_LAYOUT, ISLAND_BYLINE)
  const issues = [
    ...validateLayout(ISLAND_LAYOUT, new Set(Object.keys(MODELS)), island.stops.map((s) => s.stopId)),
    ...island.issues,
  ]
  // stops:島上實際會顯示的站(過濾後的唯一清單)——HUD 與 3D 場景都用它,「第 i 站」才會指向同一站
  return { layout: ISLAND_LAYOUT, models: MODELS, island, stops: displayableStops(island.stops, MODELS), issues, controlY: PATH_POINT_Y }
}
