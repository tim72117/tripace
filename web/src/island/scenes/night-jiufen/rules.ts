// rules.ts——「夜遊九份」的程序化擺放規則(烘焙時執行,執行時不載入)。
//
// 讀 world/ 的各層資料(地形、步道、平台),輸出散落物;烘焙腳本(web/scripts/island/bake.ts)把結果依格子寫進
// world/cells/*.json(source: 'rule'),手擺的(source: 'hand',例如昇平戲院、小石階、石階磚)保留不動。
//
// 每個圖層用自己的亂數種子(scene.json 的 layers.<名稱>.seed,沒寫就由場景種子與名稱推出):改一層的規則或種子,
// 其他圖層的位置不會跟著重抽。松林以格子為單位取種子(cellRng),重烤一格不影響別格。
// 圖層之間共用「已佔用的圓」(placed),所以執行順序 = 優先順序:先放指定位置的彩蛋與攤位、沿步道的燈,
// 最後才用屋舍、樹木填滿。順序就是 scene.json layers 的順序(由 RULE_LAYERS 檢查)。
//
// 所有長度是公尺(1 格 = 1 m)。這份規則的數值是 2026-10 從舊版面精確換算來的(見 world/README.md)。
import type { Placement, Pt } from '../../data/layoutTypes'
import { pointInPolygon } from '../../logic/geometry'
import { mulberry32 } from '../../logic/rng'
import { heightAt } from '../../logic/terrain'
import { cellKey, cellOf, cellRng, layerSeed } from '../../logic/world/grid'
import type { AssembledScene, CellPlacement } from '../../logic/world/sceneFormat'
import houseOldA from '../../models/deco-house-old-a'

// 規則實作的圖層與順序(scene.json 的 layers 必須一致)
export const RULE_LAYERS = [
  'string-lights', 'stalls', 'cats', 'landmarks', 'plaza', 'path-lights', 'houses', 'row-lights',
  'pines', 'banyans', 'bamboo', 'ground-cover', 'cliff-rocks',
] as const
type Layer = (typeof RULE_LAYERS)[number]

const TAU = Math.PI * 2
const round2 = (n: number) => Math.round(n * 100) / 100
const faceToward = (dx: number, dz: number) => Math.atan2(dx, dz) // 模型正面 +Z 轉向 (dx, dz) 方向的 rotY
const lerp2 = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

function distToSegment(x: number, z: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / len2))
  return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz))
}

// 不可放置的區域:站點腳印(線段 + 半徑)
const KEEP_OUT_SEGMENTS: Array<{ a: Pt; b: Pt; r: number }> = [
  { a: [-21.875, -2.5], b: [3.125, -2.5], r: 4.6875 }, // 基山街
  { a: [9.375, 0.78125], b: [9.375, 24.21875], r: 5.625 }, // 豎崎路
  { a: [0.78125, 25.3125], b: [-13.4375, 18.75], r: 5.3125 }, // 輕便路
  { a: [-13.4375, 19.53125], b: [-13.4375, 10.15625], r: 2.5 }, // 小石階
  { a: [-3.125, 7.8125], b: [-3.125, 7.8125], r: 7.03125 }, // 阿妹茶樓
  { a: [20.3125, 18.125], b: [29.6875, 18.125], r: 5 }, // 昇平戲院
]
const LANE_A: Pt = [0.78125, 25.3125] // 輕便路的兩端(與 KEEP_OUT_SEGMENTS 的輕便路一致)
const LANE_B: Pt = [-13.4375, 18.75]
const SPARSE_ROWS = new Set(['R7w', 'R8w'])
// 擺放後的縮放 = 模型 unit × scale:老屋兩款的 unit 相同;蒸氣疊在攤位上緣(deco-stall 高約 1.1 單位 × unit 2.15 m)
const HOUSE_UNIT = houseOldA.unit ?? 1
const STALL_TOP = 2.15 * 1.05

type TryOpts = {
  model: string
  x: number
  z: number
  r: number // 腳印半徑(m)
  scale: number
  rotY?: number
  tol?: number // 地面起伏容許(m,預設 1e-6 = 要平台)
  flatR?: number // 檢查地面平整的半徑(預設 r × 0.7)
  pathGap?: number // 與步道中線的最小距離(預設 = 步道半寬 + r)
  overlapOk?: boolean // 允許與其他散落物重疊(例如蒸氣疊在攤位上)
  yOffset?: number // 額外抬高(例如蒸氣放在攤位上緣)
  ignoreKeepOut?: boolean // 忽略站點腳印(例如跨在步道入口的燈籠串)
}

