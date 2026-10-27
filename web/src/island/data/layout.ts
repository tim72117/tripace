// 「夜遊九份」島的版面資料。內容由部落客文章（docs/source-night-jiufen.json）的四站生成，
// 這個檔案只負責「放在哪裡、長什麼樣」。型別契約見 ./layoutTypes.ts。
//
// 整體構成（俯視，+x 東、+z 南＝朝鏡頭）：
//   - 島體是半徑約 33~37 格的不規則圓。山城從南側海邊（低）往西北（高）層層堆疊，共 4 層階地：
//       地面 y=0   ：南側前緣，第一站「基山街」橫在這裡，人潮與攤位最密。
//       T1   y=3   ：大片的第一層山坡住宅；中間切出一道南北向的「缺口」，第二站豎崎路石階嵌在缺口裡。
//       T2   y=6   ：第二層，石階頂端落在這層前緣；第三站「輕便路」在這層往西緩坡上行 1.5 格。
//       T3   y=7.5 ：西北側的小高台，輕便路的終點。
//       T4   y=9.5 ：最高層，一段小石階上來就是第四站「阿妹茶樓」，正面朝南俯瞰整座山城與海。
//   - 河：九份是山城，沒有顯著河流。這裡選擇「無河」——river.points 為空陣列，
//     渲染層遇到空陣列時請直接略過不畫（寬度欄位保留，只為符合型別）。
//   - 海：島外一圈海面，略低於島的地面（y=-3.5），夜晚做反光。
//
// 輪廓的「順時針」：以俯視、北（-z）朝上、+x 朝右的畫面來看，角度遞增（cos θ, sin θ）正好是順時針。
//
// 散落物（scatter）全部用固定種子的亂數在這裡「計算」：屋舍沿各層階地等高線排、燈籠沿步道、
// 樹沿島緣，並以「腳印圓」避開步道、站點與彼此。輸出 deterministic，每次載入都一樣。
//
// 步道高度：契約的 Pt 只有 (x, z)。另外匯出 PATH_POINT_Y（與 path.points 一一對應的腳底高度），
// 讓旅人走石階時能平順爬升，而不是在階地邊緣瞬間跳上去（見 docs/visual-plan.md 的契約建議）。

import type { IslandLayout, LightKey, Placement, Pt, StopAnchor } from './layoutTypes'
import { heightAt } from '../logic/terrain'

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

// ---------------------------------------------------------------------------
// 輪廓與階地
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2

// 角度上的「保護區」：這些角度附近的半徑不加雜訊，確保石階、坡道剛好接上階地邊緣
function protectWeight(theta: number, protect: number[]): number {
  let w = 1
  for (const p of protect) {
    let d = Math.abs(theta - p) % TAU
    if (d > Math.PI) d = TAU - d
    w *= 1 - Math.exp(-((d / 0.32) ** 2))
  }
  return w
}

// 帶低頻雜訊的橢圓（順時針），noise 是半徑的相對擾動幅度
function blob(cx: number, cz: number, rx: number, rz: number, n: number, noise: number, phase: number, protect: number[] = []): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU
    const wobble = 1 + noise * protectWeight(t, protect) * (0.55 * Math.sin(3 * t + phase) + 0.3 * Math.sin(5 * t + phase * 1.7) + 0.15 * Math.sin(8 * t + phase * 0.6))
    pts.push([round2(cx + Math.cos(t) * rx * wobble), round2(cz + Math.sin(t) * rz * wobble)])
  }
  return pts
}

// 在多邊形的南側（z 較大的一側）切出一道南北向缺口：x 介於 x1~x2、往北切到 zIn
function carveNotch(poly: Pt[], x1: number, x2: number, zIn: number): Pt[] {
  const inNotch = (p: Pt) => p[0] > x1 && p[0] < x2 && p[1] > zIn
  const start = poly.findIndex((p, i) => !inNotch(p) && inNotch(poly[(i + 1) % poly.length] as Pt))
  if (start < 0) return poly
  // 旋轉陣列，讓缺口前的最後一點排在最前面
  const rotated = [...poly.slice(start), ...poly.slice(0, start)]
  const before = rotated[0] as Pt
  const end = rotated.findIndex((p, i) => i > 0 && !inNotch(p))
  const after = rotated[end] as Pt
  const zAt = (x: number) => before[1] + ((after[1] - before[1]) * (x - before[0])) / (after[0] - before[0])
  // 角度遞增時南側由東往西走，所以先遇到 x2 再遇到 x1
  const cut: Pt[] = [
    [x2, round2(zAt(x2))],
    [x2, zIn],
    [x1, zIn],
    [x1, round2(zAt(x1))],
  ]
  return [before, ...cut, ...rotated.slice(end)]
}

