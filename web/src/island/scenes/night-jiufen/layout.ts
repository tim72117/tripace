// 「夜遊九份」島的版面資料。內容由部落客文章（docs/source-night-jiufen.json）的四站生成，
// 這個檔案只負責「放在哪裡、長什麼樣」。型別契約見 ../../data/layoutTypes.ts。
//
// 地形:連續高度場(layout.terrain),2026-10 取代原本的同心橢圓階地(像環形山)。設計與數值驗證見
// docs/refactor-island-terrain-2026-10.md(第 10 節是目前採用的第二版)。構圖:一整面朝海傾斜的山坡——前緣(+z,南,朝鏡頭)
// 是低平的海岸,往後(-z)約 17° 往上到後山主稜,東北側是基隆山的圓錐;兩道山溝把山城與旁邊的山體分開;房子蓋在
// 沿等高線、彼此錯開的削平屋排上。路線的高度關係接近真實九份(憑印象):基山街在山腰中上段(全島最高的街)沿等高線橫走,
// 豎崎路從基山街往南「下坡」到輕便路口,輕便路在下方沿等高線緩升,再接一小段石階往北上到阿妹茶樓所在的肩(在豎崎路中段西側,
// 不是最高點)。步道因此先下再上。
// 方位是刻意旋轉的:真實九份大約面北,這裡把海放在南方(+z)讓封面鏡頭正對山城(憑印象,見設計文件第 0、9 節)。
//
// 座標:俯視,北在 -z 、+x 東、+z 南(朝鏡頭)。外形是前寬後窄的盾形,不是圓。
//
// 散落物(scatter)全部用固定種子的亂數在這裡「計算」:房子沿屋排長軸排、燈籠沿步道與屋排前緣、
// 松林在高處坡面,並要求腳印落在平的地面(平台上)。輸出 deterministic,每次載入都一樣。
//
// 步道高度：契約的 Pt 只有 (x, z)。另外匯出 PATH_POINT_Y（與 path.points 一一對應的腳底高度），
// 讓旅人走石階時能平順爬升(石階段地面被切溝壓低在踏面之下,所以高度要明確給,不能由地形推)。
import type { IslandLayout, LayoutCamera, LightKey, Placement, Pt, StopAnchor, TerrainSpec } from '../../data/layoutTypes'
import { baseFieldAt } from '../../logic/heightfield'
import { heightAt } from '../../logic/terrain'

// ---------------------------------------------------------------------------
// 固定種子亂數
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20261012)
const range = (min: number, max: number) => min + rand() * (max - min)
const round2 = (n: number) => Math.round(n * 100) / 100
const TAU = Math.PI * 2

// ---------------------------------------------------------------------------
// 外形與地形
// ---------------------------------------------------------------------------

const TOP_Y = -2.5 // 最低地面(海岸的底),比海面(-3.5)高 1 格

// 42 點,順時針(俯視、北在 -z):從東端開始,沿東側往南、沿前緣往西、沿西側往北、沿背面往東繞回
const OUTLINE: Pt[] = [
  // 東側(含東側溪谷出海的小灣 x≈38, z 11~16)
  [46, -6], [45.5, 1], [43, 7], [38.5, 11], [38, 16], [35.5, 21], [31, 25],
  // 前緣海岸(南,朝鏡頭):中央 (5, 34.5) 是最突出的岬,(-5, 32) 一個小灣
  [26, 28], [20.5, 30], [15, 31.5], [10, 33.5], [5, 34.5], [0, 33.5], [-5, 32], [-9, 33], [-14, 32.5], [-19, 31], [-24, 29.5], [-28, 28],
  // 西側(含西側山溝出海的海灣 x -32~-36, z 24~25)
  [-32, 25], [-36.5, 24], [-39.5, 20], [-42.5, 14.5], [-45, 8.5], [-46, 2], [-46, -5], [-45, -12], [-43, -18], [-40, -23],
  // 背面(北):沿主稜後方收邊
  [-35, -27], [-28, -30], [-20, -32], [-12, -33], [-4, -33.5], [4, -33], [12, -32.5], [20, -31.5], [27, -30], [33, -27], [38, -23], [42, -18], [45, -12],
]

type PadDef = { id: string; outline: Pt[]; y: number | null; blend: number; color: string }

const ROW_COLOR = '#857a62' // 屋排:夯土、石砌地基
const ROAD_COLOR = '#9a9286' // 道路
const PLAZA_COLOR = '#a39a7a' // 石板廣場

// 屋排(y 不寫 = 取範圍內原地形的平均,見 padY;改 ramp/features 後不用手動對齊)。順序即套用順序,後面的蓋前面的。
const ROWS: Array<[string, Pt[]]> = [
  ['R1a', [[-27, 19.8], [-11, 19.4], [-11, 22.6], [-26, 23.2]]], // 海側屋排西(最靠鏡頭的屋頂)
  ['R1b', [[-8, 19.6], [5, 19.9], [5, 22.9], [-8, 22.7]]], // 海側屋排中
  ['R1c', [[9, 19.2], [23, 18.6], [22, 21.8], [9, 22.2]]], // 海側屋排東
  ['R2e', [[23.5, 12.4], [29, 12], [29, 16.2], [23.5, 16.4]]], // 昇平戲院廣場東側的民宅(原本橫跨整段,縮短讓出廣場)
  ['R2w', [[-24, 15.6], [-12, 15.2], [-12, 18.2], [-24, 18.6]]], // 輕便路下方的民宅
  ['R3w', [[-22, 8.6], [-14.5, 8.7], [-14.5, 11.5], [-22, 11.4]]], // 西側第一排(東半段讓給茶樓肩與小石階)
  ['R3e', [[22.5, 7.6], [28, 7.2], [28, 10.2], [22.5, 10.6]]], // 昇平戲院東側第一排(縮短讓出戲院)
  ['R4w', [[-25, 3.4], [-15, 3.6], [-15, 6.4], [-24, 6.4]]], // 西側第二排
  ['R4e', [[11, 3.3], [26, 2.4], [26, 5.5], [11, 6.2]]], // 石階東側第二排
  ['R8w', [[-31, 1.6], [-26, 1.4], [-26, 4.4], [-31, 4.6]]], // 西翼屋排(西側山溝邊)
  ['R5e', [[12, -2.6], [25, -3.8], [25, -7], [12, -6]]], // 基山街東延
  ['R5m', [[-4, -8.2], [9, -6.4], [9, -9.4], [-4, -11]]], // 基山街店屋後方一排
  ['R7w', [[-34, -6], [-25, -6.4], [-25, -9.4], [-33, -9.2]]], // 西坡
  ['R6', [[-6, -13.4], [14, -11.6], [14, -14.6], [-6, -16.4]]], // 上段屋排(山腰以上最高的一排民宅)
  ['R7m', [[-22, -13], [-9, -12.8], [-9, -15.8], [-21, -16.2]]], // 上段屋排西
]

