// loadMini.ts——縮小版的「重」部分(three、模型、版面)全部放在這個模組,由首頁 HeroIsland 動態 import:
// 載入排程之前不會下載 three 與模型,首頁因此不會被拖慢(heroIslandBundle.test.ts 守住這條邊界)。
import { ISLAND_LAYOUT, PATH_POINT_Y } from '../data/layout'
import { MODELS } from '../islandData'
import { MiniIsland, type MiniOptions } from './MiniIsland'

export function createMini(o: Pick<MiniOptions, 'container' | 'theme' | 'reducedMotion' | 'onContextLost' | 'onContextRestored'>): MiniIsland {
  return new MiniIsland({ ...o, layout: ISLAND_LAYOUT, models: MODELS, controlY: PATH_POINT_Y })
}