const OUTLINE: Pt[] = blob(0, 0, 35, 34, 40, 0.07, 0.8)

// 豎崎路石階所在的缺口：x 1~7，石階頂端在 z≈3.6
const STAIR_X = 4
const STAIR_BOTTOM_Z = 17.6
const STAIR_TOP_Z = 3.6

const T1 = carveNotch(blob(0, -5, 28, 21, 64, 0.05, 2.1, [1.43]), 1, 7, 1)
const T2 = blob(-2, -9, 24, 13, 56, 0.05, 4.2, [1.318])
const T3 = blob(-13, -10, 10, 9, 36, 0.06, 1.3, [0.727])
const T4 = blob(-15, -13, 6.5, 5.5, 28, 0.05, 5.5, [0.904])

const TERRACES = [
  { outline: T1, y: 3, color: '#7c9256' },
  { outline: T2, y: 6, color: '#86985c' },
  { outline: T3, y: 7.5, color: '#909f63' },
  { outline: T4, y: 9.5, color: '#a39a7a' }, // 茶樓前的石板小廣場
]

// 島後方(北側)整面山壁:九份依山而建,背後就是山。輪廓沿島北緣(向內縮 6% 留出邊),前緣是一條橫向的直線;
// 前緣接在階地後緣(y=6),以 60° 陡坡快速升高,坡頂之後夾在 y1 成山頂。
// 低端 y0 等於 T2 的高度,與階地交界沒有縫(heightAt 取兩者較高者)。
const SLOPE_RUN = 4 // 水平坡長
const SLOPE_DEG = 60
const WALL_FRONT_Z = -16 // 山壁輪廓只收島輪廓上 z 小於這個值(北側)的點
const WALL_INSET = 0.94
const SLOPES = [
  {
    outline: OUTLINE.filter(([, z]) => z < WALL_FRONT_Z).map(([x, z]) => [round2(x * WALL_INSET), round2(z * WALL_INSET)] as Pt),
    from: [0, -18] as Pt,
    to: [0, -18 - SLOPE_RUN] as Pt,
    y0: 6,
    y1: 6 + SLOPE_RUN * Math.tan((SLOPE_DEG * Math.PI) / 180),
    color: '#7e9558',
    // 有菱角的峭壁:稜面約 10/2^3 = 1.25 格,陡面岩色,內部頂點最多往上長 0.55(heightAt 不含這個起伏)
    crag: { seed: 11, amp: 0.55, detail: 3, rockColor: '#8f8372' },
  },
]

function inPoly(x: number, z: number, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i] as Pt
    const [xj, zj] = poly[j] as Pt
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

// 某點的地表高度：取包含它的最高階地或斜坡
export function groundY(x: number, z: number): number {
  return heightAt({ topY: 0, terraces: TERRACES, slopes: SLOPES }, x, z)
}

// ---------------------------------------------------------------------------
// 步道（依序經過四站）與每個點的腳底高度
// ---------------------------------------------------------------------------