// 道路與站點平台(y 手寫:要和石階爬升量對齊,P3 = P2 + 6.02、P5 = P2 + 1.5、P6 = P5 + 2.15)。輕便路刻意沒有 pad,
// 改用 F9 路塹讓地面整段低於路面。
const ROADS: PadDef[] = [
  { id: 'P1', outline: [[-29, 24.8], [22, 24.4], [22, 27], [-28, 27.2]], y: 0.0, blend: 3, color: ROAD_COLOR }, // 濱海公路(風景,不在步道上)
  { id: 'P0', outline: [[-30, -1], [-19, -1.4], [-19, 1.5], [-29, 1.8]], y: 7.5, blend: 2, color: ROAD_COLOR }, // 汽車路入口(步道起點、公車站)
  { id: 'P3', outline: [[-15, -4.4], [-6, -4.6], [4, -4.2], [10.5, -3.6], [10.5, 0.7], [3, 0.9], [-6, 1.4], [-15, 1.2]], y: 9.4, blend: 2.5, color: ROAD_COLOR }, // 基山街(站①)+ 豎崎路頂
  { id: 'P2', outline: [[-2, 15], [1.5, 14.6], [11, 14.4], [11, 18], [1.5, 18], [-2, 17]], y: 3.4, blend: 2.5, color: ROAD_COLOR }, // 豎崎路底/輕便路口
  { id: 'P5', outline: [[-11.5, 11.4], [-8.5, 11.4], [-8.5, 13.4], [-11.5, 13.4]], y: 4.9, blend: 1.5, color: ROAD_COLOR }, // 輕便路西端/小石階底
  // 茶樓肩(站④與前方觀景小平台),L 形。blend 刻意只給 1.0:更大會把小石階上段兩側的地面抬高、穿出踏面;
  // 與 P3 只隔 1.2 格、高差 2.35,會做出一道陡的擋土坡(茶樓背後貼著基山街的那道牆)
  { id: 'P6', outline: [[-13, 2.6], [1.8, 2.6], [1.8, 9.4], [-7, 9.4], [-7, 7.0], [-13, 7.0]], y: 7.05, blend: 1.0, color: PLAZA_COLOR },
  // 昇平戲院廣場(風景地標,不是文章站點):豎崎路底(輕便路口)的東側,與 P2 同高連成一片。切 2.7、填 1.8;
  // 戲院背後約 3 格的陡坡,太突兀的話把北緣從 8.4 改到 9.0、戲院 z 改成 11.9(設計見文件第 11 節)。
  { id: 'P7', outline: [[11, 8.4], [21.5, 8.2], [22, 18], [11, 18]], y: 3.4, blend: 2, color: PLAZA_COLOR },
]

const BASE: Omit<TerrainSpec, 'pads'> = {
  // 基底斜面:前緣海岸(z=34,y=-3)一路升到背後(z=-30,y=17),坡度約 0.31(17°),等高線是東西向的橫線
  ramp: { from: [0, 34], to: [0, -30], y0: -3, y1: 17 },
  features: [
    // F1 後山主稜:由西往東升高,東側接到基隆山
    { kind: 'ridge', points: [[-46, -22, 4], [-30, -27, 8], [-14, -27, 7], [2, -27, 9], [14, -25, 12], [24, -22, 14], [34, -17, 9], [46, -12, 3]], halfWidth: 11 },
    // F2 基隆山:主稜上再疊一個圓錐狀隆起,山頂約 35(憑印象:在九份東側、形狀渾圓)
    { kind: 'bump', x: 26, z: -21, rx: 11, rz: 10, height: 7 },
    // F3 北側背坡:負高度山脊讓島的後緣往下收,背面切面從約 25 降到 14~18
    { kind: 'ridge', points: [[-44, -30, -8], [-20, -36, -12], [4, -37, -12], [26, -35, -10], [44, -24, -6]], halfWidth: 9 },
    // F4 山城所在的緩凸山腰:等高線在中央往海面微微鼓出,避免整面坡像一張平板
    { kind: 'bump', x: -4, z: 4, rx: 26, rz: 20, rot: 0, height: 2.2 },
    // F5 西側山溝:從山上斜斜往西南海灣下去,分開山城與西側山體
    { kind: 'bump', x: -36, z: 8, rx: 9, rz: 22, rot: -0.35, height: -4.5 },
    // F6 東側溪谷:比西側深,分開山城與基隆山山腳,出口在東側小灣
    { kind: 'bump', x: 33, z: 6, rx: 9, rz: 20, rot: 0.3, height: -5 },
    // F8 豎崎路切溝:石階嵌進山坡,兩側地面比石階略高,屋簷夾道(不加的話地面會穿出踏面 0.8~1.5 格)
    { kind: 'ridge', points: [[6, 14, -0.6], [6, 9, -2.0], [6, 4, -1.4], [6, 1, -0.4]], halfWidth: 4.5 },
    // F9 輕便路路塹:緩坡小路切進山腰(輕便路在基山街下方、石階底往西北西緩升),北側(上坡側)自然形成一道土坎
    { kind: 'ridge', points: [[0.5, 16.2, 0], [-4, 14.1, -0.3], [-8.6, 12, -1.0]], halfWidth: 3 },
    // F11 小石階切溝:輕便路西端接茶樓肩的小石階(往北上 2.15),不切的話地面會穿出踏面
    { kind: 'ridge', points: [[-8.6, 11, -0.6], [-8.6, 9.5, -1.2], [-8.6, 7.5, -1.3]], halfWidth: 2.5 },
    // F10 前緣中央小岬:海岸線中段微微隆起,沙灘不會一整條平板
    { kind: 'bump', x: 12, z: 30, rx: 7, rz: 4, height: 1.2 },
  ],
  noise: { amp: 0.7, scale: 9, seed: 7 }, // 低頻微起伏,pad 內不受影響
  cell: 1.5, // 石階切溝與 pad 邊緣在 2 格網格下會偏鈍
  colors: {
    beach: '#b8a27a',
    beachY: -1.0,
    rock: '#7d7366',
    soil: ['#7a5a3e', '#66503f', '#4f4034', '#3b3230'], // 側面土層:表土 → 風化層 → 岩盤 → 底
  },
}

