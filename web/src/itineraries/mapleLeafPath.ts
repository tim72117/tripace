// mapleLeafPath.ts——楓葉 SVG 路徑常數(2026-10 新增)。目前只有秋日泡湯卡片主題
// (renderOnsenAutumnStopCard.tsx)用它畫卡片上的楓葉圖樣。原本地圖外框的楓葉相框
// (MapleLeafBorder)也共用這組幾何,2026-10-27 該相框移除,留下這個獨立小模組。
//
// MAPLE_LEAF_PATH——單片楓葉輪廓,100x100 座標系、葉心在 (50,50)、葉柄
// 朝下(76→94)。五裂掌狀、鋸齒尖角用折線畫,配合 stroke-linejoin:round
// 讓尖角不會太銳利;刻意不用 Q/C 曲線精修——這個裝飾在畫面上只有幾十
// px,曲線細節看不出差異,折線反而讓路徑好讀好改。
export const MAPLE_LEAF_PATH =
  'M50 8 L56 24 L68 16 L64 32 L82 30 L72 44 L90 52 L72 58 L78 74 L62 68 ' +
  'L58 86 L50 76 L42 86 L38 68 L22 74 L28 58 L10 52 L28 44 L18 30 L36 32 ' +
  'L32 16 L44 24 Z'
export const MAPLE_STEM_PATH = 'M50 76 L50 94'