// [x, z, y]；y 在石階與緩坡上用線性內插，其餘等於所在階地高度
const PATH3: Array<[number, number, number]> = [
  // 地面：從島西南的海邊入口沿基山街往東
  [-21, 26.5, 0],
  [-17, 25, 0],
  [-13, 24.2, 0],
  [-9, 24, 0],
  [-6, 24, 0],
  [-3, 24, 0],
  [0.5, 23.6, 0],
  [3, 22, 0],
  [STAIR_X, 19.6, 0],
  // 豎崎路石階：14 格長、爬升 6 格
  [STAIR_X, STAIR_BOTTOM_Z, 0],
  [STAIR_X, 14.1, 1.5],
  [STAIR_X, 10.6, 3],
  [STAIR_X, 7.1, 4.5],
  [STAIR_X, STAIR_TOP_Z, 6],
  // T2：轉往西，接上輕便路
  [3.9, 1.6, 6],
  [3.4, -1.6, 6],
  [2.4, -3.6, 6],
  // 輕便路緩坡：x 4.5 → -5.5，爬升 1.5 格
  [0.5, -4, 6.6],
  [-2.5, -4, 7.05],
  [-5.5, -4, 7.5],
  // T3：繞到小石階下
  [-8, -3.6, 7.5],
  [-10.2, -3.4, 7.5],
  [-11, -4.2, 7.5],
  // 小石階：T3 → T4，爬升 2 格
  [-11, -6.4, 8.5],
  [-11, -8.7, 9.5],
  // T4：茶樓前
  [-11.8, -10, 9.5],
  [-13.4, -10.6, 9.5],
]

const PATH_POINTS: Pt[] = PATH3.map(([x, z]) => [x, z])
const PATH_WIDTH = 2.2

// 與 path.points 一一對應的腳底高度（契約外的補充資料）
export const PATH_POINT_Y: number[] = PATH3.map(([, , y]) => y)

// ---------------------------------------------------------------------------
// 四站（stopId、時間以文章與企劃為準）
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
    z: 24,
    y: 0,
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
    x: STAIR_X,
    z: (STAIR_BOTTOM_Z + STAIR_TOP_Z) / 2,
    y: 0,
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
    x: -0.5,
    z: -4,
    y: 6,
    rotY: Math.PI / 2, // 模型 -Z（上坡）朝向世界 -x（西）
    scale: 10,
  },
  {
    stopId: 'stop_6',
    label: '肆 阿妹茶樓',
    time: '20:15',
    emoji: '🍵',
    blurb: '靠著欄杆點一壺茶，看整座山城的燈火與遠方漸暗的海。',
    model: 'stop-amei-teahouse',
    x: -15,
    z: -14.6,
    y: 9.5,
    rotY: 0,
    scale: 7,
  },
]

// ---------------------------------------------------------------------------
// 散落物計算
// ---------------------------------------------------------------------------

type Circle = { x: number; z: number; r: number }