// 屋排 y = 範圍內原地形(ramp + features + noise)的平均,取到小數 1 位
function padY(outline: Pt[]): number {
  const xs = outline.map((p) => p[0])
  const zs = outline.map((p) => p[1])
  let sum = 0
  let n = 0
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.5) {
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.5) {
      if (inPoly(x, z, outline)) { sum += baseFieldAt({ ...BASE }, x, z); n++ }
    }
  }
  return Math.round((sum / n) * 10) / 10
}

function inPoly(x: number, z: number, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i] as Pt
    const [xj, zj] = poly[j] as Pt
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

const ROW_PADS: PadDef[] = ROWS.map(([id, outline]) => ({ id, outline, y: padY(outline), blend: 1.5, color: ROW_COLOR }))
const PADS: PadDef[] = [...ROW_PADS, ...ROADS]

const TERRAIN: TerrainSpec = { ...BASE, pads: PADS.map((p) => ({ outline: p.outline, y: p.y!, blend: p.blend, color: p.color })) }

// 某點的地表高度(與渲染層、貼地物件用同一個函式)
export function groundY(x: number, z: number): number {
  return heightAt({ topY: TOP_Y, terrain: TERRAIN }, x, z)
}

// ---------------------------------------------------------------------------
// 步道（依序經過四站）與每個點的腳底高度
// ---------------------------------------------------------------------------

// [x, z, y]:先下再上(入口 7.5 → 基山街 9.4 最高 → 豎崎路下到 3.4 → 輕便路 4.9 → 小石階上到茶樓肩 7.05)。
// 三段石階/坡道([6,1]~[6,15]、[0.48,16.23]~[-8.58,11.97]、[-8.6,12]~[-8.6,7])要保持直線。
const PATH3: Array<[number, number, number]> = [
  // 汽車路公車站(起點)→ 入口坡階上到基山街西口(5.5 格爬 1.9)
  [-24, 0.2, 7.5],
  [-21.5, -0.3, 7.5],
  [-19.5, -0.8, 7.5],
  [-17, -1.3, 8.4],
  [-15, -1.6, 9.4],
  // ① 基山街:沿等高線往東,全段平
  [-10, -1.6, 9.4],
  [-6, -1.6, 9.4],
  [-2, -1.6, 9.4],
  [2, -1.6, 9.4],
  [4, -1.4, 9.4],
  // 豎崎路頂(基山街東端)右轉往南
  [6, -0.4, 9.4],
  // ② 豎崎路:往南走下,14 格長、下降 6.02(腳底 = 3.4 + (15 - z) × 0.43)
  [6, 1, 9.4],
  [6, 4.5, 7.92],
  [6, 8, 6.41],
  [6, 11.5, 4.91],
  [6, 15, 3.4],
  // 石階底/輕便路口,右轉往西
  [4, 15.8, 3.4],
  [2, 16.1, 3.4],
  // ③ 輕便路:往西北西緩升,10 格長、爬升 1.5
  [0.48, 16.23, 3.4],
  [-4.05, 14.1, 4.15],
  [-8.58, 11.97, 4.9],
  // 小石階:往北上,5 格長、爬升 2.15
  [-8.6, 12, 4.9],
  [-8.6, 9.5, 5.98],
  [-8.6, 7, 7.05],
  // ④ 茶樓肩:往東走到茶樓正面
  [-6.5, 8.2, 7.05],
  [-4, 8.6, 7.05],
  [-2, 8.8, 7.05],
]

const PATH_POINTS: Pt[] = PATH3.map(([x, z]) => [x, z])
const PATH_WIDTH = 2.2

// 與 path.points 一一對應的腳底高度（契約外的補充資料)
export const PATH_POINT_Y: number[] = PATH3.map(([, , y]) => y)

// ---------------------------------------------------------------------------
// 四站（stopId、時間以文章與企劃為準）。y 一律明確給:石階模型的原點在最低一階,地面比它高或低都不能由地形推。
// 模型 -Z 朝上坡;要朝向世界方向 (dx, dz) 時 rotY = atan2(-dx, -dz)。
// ---------------------------------------------------------------------------

