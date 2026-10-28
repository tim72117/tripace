// data.ts——「夜遊九份」場景的重資料(版面、文章、專屬模型載入器)。只由 index.ts 動態 import,
// 進到這個場景才下載;不要從別處靜態 import(會把版面與文章拉進首屏或別的場景)。
import article from './article.json'
import { ISLAND_LAYOUT, PATH_POINT_Y } from './layout'
import type { ArticleSource } from '../../logic/articleToIsland'
import type { Model3D } from '../../three/model'
import type { SceneModule } from '../types'

const scene: SceneModule = {
  layout: ISLAND_LAYOUT,
  article: article as unknown as ArticleSource,
  // 署名:文章資料只有 ownerId,沒有顯示名稱;網址 /u/tim72117/night-jiufen 的 handle 是作者的帳號名稱。
  byline: { name: 'tim72117', handle: 'tim72117', articleUrl: '/u/tim72117/night-jiufen' },
  pathPointY: PATH_POINT_Y,
  modelLoaders: import.meta.glob<Model3D>('./models/*.ts', { import: 'default' }),
}

export default scene