// 不可放置的區域：站點腳印（線段 + 半徑）
const KEEP_OUT_SEGMENTS: Array<{ a: Pt; b: Pt; r: number }> = [
  { a: [-14.5, 24], b: [2.5, 24], r: 3 }, // 基山街
  { a: [STAIR_X, STAIR_BOTTOM_Z + 0.5], b: [STAIR_X, STAIR_TOP_Z - 0.5], r: 3.6 }, // 豎崎路石階
  { a: [5, -4], b: [-6, -4], r: 3.4 }, // 輕便路
  { a: [-11, -3.6], b: [-11, -9], r: 1.8 }, // 小石階
  { a: [-15, -14.6], b: [-15, -14.6], r: 4.3 }, // 阿妹茶樓
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

// 腳印在同一層平面上（周圍取樣點的高度都一樣，避免卡進上一層的牆或懸在下一層邊緣）
// 峭壁的岩面會往上鼓(crag),所以腳印不得壓到斜坡輪廓內,否則物件會被岩面穿過
const onSlope = (x: number, z: number) => SLOPES.some((sl) => inPoly(x, z, sl.outline))

function flatFootprint(x: number, z: number, r: number, y: number): boolean {
  if (!inPoly(x, z, OUTLINE) || onSlope(x, z)) return false
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU
    const px = x + Math.cos(a) * r
    const pz = z + Math.sin(a) * r
    if (!inPoly(px, pz, OUTLINE) || onSlope(px, pz) || groundY(px, pz) !== y) return false
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
  pathGap?: number // 與步道中線的最小距離（預設 = 步道半寬 + r）
  overlapOk?: boolean // 允許與其他散落物重疊（例如蒸氣疊在攤位上）
  yOffset?: number // 額外抬高（例如蒸氣放在攤位上緣）
  ignoreKeepOut?: boolean // 忽略站點腳印（例如跨在步道入口的燈籠串）
}

function tryPlace(o: TryOpts): boolean {
  const y = groundY(o.x, o.z)
  if (!flatFootprint(o.x, o.z, o.r * 0.7, y)) return false
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

// 1) 跨步道的燈籠串：基山街西口、石階下口與上口、茶樓前（觀景重點，允許跨在步道上）
const STRING_SPOTS: Array<[number, number, number]> = [
  // [x, z, 燈串方向角]
  [-17.5, 25.2, 0.35],
  [3.4, 21, -0.6],
  [3.3, 0.5, 0.15],
  [-12.8, -10.4, 0.3],
]
for (const [x, z, a] of STRING_SPOTS) {
  tryPlace({ model: 'deco-lantern-string', x, z, r: 0.6, scale: 3.6, rotY: a, pathGap: 0, overlapOk: true, ignoreKeepOut: true })
}

// 2) 小吃攤與蒸氣：基山街西口外側與石階下方的小廣場，攤位正面朝向老街
const STALL_SPOTS: Array<[number, number]> = [
  [-17.8, 21.4],
  [-15.6, 28.2],
  [7.2, 21.6],
  [6, 25.6],
  [-20.5, 23.2],
]
for (const [x, z] of STALL_SPOTS) {
  const scale = range(2, 2.3)
  if (tryPlace({ model: 'deco-stall', x, z, r: 1.1, scale, rotY: faceToward(-6 - x, 24 - z), pathGap: PATH_WIDTH / 2 + 0.6 })) {
    tryPlace({ model: 'deco-steam', x: x + range(-0.4, 0.4), z: z + range(-0.3, 0.3), r: 0.4, scale: range(1.1, 1.5), pathGap: 0, overlapOk: true, yOffset: scale * 1.05 })
  }
}

// 3) 貓：石階下口、輕便路南側、茶樓旁、老街西口（找附近可放的位置）
const CAT_SPOTS: Array<[number, number, number]> = [
  [8.2, 18.6, -0.6],
  [-2, 0.4, 0.4],
  [-9.6, -11.4, -0.3],
  [-19.6, 25.8, 0.5],
]
for (const [x, z, rotY] of CAT_SPOTS) {
  for (let k = 0; k < 8; k++) {
    if (tryPlace({ model: 'deco-cat', x: x + range(-0.8, 0.8), z: z + range(-0.8, 0.8), r: 0.4, scale: range(1, 1.2), rotY, pathGap: PATH_WIDTH / 2 + 0.3 })) break
  }
}

// 4) 大茶壺地標：茶樓旁的小廣場邊（終點彩蛋）
tryPlace({ model: 'deco-teapot', x: -9.8, z: -13.6, r: 1, scale: 2.6, rotY: -0.9, pathGap: PATH_WIDTH / 2 + 0.4 })

// 5) 沿步道兩側的燈籠與路燈：每隔一段距離左右交替放；T2 以上（輕便路一帶）改用安靜的路燈。
//    基山街、石階本身的模型已帶燈籠，所以站點腳印內不再放。
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
  const quiet = groundY(px, pz) >= 6
  const rotY = faceToward(-nx * side, -nz * side)
  if (quiet) {
    if (i % 2 === 0) tryPlace({ model: 'deco-street-lamp', x: px, z: pz, r: 0.5, scale: range(1.7, 1.9), rotY, pathGap: PATH_WIDTH / 2 + 0.3 })
  } else {
    tryPlace({ model: 'deco-lantern-red', x: px, z: pz, r: 0.5, scale: range(1.3, 1.6), rotY, pathGap: PATH_WIDTH / 2 + 0.3 })
  }
})