const STOPS: StopAnchor[] = [
  {
    stopId: 'stop_1',
    label: '壱 基山街',
    time: '17:30',
    emoji: '🏮',
    blurb: '人潮正要散去，魚丸湯冒著熱氣，燈籠一盞盞準備亮起。',
    model: 'stop-jishan-street',
    x: -6,
    z: -1.6,
    y: 9.4,
    rotY: 0,
    scale: 16,
  },
  {
    stopId: 'stop_4',
    label: '弐 豎崎路石階',
    time: '18:30',
    emoji: '⛩️',
    blurb: '石階一路往上，兩旁紅燈籠接連亮起，這就是九份最被記住的畫面。',
    model: 'stop-shuqi-stairs',
    x: 6, // 模型的 (x, z) 是石階長度的中點;y 是最低一階(z 15)的底面。旅人是從頂(z 1)走下來
    z: 8,
    y: 3.4,
    rotY: 0,
    scale: 14,
  },
  {
    stopId: 'stop_5',
    label: '参 輕便路散步',
    time: '19:30',
    emoji: '🌙',
    blurb: '離開熱鬧的老街，只剩路燈陪著慢慢走，心情跟著沉澱下來。',
    model: 'stop-qingbian-lane',
    x: -4.05,
    z: 14.1,
    y: 3.4,
    rotY: 1.134, // 上坡方向(往西北西)(-9, -4.2):atan2(9, 4.2)
    scale: 10,
  },
  {
    stopId: 'stop_6',
    label: '肆 阿妹茶樓',
    time: '20:15',
    emoji: '🍵',
    blurb: '靠著欄杆點一壺茶，看整座山城的燈火與遠方漸暗的海。',
    model: 'stop-amei-teahouse',
    x: -2, // 豎崎路中段西側的肩,緊貼石階(東緣離石階店屋立面約 1.2 格),正面朝海
    z: 5,
    y: 7.05,
    rotY: 0,
    scale: 7,
  },
]

// 鏡頭:封面從東南方海上、仰角約 26°,豎崎路稍微斜著入鏡;各站導覽鏡頭見設計文件第 8 節
const CAMERA: LayoutCamera = {
  cover: { pos: [16, 46, 76], target: [-1, 6, 4] },
  stops: [
    { pos: [-14, 16, 10], target: [-7, 10.5, -1.6] }, // ① 從西南俯看基山街(刻意從茶樓西邊看過去,不被茶樓擋住)
    { pos: [6, 16, -5], target: [6, 4, 16] }, // ② 從石階頂往下看,燈籠一路延伸到海(配合下坡走法)
    { pos: [-6, 11, 28], target: [-4, 5, 13] }, // ③ 從南方低角度看輕便路,茶樓的燈在路的上方
    { pos: [-1, 13, 22], target: [-2, 9.5, 5] }, // ④ 茶樓正面
  ],
}

// ---------------------------------------------------------------------------
// 散落物計算
// ---------------------------------------------------------------------------

type Circle = { x: number; z: number; r: number }

// 不可放置的區域：站點腳印（線段 + 半徑）
const KEEP_OUT_SEGMENTS: Array<{ a: Pt; b: Pt; r: number }> = [
  { a: [-14, -1.6], b: [2, -1.6], r: 3 }, // 基山街
  { a: [6, 0.5], b: [6, 15.5], r: 3.6 }, // 豎崎路
  { a: [0.5, 16.2], b: [-8.6, 12], r: 3.4 }, // 輕便路
  { a: [-8.6, 12.5], b: [-8.6, 6.5], r: 1.6 }, // 小石階
  { a: [-2, 5], b: [-2, 5], r: 4.5 }, // 阿妹茶樓
  { a: [13, 11.6], b: [19, 11.6], r: 3.2 }, // 昇平戲院
]

function distToSegment(x: number, z: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / len2))
  return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz))
}

function distToPath(x: number, z: number): number {
  let d = Infinity
  for (let i = 0; i < PATH_POINTS.length - 1; i++) d = Math.min(d, distToSegment(x, z, PATH_POINTS[i] as Pt, PATH_POINTS[i + 1] as Pt))
  return d
}

const placed: Circle[] = []
const scatter: Placement[] = []

// 腳印落在夠平的地面:周圍 8 個取樣點與中心的高度差都不超過 tol。房子只放在平台上(tol 幾乎 0),
// 樹、燈籠、灌木可以放在緩坡上(tol 依物件大小放寬)。
function flatFootprint(x: number, z: number, r: number, y: number, tol: number): boolean {
  if (!inPoly(x, z, OUTLINE)) return false
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU
    const px = x + Math.cos(a) * r
    const pz = z + Math.sin(a) * r
    if (!inPoly(px, pz, OUTLINE) || Math.abs(groundY(px, pz) - y) > tol) return false
  }
  return true
}

type TryOpts = {
  model: string
  x: number
  z: number
  r: number // 腳印半徑（格）
  scale: number
  rotY?: number
  tol?: number // 地面起伏容許(格,預設 1e-6 = 要平台)
  flatR?: number // 檢查地面平整的半徑(預設 r × 0.7)。屋排只有 3 格深,寬屋的 r 太大會超出平台,所以屋舍另給
  pathGap?: number // 與步道中線的最小距離（預設 = 步道半寬 + r）
  overlapOk?: boolean // 允許與其他散落物重疊（例如蒸氣疊在攤位上）
  yOffset?: number // 額外抬高（例如蒸氣放在攤位上緣）
  ignoreKeepOut?: boolean // 忽略站點腳印（例如跨在步道入口的燈籠串）
}

