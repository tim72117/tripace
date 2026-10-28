// loadMini.ts——縮小版的「重」部分(three、模型、版面)全部放在這個模組,由首頁 HeroIsland 動態 import:
// 載入排程之前不會下載 three 與模型,首頁因此不會被拖慢(heroIslandBundle.test.ts 守住這條邊界)。
// 首頁固定放預設場景;場景資料用 registry 動態載入(只含版面用到的模型),所以 createMini 是非同步的。
import { loadScene, DEFAULT_SCENE_ID } from '../scenes/registry'
import { MiniIsland, type MiniOptions } from './MiniIsland'

export async function createMini(o: Pick<MiniOptions, 'container' | 'theme' | 'reducedMotion' | 'onContextLost' | 'onContextRestored'>): Promise<MiniIsland> {
  const scene = await loadScene(DEFAULT_SCENE_ID)
  return new MiniIsland({ ...o, layout: scene.layout, models: scene.models, controlY: scene.pathPointY })
}