// 6) 屋舍沿階地等高線排列：沿每層輪廓往內縮一點取樣，正面朝外（坡下）。
//    南側（面向鏡頭）的弧段排得最密，北側背面稀疏。每間屋有一半機率在門前掛一盞燈籠。
function houseRing(outline: Pt[], inset: number, count: number, jitter: number) {
  const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length
  const cz = outline.reduce((s, p) => s + p[1], 0) / outline.length
  for (let i = 0; i < count; i++) {
    const p = outline[Math.floor((i / count) * outline.length + rand() * 2) % outline.length] as Pt
    const dx = p[0] - cx
    const dz = p[1] - cz
    const len = Math.hypot(dx, dz) || 1
    const south = dz / len // 1 = 正南（鏡頭側）
    if (south < -0.35 && rand() < 0.6) continue // 背面稀疏
    const k = inset + range(0, jitter)
    const x = p[0] - (dx / len) * k
    const z = p[1] - (dz / len) * k
    const model = rand() < 0.55 ? 'deco-house-old-a' : 'deco-house-old-b'
    const scale = range(3, 4.1)
    const rotY = faceToward(dx, dz) + range(-0.25, 0.25)
    if (tryPlace({ model, x, z, r: scale * 0.55, scale, rotY }) && south > -0.2 && rand() < 0.5) {
      // 門前燈籠：放在屋子正面、偏一側
      const fx = Math.sin(rotY)
      const fz = Math.cos(rotY)
      const lat = rand() < 0.5 ? -1 : 1
      tryPlace({
        model: 'deco-lantern-red',
        x: x + fx * (scale * 0.55 + 0.5) + fz * lat * scale * 0.3,
        z: z + fz * (scale * 0.55 + 0.5) - fx * lat * scale * 0.3,
        r: 0.4,
        scale: range(1.2, 1.5),
        rotY,
      })
    }
  }
}

houseRing(T1, 2.6, 40, 1.2)
houseRing(T2, 2.4, 30, 1)
houseRing(T3, 2.2, 14, 0.8)
// 地面層：島緣內側一圈零星的海邊老屋（主要在基山街兩端）
houseRing(OUTLINE, 5, 26, 2)

// 6b) 階地前緣的燈籠：沿 T1、T2 朝南的邊緣內側一排，夜裡從鏡頭看是一層層往上的紅色光帶
function edgeLanterns(outline: Pt[], inset: number, every: number) {
  const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length
  const cz = outline.reduce((s, p) => s + p[1], 0) / outline.length
  for (let i = 0; i < outline.length; i += every) {
    const p = outline[i] as Pt
    const dx = p[0] - cx
    const dz = p[1] - cz
    const len = Math.hypot(dx, dz) || 1
    if (dz / len < 0.3) continue // 只排南側（鏡頭看得到的那面）
    tryPlace({ model: 'deco-lantern-red', x: p[0] - (dx / len) * inset, z: p[1] - (dz / len) * inset, r: 0.4, scale: range(1.2, 1.5), rotY: faceToward(dx, dz) })
  }
}
edgeLanterns(T1, 0.9, 2)
edgeLanterns(T2, 0.9, 2)
edgeLanterns(T3, 0.8, 2)

// 7) 樹：島緣一圈（地面層），南側用榕樹框住畫面，北側與高處用松樹撐出山的剪影
for (let i = 0; i < 60; i++) {
  const p = OUTLINE[i % OUTLINE.length] as Pt
  const t = (i / 60) * TAU * 1.5
  const inset = range(1.5, 4.5)
  const len = Math.hypot(p[0], p[1])
  const x = p[0] - (p[0] / len) * inset + Math.sin(t) * 1.2
  const z = p[1] - (p[1] / len) * inset + Math.cos(t) * 1.2
  if (p[1] / len > 0.2) tryPlace({ model: 'deco-tree-banyan', x, z, r: 2.2, scale: range(4.2, 5.6) })
  else tryPlace({ model: 'deco-tree-pine', x, z, r: 1.3, scale: range(3.4, 4.8) })
}
// T4 茶樓背後的松林
for (let i = 0; i < 12; i++) {
  const a = range(Math.PI * 1.05, Math.PI * 1.95)
  tryPlace({ model: 'deco-tree-pine', x: -15 + Math.cos(a) * range(4, 6), z: -13 + Math.sin(a) * range(3.2, 5), r: 1.1, scale: range(3, 4.2) })
}

// 8) 竹叢：輕便路北側與各層階地邊，最多 10 叢
{
  let n = 0
  for (let i = 0; i < 40 && n < 10; i++) {
    const nearLane = i < 12
    const x = nearLane ? range(-6, 5) : range(-22, 20)
    const z = nearLane ? range(-9.5, -7) : range(-18, 14)
    if (tryPlace({ model: 'deco-bamboo', x, z, r: 0.9, scale: range(2.6, 3.4) })) n++
  }
}