export function generatePlacements(scene: AssembledScene): CellPlacement[] {
  const { layout, manifest } = scene
  const names = Object.keys(manifest.layers)
  if (names.join(',') !== RULE_LAYERS.join(',')) throw new Error(`scene.json 的 layers 必須依序為:${RULE_LAYERS.join(', ')}`)
  const seedOf = (l: Layer) => manifest.layers[l]?.seed ?? layerSeed(manifest.seed, l)
  const groundY = (x: number, z: number) => heightAt(layout, x, z)
  const OUTLINE = layout.outline
  const PATH_POINTS = layout.path.points
  const PATH_WIDTH = layout.path.width
  const ROWS: Array<[string, Pt[]]> = scene.pads.filter((p) => p.kind === 'row').map((p) => [p.id, p.outline])

  const placed: Array<{ x: number; z: number; r: number }> = []
  const out: CellPlacement[] = []
  let layer: Layer = RULE_LAYERS[0]
  let rand = mulberry32(seedOf(layer))
  const range = (min: number, max: number) => min + rand() * (max - min)
  const begin = (l: Layer) => { layer = l; rand = mulberry32(seedOf(l)) }
  const push = (p: Placement) => out.push({ ...p, layer, source: 'rule' })

  const distToPath = (x: number, z: number) => {
    let d = Infinity
    for (let i = 0; i < PATH_POINTS.length - 1; i++) d = Math.min(d, distToSegment(x, z, PATH_POINTS[i], PATH_POINTS[i + 1]))
    return d
  }
  // 腳印落在夠平的地面:周圍 8 個取樣點與中心的高度差都不超過 tol
  const flatFootprint = (x: number, z: number, r: number, y: number, tol: number) => {
    if (!pointInPolygon(x, z, OUTLINE)) return false
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU
      const px = x + Math.cos(a) * r
      const pz = z + Math.sin(a) * r
      if (!pointInPolygon(px, pz, OUTLINE) || Math.abs(groundY(px, pz) - y) > tol) return false
    }
    return true
  }
  const tryPlace = (o: TryOpts): boolean => {
    const y = groundY(o.x, o.z)
    if (!flatFootprint(o.x, o.z, o.flatR ?? o.r * 0.7, y, o.tol ?? 1e-6)) return false
    if (distToPath(o.x, o.z) < (o.pathGap ?? PATH_WIDTH / 2 + o.r)) return false
    if (!o.ignoreKeepOut) for (const s of KEEP_OUT_SEGMENTS) if (distToSegment(o.x, o.z, s.a, s.b) < s.r + o.r * 0.8) return false
    if (!o.overlapOk) for (const c of placed) if (Math.hypot(c.x - o.x, c.z - o.z) < c.r + o.r) return false
    if (!o.overlapOk) placed.push({ x: o.x, z: o.z, r: o.r })
    push({
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
  const walkPath = (spacing: number, fn: (x: number, z: number, nx: number, nz: number, i: number) => void) => {
    let carry = 0
    let n = 0
    for (let i = 0; i < PATH_POINTS.length - 1; i++) {
      const [ax, az] = PATH_POINTS[i]
      const [bx, bz] = PATH_POINTS[i + 1]
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
  const stall = (x: number, z: number, rotY: number, pathGap?: number) => {
    const scale = range(2 / 2.15, 2.3 / 2.15)
    if (tryPlace({ model: 'deco-stall', x, z, r: 1.71875, scale, rotY, pathGap, ignoreKeepOut: true })) {
      tryPlace({ model: 'deco-steam', x: x + range(-0.4, 0.4), z: z + range(-0.3, 0.3), r: 0.625, scale: range(1.1 / 1.3, 1.5 / 1.3), pathGap: 0, overlapOk: true, yOffset: STALL_TOP * scale })
    }
  }

  // 1) 跨步道的燈籠串:基山街西口、豎崎路頂與底、茶樓正面(觀景重點,允許跨在步道上)
  begin('string-lights')
  for (const [x, z, a] of [[-24.21875, -1.875, 0.3], [9.375, 0.3125, 0], [9.375, 22.1875, 0], [-6.25, 14.0625, 0]]) {
    tryPlace({ model: 'deco-lantern-string', x, z, r: 0.9375, scale: 1, rotY: a, pathGap: 0, overlapOk: true, ignoreKeepOut: true, tol: 1.5625 })
  }

  // 2) 小吃攤與蒸氣:基山街西口、豎崎路頂與底、公車站旁
  begin('stalls')
  for (const [x, z, rotY] of [[-22.65625, 0.9375, faceToward(0, -1)], [14.84375, -4.0625, faceToward(-1, 0)], [14.84375, 26.875, faceToward(0, -1)], [-39.0625, 1.875, faceToward(0, -1)]]) {
    stall(x, z, rotY, PATH_WIDTH / 2 + 0.9375)
  }

  // 3) 貓:石階底、輕便路口南側、茶樓肩西側、公車站(找附近可放的位置)
  begin('cats')
  for (const [x, z, rotY] of [[14.0625, 25.78125, -0.6], [0.78125, 27.65625, 0.4], [-18.75, 9.375, -0.3], [-40.625, 0.78125, 0.5]]) {
    for (let k = 0; k < 8; k++) {
      if (tryPlace({ model: 'deco-cat', x: x + range(-1.25, 1.25), z: z + range(-1.25, 1.25), r: 0.625, scale: range(0.92, 1.08), rotY, pathGap: PATH_WIDTH / 2 + 0.46875, tol: 0.46875 })) break
    }
  }

  // 4) 大茶壺地標:茶樓肩西側(終點彩蛋)
  begin('landmarks')
  tryPlace({ model: 'deco-teapot', x: -17.1875, z: 6.25, r: 1.5625, scale: 1, rotY: -0.9, pathGap: PATH_WIDTH / 2 + 0.625 })

  // 4b) 昇平戲院門前廣場的擺設(戲院本體是手擺,在 cells/ 裡):都在 P7 內,中央刻意留空,讓戲院正面從封面看得到
  begin('plaza')
  for (const x of [21.5625, 28.4375]) {
    tryPlace({ model: 'deco-lantern-string', x, z: 25.3125, r: 0.9375, scale: 1, rotY: 0, pathGap: 0, overlapOk: true, ignoreKeepOut: true, tol: 1.5625 })
  }
  for (const x of [19.6875, 31.5625]) stall(x, 26.5625, faceToward(0, -1))
  // 廣場四角的立燈籠,面向廣場中心
  for (const [x, z] of [[18.125, 23.75], [33.125, 23.75], [18.125, 27.5], [33.125, 27.5]]) {
    tryPlace({ model: 'deco-lantern-red', x, z, r: 0.625, scale: range(1.3 / 1.4, 1.6 / 1.4), rotY: faceToward(25 - x, 25.9375 - z), tol: 0.546875, ignoreKeepOut: true })
  }
  tryPlace({ model: 'deco-cat', x: 23.75, z: 24.0625, r: 0.625, scale: range(0.92, 1.08), rotY: 0.6, tol: 0.46875, ignoreKeepOut: true })
  tryPlace({ model: 'deco-cat', x: 30.46875, z: 23.90625, r: 0.625, scale: range(0.92, 1.08), rotY: -0.4, tol: 0.46875, ignoreKeepOut: true })

  // 5) 沿步道兩側的燈籠與路燈:每隔一段距離左右交替放;離輕便路線段 5.5 m 以內改用安靜的路燈,其餘是紅燈籠
  begin('path-lights')
  walkPath(2.8125, (x, z, nx, nz, i) => {
    const side = i % 2 ? 1 : -1
    const off = PATH_WIDTH / 2 + range(0.9375, 2.03125)
    const px = x + nx * off * side
    const pz = z + nz * off * side
    const quiet = distToSegment(px, pz, LANE_A, LANE_B) <= 5.46875
    const rotY = faceToward(-nx * side, -nz * side)
    if (quiet) {
      if (i % 2 === 0) tryPlace({ model: 'deco-street-lamp', x: px, z: pz, r: 0.78125, scale: range(1.7 / 1.8, 1.9 / 1.8), rotY, pathGap: PATH_WIDTH / 2 + 0.46875, tol: 0.546875 })
    } else {
      tryPlace({ model: 'deco-lantern-red', x: px, z: pz, r: 0.78125, scale: range(1.3 / 1.4, 1.6 / 1.4), rotY, pathGap: PATH_WIDTH / 2 + 0.46875, tol: 0.546875 })
    }
  })

  // 6) 屋舍沿每條屋排的長軸排列,正面朝坡下(南,鏡頭);每間屋有一半機率在門前掛一盞燈籠
  begin('houses')
  for (const [id, outline] of ROWS) {
    const [a, b, c, d] = outline as [Pt, Pt, Pt, Pt] // a→b 北緣、d→c 南緣
    const lenAB = Math.hypot(b[0] - a[0], b[1] - a[1])
    const ux = (b[0] - a[0]) / lenAB
    const uz = (b[1] - a[1]) / lenAB
    const rotBase = faceToward(-uz, ux) // 長軸 u 的右手法線(u=(1,0) 時朝 +z)
    const sparse = SPARSE_ROWS.has(id)
    let cursor = 1.875 // 沿長軸已走的距離(從西端起,留出 pad 邊緣)
    while (cursor < lenAB - 1.875) {
      const useA = rand() < 0.65
      const scale = range(3 / 3.55, 4.1 / 3.55)
      const size = HOUSE_UNIT * scale
      const r = useA ? size * 0.35 : size * 0.62 // old-a 窄(寬約 0.6 × size)、old-b 寬(約 1.2 × size)
      const t = (cursor + r) / lenAB
      if (t > 1) break
      const [px, pz] = lerp2(lerp2(a, b, t), lerp2(d, c, t), 0.5)
      const rotY = rotBase + range(-0.15, 0.15)
      const ok = tryPlace({ model: useA ? 'deco-house-old-a' : 'deco-house-old-b', x: px, z: pz, r, scale, rotY, flatR: Math.min(r * 0.7, 1.71875) })
      if (ok && rand() < 0.5) {
        const fx = Math.sin(rotY)
        const fz = Math.cos(rotY)
        const lat = rand() < 0.5 ? -1 : 1
        tryPlace({ model: 'deco-lantern-red', x: px + fx * (r + 0.78125) + fz * lat * r * 0.5, z: pz + fz * (r + 0.78125) - fx * lat * r * 0.5, r: 0.625, scale: range(1.2 / 1.4, 1.5 / 1.4), rotY, tol: 0.546875 })
      }
      cursor += 2 * r + (sparse ? range(1.875, 3.4375) : range(0.15625, 0.9375))
    }
  }

  // 6b) 屋排前緣的燈帶:沿每條屋排朝南(鏡頭)的長邊,往內約 0.5 m,每 3.9 m 一盞
  begin('row-lights')
  for (const [, outline] of ROWS) {
    const [a, b, c, d] = outline as [Pt, Pt, Pt, Pt]
    const len = Math.hypot(c[0] - d[0], c[1] - d[1])
    for (let s = 1.5625; s < len - 0.78125; s += 3.90625) {
      const south = lerp2(d, c, s / len)
      const north = lerp2(a, b, s / len)
      const [x, z] = lerp2(south, north, 0.46875 / Math.hypot(north[0] - south[0], north[1] - south[1]))
      tryPlace({ model: 'deco-lantern-red', x, z, r: 0.625, scale: range(1.2 / 1.4, 1.5 / 1.4), rotY: faceToward(0, 1), tol: 0.546875, overlapOk: true })
    }
  }

  // 7a) 松林:y > 23.4 的坡面,山頂附近(y > 46.9)不種;格點抖動,約 30% 做林窗。
  //     亂數以格子為單位(cellRng):每個格點用它所在格子的亂數序列,重烤一格只影響那一格
  begin('pines')
  {
    const seed = seedOf('pines')
    const rngs = new Map<string, () => number>()
    let n = 0
    for (let x = -68.75; x <= 68.75 && n < 70; x += 4.0625) {
      for (let z = -50; z <= -6.25 && n < 70; z += 4.0625) {
        const cell = cellOf(manifest.grid, x, z)
        const k = cellKey(cell)
        if (!rngs.has(k)) rngs.set(k, cellRng(seed, cell))
        rand = rngs.get(k)!
        const px = x + range(-1.875, 1.875)
        const pz = z + range(-1.875, 1.875)
        const gy = groundY(px, pz)
        if (gy <= 23.4375 || gy > 46.875 || rand() < 0.3) continue
        if (tryPlace({ model: 'deco-tree-pine', x: px, z: pz, r: 2.03125, scale: range(3.4 / 4.1, 4.8 / 4.1), tol: 2.8125 })) n++
      }
    }
  }

  // 7b) 榕樹:海岸帶與兩道山溝的谷底,框住畫面左右
  begin('banyans')
  {
    let n = 0
    const zones: Array<[number, number, number, number]> = [[-40.625, 37.5, 28.125, 48.4375], [-62.5, -46.875, 3.125, 34.375], [43.75, 62.5, 0, 31.25]] // [x0, x1, z0, z1]
    for (let i = 0; i < 80 && n < 12; i++) {
      const [x0, x1, z0, z1] = zones[i % zones.length]
      if (tryPlace({ model: 'deco-tree-banyan', x: range(x0, x1), z: range(z0, z1), r: 3.4375, scale: range(4.2 / 4.9, 5.6 / 4.9), tol: 2.34375 })) n++
    }
  }

  // 7c) 竹叢:輕便路南側(下坡側)與山溝邊,最多 10 叢
  begin('bamboo')
  {
    let n = 0
    for (let i = 0; i < 60 && n < 10; i++) {
      const nearLane = i < 20
      const x = nearLane ? range(-9.375, 4.6875) : range(-59.375, -46.875)
      const z = nearLane ? range(-1.5625, 1.5625) : range(0, 21.875)
      if (tryPlace({ model: 'deco-bamboo', x, z, r: 1.40625, scale: range(2.6 / 3, 3.4 / 3), tol: 1.5625 })) n++
    }
  }

  // 8) 灌木與岩石:屋排外側 1.5~3 m 的土坎、海岸礁岸,約 40 個
  begin('ground-cover')
  {
    let n = 0
    for (let i = 0; i < 200 && n < 40; i++) {
      const [, outline] = ROWS[Math.floor(rand() * ROWS.length)]
      const useShore = i % 4 === 3
      const x = useShore ? range(-37.5, 43.75) : range(Math.min(...outline.map((p) => p[0])) - 2.34375, Math.max(...outline.map((p) => p[0])) + 2.34375)
      const z = useShore ? range(43.75, 51.5625) : range(Math.min(...outline.map((p) => p[1])) - 3.125, Math.max(...outline.map((p) => p[1])) + 3.125)
      const isRock = rand() < 0.45
      if (tryPlace({ model: isRock ? 'deco-rock' : 'deco-bush', x, z, r: 1.25, scale: isRock ? range(1.2 / 1.7, 2.2 / 1.7) : range(1.4 / 1.8, 2.2 / 1.8), tol: 0.9375 })) n++
    }
  }

  // 10) 峭壁岩塊:東側溪谷壁與基隆山陡面,tilt 對齊坡面法線(用 groundY 的差分算),略埋進坡裡。最多 5 個
  begin('cliff-rocks')
  {
    let n = 0
    const e = 0.9375
    for (let i = 0; i < 200 && n < 5; i++) {
      const x = range(43.75, 68.75)
      const z = range(-40.625, 21.875)
      const gx = (groundY(x + e, z) - groundY(x - e, z)) / (2 * e)
      const gz = (groundY(x, z + e) - groundY(x, z - e)) / (2 * e)
      if (Math.hypot(gx, gz) < 0.85 || !pointInPolygon(x, z, OUTLINE) || placed.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 3.90625)) continue
      // 法線 n = (-gx, 1, -gz)/|.|;模型的「上方」先繞 X、Z 軸傾斜(Euler XZ)對到法線
      const ny = 1 / Math.hypot(gx, 1, gz)
      const tilt: [number, number] = [Math.atan2(-gz * ny, ny), -Math.atan2(-gx * ny, ny)]
      placed.push({ x, z, r: 3.125 })
      push({ model: 'deco-cliff-rock', x: round2(x), z: round2(z), y: round2(groundY(x, z) - 0.390625), rotY: round2(range(0, TAU)), scale: round2(range(1.8 / 2.2, 2.6 / 2.2)), tilt: [round2(tilt[0]), round2(tilt[1])], seed: Math.floor(rand() * 1e6) })
      n++
    }
  }

  return out
}
