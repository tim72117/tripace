// available.ts——首頁一開始就能「同步」知道島能不能顯示(不必等頁面 load 與閒置)。
//
// 為什麼要提早:島開啟時 hero 的版面是「文字靠上、下面留一塊給島」,關閉時是「文字垂直置中」。
// 如果等到 load 之後才發現不能顯示(省流量、沒有 WebGL),文字會在 1~3 秒後從靠上突然跳回置中
// ——對這些使用者是明顯的版面位移。省流量與 WebGL 都能同步判斷,所以放在第一次 render 就決定。
// (版位大小要等 CSS 套用才量得到,見 HeroIsland.tsx 的 useLayoutEffect,同樣在畫面繪製之前。)
import { heroIslandMode, probeWebgl, readSaveData } from './mode'

export function heroIslandAvailableAtStart(): boolean {
  // 版位大小此時未知,傳 Infinity 表示「不因大小而關閉」;減少動態不影響可不可用(只畫靜止一幀)
  return heroIslandMode({ saveData: readSaveData(), webgl: probeWebgl(), sizePx: Infinity, reducedMotion: false }) !== 'off'
}