// 9) 第二排屋舍：在階地內部再補一些，讓屋頂層層疊疊（正面大致朝南）
for (let i = 0; i < 40; i++) {
  const x = range(-24, 22)
  const z = range(-20, 12)
  const scale = range(2.8, 3.8)
  tryPlace({ model: rand() < 0.5 ? 'deco-house-old-a' : 'deco-house-old-b', x, z, r: scale * 0.55, scale, rotY: range(-0.3, 0.3) })
}

// 10) 灌木與岩石：貼著各層階地崖腳（輪廓外側一點），讓牆腳不死板
function cliffFoot(outline: Pt[], count: number) {
  const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length
  const cz = outline.reduce((s, p) => s + p[1], 0) / outline.length
  for (let i = 0; i < count; i++) {
    const p = outline[Math.floor(rand() * outline.length)] as Pt
    const dx = p[0] - cx
    const dz = p[1] - cz
    const len = Math.hypot(dx, dz) || 1
    const out = range(1, 2)
    const isRock = rand() < 0.45
    tryPlace({
      model: isRock ? 'deco-rock' : 'deco-bush',
      x: p[0] + (dx / len) * out,
      z: p[1] + (dz / len) * out,
      r: 0.8,
      scale: isRock ? range(1.2, 2.2) : range(1.4, 2.2),
    })
  }
}
cliffFoot(T1, 16)
cliffFoot(T2, 10)
cliffFoot(T3, 6)

// ---------------------------------------------------------------------------
// 光線關鍵時刻
// 方位角約定（建議寫進契約）：0° = 北（-z）、90° = 東（+x）、180° = 南（+z）、270° = 西（-x）。
// 傍晚太陽落在西北西（約 290°），從鏡頭左後方打出長長的暖色側光。
// 夜間的「太陽」改當月光：方位從西南西緩慢往西南移（262°→220°），刻意不讓它在 18:30→19:00 之間
// 繞半圈跳到東方（相鄰關鍵時刻是線性插值，大幅換方位會讓影子掃過整座島）。
// lanternGlow 節奏：17:30 只有店面零星亮 → 18:30 藍調時刻快速點亮 → 19:30 幾乎全亮 → 20:15 滿。
// ---------------------------------------------------------------------------

