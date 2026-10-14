// mapleLeafPath.ts——楓葉 SVG 路徑常數(2026-10 新增)。原本只有
// AiItineraryDetailPageMapView.tsx 的楓葉相框(MapleLeafBorder)在用,
// 2026-10 新增秋日泡湯卡片主題(renderOnsenAutumnStopCard.tsx)後,卡片
// 上的楓葉圖樣也要用同一組幾何,所以抽到這個獨立小模組——不能直接從
// AiItineraryDetailPageMapView.tsx export:那個檔案本身就 import 卡片
// 渲染器,反向引用會形成循環依賴。
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