function tryPlace(o: TryOpts): boolean {
  const y = groundY(o.x, o.z)
  if (!flatFootprint(o.x, o.z, o.flatR ?? o.r * 0.7, y, o.tol ?? 1e-6)) return false
  if (distToPath(o.x, o.z) < (o.pathGap ?? PATH_WIDTH / 2 + o.r)) return false
  if (!o.ignoreKeepOut) for (const s of KEEP_OUT_SEGMENTS) if (distToSegment(o.x, o.z, s.a, s.b) < s.r + o.r * 0.8) return false
  if (!o.overlapOk) for (const c of placed) if (Math.hypot(c.x - o.x, c.z - o.z) < c.r + o.r) return false
  if (!o.overlapOk) placed.push({ x: o.x, z: o.z, r: o.r })
  scatter.push({
    model: o.model,
    x: round2(o.x),
    z: round2(o.z),
    y: round2(y + (o.yOffset ?? 0)),
    rotY: round2(o.rotY ?? range(0, TAU)),
    scale: round2(o.scale),
    seed: Math.floor(rand() * 1e6),
  })
  return true
}

// 朝向：模型正面 +Z 轉向 (dx, dz) 方向的 rotY
const faceToward = (dx: number, dz: number) => Math.atan2(dx, dz)

// 放置順序 = 優先順序：先放「指定位置」的彩蛋與攤位，再放沿步道的燈，最後才用屋舍、樹木填滿。

// 1) 跨步道的燈籠串：基山街西口、豎崎路頂與底、茶樓正面(觀景重點,允許跨在步道上)
const STRING_SPOTS: Array<[number, number, number]> = [
  // [x, z, 燈串方向角]
  [-15.5, -1.2, 0.3],
  [6, 0.2, 0],
  [6, 14.2, 0],
  [-4, 9.0, 0],
]
for (const [x, z, a] of STRING_SPOTS) {
  tryPlace({ model: 'deco-lantern-string', x, z, r: 0.6, scale: 3.6, rotY: a, pathGap: 0, overlapOk: true, ignoreKeepOut: true, tol: 1 })
}

// 2) 小吃攤與蒸氣：基山街西口、豎崎路頂與底、公車站旁
const STALL_SPOTS: Array<[number, number, number]> = [
  // [x, z, 正面朝向的 rotY]
  [-14.5, 0.6, faceToward(0, -1)],
  [9.5, -2.6, faceToward(-1, 0)],
  [9.5, 17.2, faceToward(0, -1.8)],
  [-25, 1.2, faceToward(0, -1)],
]
for (const [x, z, rotY] of STALL_SPOTS) {
  const scale = range(2, 2.3)
  if (tryPlace({ model: 'deco-stall', x, z, r: 1.1, scale, rotY, pathGap: PATH_WIDTH / 2 + 0.6, ignoreKeepOut: true })) {
    tryPlace({ model: 'deco-steam', x: x + range(-0.4, 0.4), z: z + range(-0.3, 0.3), r: 0.4, scale: range(1.1, 1.5), pathGap: 0, overlapOk: true, yOffset: scale * 1.05 })
  }
}

// 3) 貓：石階底、輕便路口南側、茶樓肩西側、公車站(找附近可放的位置)
const CAT_SPOTS: Array<[number, number, number]> = [
  [9, 16.5, -0.6],
  [0.5, 17.7, 0.4],
  [-12, 6, -0.3],
  [-26, 0.5, 0.5],
]
for (const [x, z, rotY] of CAT_SPOTS) {
  for (let k = 0; k < 8; k++) {
    if (tryPlace({ model: 'deco-cat', x: x + range(-0.8, 0.8), z: z + range(-0.8, 0.8), r: 0.4, scale: range(1, 1.2), rotY, pathGap: PATH_WIDTH / 2 + 0.3, tol: 0.3 })) break
  }
}

// 4) 大茶壺地標：茶樓肩西側(終點彩蛋)
tryPlace({ model: 'deco-teapot', x: -11, z: 4, r: 1, scale: 2.6, rotY: -0.9, pathGap: PATH_WIDTH / 2 + 0.4 })

// 4b) 昇平戲院與門前廣場(風景地標):戲院模型原點在最低一階(y 3.4 = P7),直接 push(keepY,不走腳印檢查);
//     廣場擺設都在 P7 內(實算高度全為 3.4),中央 (14~18, 15~17) 刻意留空,讓戲院正面從封面看得到。
scatter.push({ model: 'landmark-sheng-ping-theater', x: 16, z: 11.5, y: 3.4, rotY: 0, scale: 7, keepY: true })
for (const x of [13.8, 18.2]) {
  tryPlace({ model: 'deco-lantern-string', x, z: 16.2, r: 0.6, scale: 3.6, rotY: 0, pathGap: 0, overlapOk: true, ignoreKeepOut: true, tol: 1 })
}
for (const x of [12.6, 20.2]) {
  const scale = range(2, 2.3)
  if (tryPlace({ model: 'deco-stall', x, z: 17, r: 1.1, scale, rotY: faceToward(0, -1), ignoreKeepOut: true })) {
    tryPlace({ model: 'deco-steam', x: x + range(-0.4, 0.4), z: 17 + range(-0.3, 0.3), r: 0.4, scale: range(1.1, 1.5), pathGap: 0, overlapOk: true, yOffset: scale * 1.05 })
  }
}
// 廣場四角的立燈籠,面向廣場中心 (16, 16.6)
for (const [x, z] of [[11.6, 15.2], [21.2, 15.2], [11.6, 17.6], [21.2, 17.6]] as Array<[number, number]>) {
  tryPlace({ model: 'deco-lantern-red', x, z, r: 0.4, scale: range(1.3, 1.6), rotY: faceToward(16 - x, 16.6 - z), tol: 0.35, ignoreKeepOut: true })
}
tryPlace({ model: 'deco-cat', x: 15.2, z: 15.4, r: 0.4, scale: range(1, 1.2), rotY: 0.6, tol: 0.3, ignoreKeepOut: true })
tryPlace({ model: 'deco-cat', x: 19.5, z: 15.3, r: 0.4, scale: range(1, 1.2), rotY: -0.4, tol: 0.3, ignoreKeepOut: true })

