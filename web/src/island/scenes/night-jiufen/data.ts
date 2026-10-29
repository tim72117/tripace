// data.ts——「夜遊九份」場景的重資料(版面、文章、專屬模型載入器)。只由 index.ts 動態 import,
// 進到這個場景才下載;不要從別處靜態 import(會把版面與文章拉進首屏或別的場景)。
import article from './article.json'
import teahouseUrl from './assets/amei-teahouse.glb?url'
import stoneStepsUrl from './assets/stone-steps-5.glb?url'
import stoneStepsLandingUrl from './assets/stone-steps-landing.glb?url'
import { ISLAND_LAYOUT, PATH_POINT_Y } from './world'
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
  // 高細節版(Blender 腳本產出,一律以公尺建模、放進場景不換算;宣告式後備版的 unit 對齊同一個真實尺寸)
  glbModels: {
    'stop-amei-teahouse': { url: teahouseUrl }, // tools/blender/amei_teahouse.py
    'deco-stone-steps': { url: stoneStepsUrl }, // tools/blender/stone_steps.py 的 steps-5
    'deco-stone-steps-landing': { url: stoneStepsLandingUrl }, // 同上,5 階+平台+5 階
  },
}

export default scene