const LIGHTING: LightKey[] = [
  // 清晨：時間滑桿從深夜回到白天之間的過渡，燈籠還留著一些
  { time: '06:00', skyTop: '#5d6fa8', skyBottom: '#f2b38a', fog: '#c9b2b0', sun: '#ffc79a', sunIntensity: 0.6, sunElevationDeg: 6, sunAzimuthDeg: 75, hemiSky: '#9fb0d6', hemiGround: '#5a4a42', hemiIntensity: 0.45, lanternGlow: 0.3 },
  // 正午：晴朗、乾淨、飽和的山城（讓拖到白天也好看）
  { time: '12:00', skyTop: '#5fa8e8', skyBottom: '#cfe9f5', fog: '#d8ecf2', sun: '#fff4e0', sunIntensity: 1.25, sunElevationDeg: 68, sunAzimuthDeg: 180, hemiSky: '#bfe0ff', hemiGround: '#6f7f4e', hemiIntensity: 0.75, lanternGlow: 0 },
  // 午後：陽光開始偏暖，影子拉長
  { time: '16:00', skyTop: '#6aa3dc', skyBottom: '#f3dcae', fog: '#e8dcc0', sun: '#ffe2a8', sunIntensity: 1.1, sunElevationDeg: 28, sunAzimuthDeg: 268, hemiSky: '#c6dcf0', hemiGround: '#6f6a48', hemiIntensity: 0.65, lanternGlow: 0 },
  // 夕陽：暖橘、整座島鍍金，店面先亮
  { time: '17:30', skyTop: '#6b6fb0', skyBottom: '#ff9a52', fog: '#f0a87a', sun: '#ff9a4a', sunIntensity: 1.0, sunElevationDeg: 7, sunAzimuthDeg: 290, hemiSky: '#e9a98a', hemiGround: '#5e4636', hemiIntensity: 0.55, lanternGlow: 0.12 },
  // 日落瞬間：天空最紅，燈籠開始一盞盞亮
  { time: '18:00', skyTop: '#4e4f92', skyBottom: '#ff7a4e', fog: '#c98270', sun: '#ff6e3a', sunIntensity: 0.55, sunElevationDeg: 1, sunAzimuthDeg: 292, hemiSky: '#a98aa8', hemiGround: '#4a3a34', hemiIntensity: 0.45, lanternGlow: 0.32 },
  // 藍調時刻：天空轉深藍、地平線殘留粉橘，燈籠快速點亮
  { time: '18:30', skyTop: '#2f3a78', skyBottom: '#d07a7a', fog: '#6f6488', sun: '#8f8fd0', sunIntensity: 0.28, sunElevationDeg: -2, sunAzimuthDeg: 295, hemiSky: '#6a74b0', hemiGround: '#3a3040', hemiIntensity: 0.4, lanternGlow: 0.62 },
  { time: '19:00', skyTop: '#2b2f5a', skyBottom: '#7a5f8f', fog: '#4f4a72', sun: '#8a96d8', sunIntensity: 0.22, sunElevationDeg: 18, sunAzimuthDeg: 262, hemiSky: '#4f5894', hemiGround: '#2e2838', hemiIntensity: 0.36, lanternGlow: 0.85 },
  // 藍紫夜：燈籠全亮，紅與藍紫的對比最強（封面時刻）
  { time: '19:30', skyTop: '#232650', skyBottom: '#4f4a80', fog: '#3a3a64', sun: '#9aa6e0', sunIntensity: 0.22, sunElevationDeg: 25, sunAzimuthDeg: 250, hemiSky: '#3f4888', hemiGround: '#2a2434', hemiIntensity: 0.34, lanternGlow: 0.96 },
  // 茶樓時刻：夜色定下來，海面只剩月光
  { time: '20:15', skyTop: '#1c1f44', skyBottom: '#353a6a', fog: '#2c2f55', sun: '#a6b2e8', sunIntensity: 0.24, sunElevationDeg: 32, sunAzimuthDeg: 238, hemiSky: '#343c78', hemiGround: '#221e2c', hemiIntensity: 0.32, lanternGlow: 1 },
  { time: '21:30', skyTop: '#151836', skyBottom: '#272b52', fog: '#20234a', sun: '#a6b2e8', sunIntensity: 0.22, sunElevationDeg: 40, sunAzimuthDeg: 226, hemiSky: '#2a3066', hemiGround: '#1c1824', hemiIntensity: 0.3, lanternGlow: 1 },
  // 深夜：店家陸續打烊，燈籠稍稍收斂
  { time: '22:00', skyTop: '#11132c', skyBottom: '#1f2346', fog: '#1a1d40', sun: '#9aa6dc', sunIntensity: 0.2, sunElevationDeg: 42, sunAzimuthDeg: 220, hemiSky: '#252a5c', hemiGround: '#18151f', hemiIntensity: 0.28, lanternGlow: 0.9 },
]

// ---------------------------------------------------------------------------

// 10) 峭壁岩塊(試做):直接貼在 60° 山壁上,tilt 讓它對齊坡面法線(面朝 +z),略埋進坡裡。
// 在所有 tryPlace 之後才放,不影響前面用亂數決定的擺放。
{
  const x = 8
  const z = -20
  scatter.push({
    model: 'deco-cliff-rock',
    x,
    z,
    y: round2(groundY(x, z) - 0.25),
    rotY: 0.6,
    scale: 2.2,
    tilt: [Math.PI / 3, 0],
    seed: 4242,
  })
}

export const ISLAND_LAYOUT: IslandLayout = {
  outline: OUTLINE,
  topY: 0,
  terraces: TERRACES,
  slopes: SLOPES,
  sea: { y: -3.5, color: '#2a4f78' },
  thickness: 7,
  river: { points: [], width: 2.5 },
  path: { points: PATH_POINTS, width: PATH_WIDTH },
  stops: STOPS,
  scatter,
  lighting: LIGHTING,
  palette: {
    grass: '#6f8f4e',
    grassAlt: '#86a35a',
    dirt: '#7a5a3e',
    water: '#3d6f8f',
    waterDeep: '#1f3b5c',
    path: '#9a9286',
  },
}