// 5) 沿步道兩側的燈籠與路燈：每隔一段距離左右交替放；離輕便路線段 3.5 格以內改用安靜的路燈,其餘是紅燈籠
//    (小石階與茶樓肩維持紅燈籠,讓終點重新熱鬧起來;不能用高度判斷:基山街比輕便路高很多)。
//    基山街、石階本身的模型已帶燈籠，所以站點腳印內不再放。
const LANE_A: Pt = [0.5, 16.2] // 輕便路的兩端(與 KEEP_OUT_SEGMENTS 的輕便路一致)
const LANE_B: Pt = [-8.6, 12]

function walkPath(spacing: number, fn: (x: number, z: number, nx: number, nz: number, i: number) => void) {
  let carry = 0
  let n = 0
  for (let i = 0; i < PATH_POINTS.length - 1; i++) {
    const [ax, az] = PATH_POINTS[i] as Pt
    const [bx, bz] = PATH_POINTS[i + 1] as Pt
    const len = Math.hypot(bx - ax, bz - az)
    let d = carry
    while (d < len) {
      const t = d / len
      fn(ax + (bx - ax) * t, az + (bz - az) * t, -(bz - az) / len, (bx - ax) / len, n++)
      d += spacing
    }
    carry = d - len
  }
}

walkPath(1.8, (x, z, nx, nz, i) => {
  const side = i % 2 ? 1 : -1
  const off = PATH_WIDTH / 2 + range(0.6, 1.3)
  const px = x + nx * off * side
  const pz = z + nz * off * side
  const quiet = distToSegment(px, pz, LANE_A, LANE_B) <= 3.5
  const rotY = faceToward(-nx * side, -nz * side)
  if (quiet) {
    if (i % 2 === 0) tryPlace({ model: 'deco-street-lamp', x: px, z: pz, r: 0.5, scale: range(1.7, 1.9), rotY, pathGap: PATH_WIDTH / 2 + 0.3, tol: 0.35 })
  } else {
    tryPlace({ model: 'deco-lantern-red', x: px, z: pz, r: 0.5, scale: range(1.3, 1.6), rotY, pathGap: PATH_WIDTH / 2 + 0.3, tol: 0.35 })
  }
})

// 6) 屋舍沿每條屋排的長軸排列,正面朝坡下(南,鏡頭)。越靠石階與基山街越密,外側(R7w、R8w、R9w)稀疏。
//    每間屋有一半機率在門前掛一盞燈籠。屋排的長軸取四邊形的「第一條邊」方向,中線在兩條長邊之間。
const lerp2 = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
const SPARSE_ROWS = new Set(['R7w', 'R8w'])

function houseRow(id: string, outline: Pt[]) {
  const [a, b, c, d] = outline as [Pt, Pt, Pt, Pt] // a→b 北緣、d→c 南緣
  const lenAB = Math.hypot(b[0] - a[0], b[1] - a[1])
  const ux = (b[0] - a[0]) / lenAB
  const uz = (b[1] - a[1]) / lenAB
  const rotBase = faceToward(-uz, ux) // 長軸 u 的右手法線(u=(1,0) 時朝 +z)
  const sparse = SPARSE_ROWS.has(id)
  let cursor = 1.2 // 沿長軸已走的距離(從西端起,留出 pad 邊緣)
  while (cursor < lenAB - 1.2) {
    const useA = rand() < 0.65
    const scale = range(3, 4.1)
    const r = useA ? scale * 0.35 : scale * 0.62 // old-a 窄(寬約 0.6 × scale)、old-b 寬(約 1.2 × scale)
    const t = (cursor + r) / lenAB
    if (t > 1) break
    const [px, pz] = lerp2(lerp2(a, b, t), lerp2(d, c, t), 0.5)
    const rotY = rotBase + range(-0.15, 0.15)
    const ok = tryPlace({ model: useA ? 'deco-house-old-a' : 'deco-house-old-b', x: px, z: pz, r, scale, rotY, flatR: Math.min(r * 0.7, 1.1) })
    if (ok && rand() < 0.5) {
      // 門前燈籠：放在屋子正面、偏一側
      const fx = Math.sin(rotY)
      const fz = Math.cos(rotY)
      const lat = rand() < 0.5 ? -1 : 1
      tryPlace({ model: 'deco-lantern-red', x: px + fx * (r + 0.5) + fz * lat * r * 0.5, z: pz + fz * (r + 0.5) - fx * lat * r * 0.5, r: 0.4, scale: range(1.2, 1.5), rotY, tol: 0.35 })
    }
    cursor += 2 * r + (sparse ? range(1.2, 2.2) : range(0.1, 0.6))
  }
}
for (const [id, outline] of ROWS) houseRow(id, outline)

// 6b) 屋排前緣的燈帶：沿每條屋排朝南(鏡頭)的長邊,往內 0.3 格(在屋子正面之外),每 2.5 格一盞。
//     從封面看是一層層往上的紅色光帶,長度不一、彼此錯開,不會變成同心環。
for (const [, outline] of ROWS) {
  const [a, b, c, d] = outline as [Pt, Pt, Pt, Pt]
  const len = Math.hypot(c[0] - d[0], c[1] - d[1])
  for (let s = 1; s < len - 0.5; s += 2.5) {
    const south = lerp2(d, c, s / len)
    const north = lerp2(a, b, s / len)
    const [x, z] = lerp2(south, north, 0.3 / Math.hypot(north[0] - south[0], north[1] - south[1]))
    tryPlace({ model: 'deco-lantern-red', x, z, r: 0.4, scale: range(1.2, 1.5), rotY: faceToward(0, 1), tol: 0.35, overlapOk: true })
  }
}

