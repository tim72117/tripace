// 2026-10-26 接上 routeLineLayer:步行段沿路徑畫左右腳印(樣式在 routeStyle.ts 的 routeFootprintOptions,縮放等級由 useSharedDrawLayer 傳入)。
// 原本由已移除的 routePolylineLayer(行程詳情頁)使用,2026-10-24 統一連線樣式時一度沒有呼叫端,現在三個入口共用。
//
// footprintIcon——腳印圖示的 SVG path(google.maps.Symbol.path 吃的是 SVG path 字串),給步行路線沿路徑重複排列用。
//
// 座標以原點為兩腳中線、腳尖朝 -y(Google 地圖折線上的圖示會自動旋轉成沿路徑前進方向,圖示「朝上」就是前進方向,
// 跟 FORWARD_CLOSED_ARROW 的箭頭尖端朝前是同一個約定)。一隻腳:腳掌輪廓(圓潤的腳跟、內側有足弓的凹弧、前掌最寬)
// 加五顆腳趾(大拇趾最大、往外側依序變小並逐顆下移)。以「右腳」為基準畫,左腳是鏡像;兩腳各自往兩側偏移 LATERAL、
// 並向外轉 TOE_OUT 度(走路時腳尖微微朝外),沿路徑交錯排列(見 routePolylineLayer 的兩組 icons)就像一步一步走過去。
// 尺寸約 7 寬 × 17 高(單位是 Symbol 的 scale 乘上去之前的 path 座標)。
const LATERAL = 2.4
const TOE_OUT = 7 // 度

type Pt = [number, number]

// 把右腳基準座標轉成指定那隻腳的座標:先向外轉 TOE_OUT 度(繞腳掌中心 (0, 0.5)),左腳再鏡像,最後往該側偏移。
function transform(side: -1 | 1) {
  const rad = (TOE_OUT * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return ([x, y]: Pt): Pt => {
    const dy = y - 0.5
    const rx = x * cos - dy * sin
    const ry = x * sin + dy * cos + 0.5
    return [+(rx * side + side * LATERAL).toFixed(2), +ry.toFixed(2)]
  }
}

// 右腳基準:腳掌輪廓(三次貝茲曲線)與五顆腳趾(圓心與半徑)。內側(x 負)是大拇趾那一側。
const SOLE: { start: Pt; curves: [Pt, Pt, Pt][] } = {
  start: [-2.3, -3.1],
  curves: [
    [[-2.5, -5.3], [1.3, -5.9], [2.4, -4.1]], // 前掌上緣,從內側繞到外側
    [[3.3, -2.7], [2.6, 0.6], [2.2, 2.5]], // 外側邊緣往腳跟
    [[1.9, 5.1], [1.6, 7.7], [-0.2, 7.7]], // 腳跟外側到底
    [[-2.0, 7.7], [-2.2, 5.3], [-1.8, 3.3]], // 腳跟內側往上
    [[-1.5, 1.7], [-0.4, 0.3], [-1.0, -1.2]], // 足弓(內側凹弧)
    [[-1.4, -2.3], [-2.3, -2.0], [-2.3, -3.1]], // 回到前掌內側
  ],
}
const TOES: { c: Pt; r: number }[] = [
  { c: [-1.4, -7.0], r: 1.45 }, // 大拇趾
  { c: [0.35, -7.9], r: 1.0 },
  { c: [1.7, -7.4], r: 0.92 },
  { c: [2.75, -6.4], r: 0.8 },
  { c: [3.45, -5.2], r: 0.66 }, // 小趾
]

function foot(side: -1 | 1): string {
  const t = transform(side)
  const p = (pt: Pt) => t(pt).join(',')
  const sole =
    `M${p(SOLE.start)} ` +
    SOLE.curves.map(([a, b, c]) => `C${p(a)} ${p(b)} ${p(c)}`).join(' ') +
    ' Z'
  const toe = ({ c, r }: { c: Pt; r: number }) => {
    const [cx, cy] = t(c)
    return `M${(cx - r).toFixed(2)},${cy} A${r},${r} 0 1,0 ${(cx + r).toFixed(2)},${cy} A${r},${r} 0 1,0 ${(cx - r).toFixed(2)},${cy} Z`
  }
  return [sole, ...TOES.map(toe)].join(' ')
}

export const FOOTPRINT_LEFT = foot(-1)
export const FOOTPRINT_RIGHT = foot(1)

// footprintSpacing——腳印的間距與大小隨地圖縮放調整。icons 的 repeat 是螢幕像素,固定不變的話:拉近時(路徑在螢幕上變長)
// 腳印多又擠、拉遠時(路徑變短)腳印少又稀。改成跟著 zoom:拉近 → 間距與腳印變大(同一段路上腳印數不會暴增),
// 拉遠 → 間距與腳印變小(短短的路徑上仍有幾步)。基準是 zoom 15 時間距 40px、scale 1,每放大一級間距乘 1.35,
// 間距限制在 20–120px、scale 限制在 0.6–1.6(太小看不清、太大像貼紙)。
export const FOOTPRINT_REFERENCE_ZOOM = 15
const BASE_SPACING_PX = 40
const SPACING_PER_ZOOM = 1.35

export function footprintSpacing(zoom: number): { stepPx: number; repeatPx: number; scale: number } {
  const stepPx = Math.min(120, Math.max(20, BASE_SPACING_PX * SPACING_PER_ZOOM ** (zoom - FOOTPRINT_REFERENCE_ZOOM)))
  const scale = Math.min(1.6, Math.max(0.6, stepPx / BASE_SPACING_PX))
  // 左右腳各一組 icons,repeat 是兩隻腳的週期(= 2 步),offset 錯開一步。
  return { stepPx, repeatPx: stepPx * 2, scale }
}