// 7) 樹
// 7a) 松林:y > 15 的坡面(主稜、茶樓背後、基隆山),山頂附近(y > 30)不種;格點抖動,約 30% 做林窗
{
  let n = 0
  for (let x = -44; x <= 44 && n < 70; x += 2.6) {
    for (let z = -32; z <= -4 && n < 70; z += 2.6) {
      const px = x + range(-1.2, 1.2)
      const pz = z + range(-1.2, 1.2)
      const gy = groundY(px, pz)
      if (gy <= 15 || gy > 30 || rand() < 0.3) continue
      if (tryPlace({ model: 'deco-tree-pine', x: px, z: pz, r: 1.3, scale: range(3.4, 4.8), tol: 1.8 })) n++
    }
  }
}
// 7b) 榕樹:海岸帶與兩道山溝的谷底,框住畫面左右
{
  let n = 0
  const zones: Array<[number, number, number, number]> = [[-26, 24, 18, 31], [-40, -30, 2, 22], [28, 40, 0, 20]] // [x0, x1, z0, z1]
  for (let i = 0; i < 80 && n < 12; i++) {
    const [x0, x1, z0, z1] = zones[i % zones.length]
    if (tryPlace({ model: 'deco-tree-banyan', x: range(x0, x1), z: range(z0, z1), r: 2.2, scale: range(4.2, 5.6), tol: 1.5 })) n++
  }
}
// 7c) 竹叢:輕便路南側(下坡側)與山溝邊,最多 10 叢
{
  let n = 0
  for (let i = 0; i < 60 && n < 10; i++) {
    const nearLane = i < 20
    const x = nearLane ? range(-6, 3) : range(-38, -30)
    const z = nearLane ? range(-1, 1) : range(0, 14)
    if (tryPlace({ model: 'deco-bamboo', x, z, r: 0.9, scale: range(2.6, 3.4), tol: 1 })) n++
  }
}

// 8) 灌木與岩石:屋排外側 1~2 格的土坎、海岸礁岸(y < -1),約 40 個
{
  let n = 0
  for (let i = 0; i < 200 && n < 40; i++) {
    const [, outline] = ROWS[Math.floor(rand() * ROWS.length)] as [string, Pt[]]
    const useShore = i % 4 === 3
    const x = useShore ? range(-24, 28) : range(Math.min(...outline.map((p) => p[0])) - 1.5, Math.max(...outline.map((p) => p[0])) + 1.5)
    const z = useShore ? range(28, 33) : range(Math.min(...outline.map((p) => p[1])) - 2, Math.max(...outline.map((p) => p[1])) + 2)
    const isRock = rand() < 0.45
    if (tryPlace({ model: isRock ? 'deco-rock' : 'deco-bush', x, z, r: 0.8, scale: isRock ? range(1.2, 2.2) : range(1.4, 2.2), tol: 0.6 })) n++
  }
}

// 9) 小石階:輕便路西端(P5)往北上到茶樓肩(P6),長 5 格、爬升 2.15(底端 z 12、頂端 z 7)。用跟豎崎路同款的模型縮小版,
//    直接 push(腳印不平,不走 tryPlace);原點在最低一階(y 4.9),地面在這裡比它低或相等,所以要 keepY 保留明確的腳底高度。
scatter.push({ model: 'stop-shuqi-stairs', x: -8.6, z: 9.5, y: 4.9, rotY: 0, scale: 5, keepY: true })

// 10) 峭壁岩塊:東側溪谷壁與基隆山陡面,tilt 對齊坡面法線(用 groundY 的差分算),略埋進坡裡。最多 5 個。
{
  let n = 0
  const e = 0.6
  for (let i = 0; i < 200 && n < 5; i++) {
    const x = range(28, 44)
    const z = range(-26, 14)
    const gx = (groundY(x + e, z) - groundY(x - e, z)) / (2 * e)
    const gz = (groundY(x, z + e) - groundY(x, z - e)) / (2 * e)
    const slope = Math.hypot(gx, gz)
    if (slope < 0.85 || !inPoly(x, z, OUTLINE) || placed.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 2.5)) continue
    // 法線 n = (-gx, 1, -gz)/|.|;模型的「上方」先繞 X、Z 軸傾斜(Euler XZ)對到法線
    const ny = 1 / Math.hypot(gx, 1, gz)
    const tilt: [number, number] = [Math.atan2(-gz * ny, ny), -Math.atan2(-gx * ny, ny)]
    placed.push({ x, z, r: 2 })
    scatter.push({ model: 'deco-cliff-rock', x: round2(x), z: round2(z), y: round2(groundY(x, z) - 0.25), rotY: round2(range(0, TAU)), scale: round2(range(1.8, 2.6)), tilt: [round2(tilt[0]), round2(tilt[1])], seed: Math.floor(rand() * 1e6) })
    n++
  }
}

// ---------------------------------------------------------------------------
// 光線關鍵時刻
// 方位角約定（建議寫進契約）：0° = 北（-z）、90° = 東（+x）、180° = 南（+z）、270° = 西（-x）。
// 新地形的坡面朝南,所以傍晚太陽放在西南西(約 250°)而不是原本的西北西(290°):坡面才吃得到暖色側光。
// 夜間的「太陽」改當月光：方位從西南西緩慢往西南移（246°→220°），不要大幅換方位
// (相鄰關鍵時刻是線性插值,大幅換方位會讓影子掃過整座島)。
// lanternGlow 節奏：17:30 只有店面零星亮 → 18:30 藍調時刻快速點亮 → 19:30 幾乎全亮 → 20:15 滿。
// ---------------------------------------------------------------------------

const LIGHTING: LightKey[] = [
  // 清晨：時間滑桿從深夜回到白天之間的過渡，燈籠還留著一些
  { time: '06:00', skyTop: '#5d6fa8', skyBottom: '#f2b38a', fog: '#c9b2b0', sun: '#ffc79a', sunIntensity: 0.6, sunElevationDeg: 6, sunAzimuthDeg: 75, hemiSky: '#9fb0d6', hemiGround: '#5a4a42', hemiIntensity: 0.45, lanternGlow: 0.3 },
  // 正午：晴朗、乾淨、飽和的山城（讓拖到白天也好看）
  { time: '12:00', skyTop: '#5fa8e8', skyBottom: '#cfe9f5', fog: '#d8ecf2', sun: '#fff4e0', sunIntensity: 1.25, sunElevationDeg: 68, sunAzimuthDeg: 180, hemiSky: '#bfe0ff', hemiGround: '#6f7f4e', hemiIntensity: 0.75, lanternGlow: 0 },
  // 午後：陽光開始偏暖，影子拉長
  { time: '16:00', skyTop: '#6aa3dc', skyBottom: '#f3dcae', fog: '#e8dcc0', sun: '#ffe2a8', sunIntensity: 1.1, sunElevationDeg: 28, sunAzimuthDeg: 262, hemiSky: '#c6dcf0', hemiGround: '#6f6a48', hemiIntensity: 0.65, lanternGlow: 0 },
  // 夕陽：暖橘、整座島鍍金，店面先亮
  { time: '17:30', skyTop: '#6b6fb0', skyBottom: '#ff9a52', fog: '#f0a87a', sun: '#ff9a4a', sunIntensity: 1.0, sunElevationDeg: 7, sunAzimuthDeg: 252, hemiSky: '#e9a98a', hemiGround: '#5e4636', hemiIntensity: 0.55, lanternGlow: 0.12 },
  // 日落瞬間：天空最紅，燈籠開始一盞盞亮
  { time: '18:00', skyTop: '#4e4f92', skyBottom: '#ff7a4e', fog: '#c98270', sun: '#ff6e3a', sunIntensity: 0.55, sunElevationDeg: 1, sunAzimuthDeg: 250, hemiSky: '#a98aa8', hemiGround: '#4a3a34', hemiIntensity: 0.45, lanternGlow: 0.32 },
  // 藍調時刻：天空轉深藍、地平線殘留粉橘，燈籠快速點亮
  { time: '18:30', skyTop: '#2f3a78', skyBottom: '#d07a7a', fog: '#6f6488', sun: '#8f8fd0', sunIntensity: 0.28, sunElevationDeg: -2, sunAzimuthDeg: 248, hemiSky: '#6a74b0', hemiGround: '#3a3040', hemiIntensity: 0.4, lanternGlow: 0.62 },
  { time: '19:00', skyTop: '#2b2f5a', skyBottom: '#7a5f8f', fog: '#4f4a72', sun: '#8a96d8', sunIntensity: 0.22, sunElevationDeg: 18, sunAzimuthDeg: 246, hemiSky: '#4f5894', hemiGround: '#2e2838', hemiIntensity: 0.36, lanternGlow: 0.85 },
  // 藍紫夜：燈籠全亮，紅與藍紫的對比最強（封面時刻）
  { time: '19:30', skyTop: '#232650', skyBottom: '#4f4a80', fog: '#3a3a64', sun: '#9aa6e0', sunIntensity: 0.22, sunElevationDeg: 25, sunAzimuthDeg: 244, hemiSky: '#3f4888', hemiGround: '#2a2434', hemiIntensity: 0.34, lanternGlow: 0.96 },
  // 茶樓時刻：夜色定下來，海面只剩月光
  { time: '20:15', skyTop: '#1c1f44', skyBottom: '#353a6a', fog: '#2c2f55', sun: '#a6b2e8', sunIntensity: 0.24, sunElevationDeg: 32, sunAzimuthDeg: 238, hemiSky: '#343c78', hemiGround: '#221e2c', hemiIntensity: 0.32, lanternGlow: 1 },
  { time: '21:30', skyTop: '#151836', skyBottom: '#272b52', fog: '#20234a', sun: '#a6b2e8', sunIntensity: 0.22, sunElevationDeg: 40, sunAzimuthDeg: 226, hemiSky: '#2a3066', hemiGround: '#1c1824', hemiIntensity: 0.3, lanternGlow: 1 },
  // 深夜：店家陸續打烊，燈籠稍稍收斂
  { time: '22:00', skyTop: '#11132c', skyBottom: '#1f2346', fog: '#1a1d40', sun: '#9aa6dc', sunIntensity: 0.2, sunElevationDeg: 42, sunAzimuthDeg: 220, hemiSky: '#252a5c', hemiGround: '#18151f', hemiIntensity: 0.28, lanternGlow: 0.9 },
]

// ---------------------------------------------------------------------------

export const ISLAND_LAYOUT: IslandLayout = {
  outline: OUTLINE,
  topY: TOP_Y,
  terrain: TERRAIN,
  camera: CAMERA,
  sea: { y: -3.5, color: '#2a4f78' },
  thickness: 7,
  river: { points: [], width: 2.5 },
  path: { points: PATH_POINTS, width: PATH_WIDTH },
  stops: STOPS,
  scatter,
  lighting: LIGHTING,
  palette: {
    grass: '#7a9455', // 低處草坡;高處漸變成 grassAlt(偏暗,夜裡山稜才會成剪影,不和燈火搶戲)
    grassAlt: '#4e6a44',
    dirt: '#7a5a3e',
    water: '#3d6f8f',
    waterDeep: '#1f3b5c',
    path: '#9a9286',
  },
}
