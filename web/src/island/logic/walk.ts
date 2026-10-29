// walk.ts——人物在島上走動的移動規則(純函式,不依賴 three)。
//
// 一個「世界」(WalkWorld)只回答三件事:這個點在不在島內、這個點的腳底高度(地面,或步道的路面)、
// 這個圓(人物)會不會撞到東西。人物每一步:先試完整位移,不行再分別試 x、z 單軸(沿著牆滑),都不行就停住。
// 高度差限制(maxStep)同時擋住「爬上陡坡」與「跳下斷崖」:石階旁邊的地面被刻意切得比踏面低,所以只能走在石階上;
// 站在步道上時腳底高度取步道路面(石階的踏面),不是地面。
export type Pt = [number, number]
export type Poly = Pt[]

export type WalkWorld = {
  inside(x: number, z: number): boolean // 在島內(含離邊緣的安全距離)
  // 該點的腳底高度;nearY(目前腳底高度)用來在重疊的路面之間選最接近的那段,見 walkWorld.ts
  surfaceY(x: number, z: number, nearY?: number): number
  blocked(x: number, z: number, r: number): boolean // 半徑 r 的圓會撞到固體
}
export type WalkOpts = { radius: number; maxStep: number }
export type WalkState = { x: number; z: number; y: number }

// ---- 幾何 ----

// 凸包(Andrew monotone chain),回傳逆時針(x 右、z 下的座標系裡看起來是順時針,不影響碰撞判斷)
export function convexHull(points: ReadonlyArray<Pt>): Poly {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Pt[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Pt[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

function distToSeg(x: number, z: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dz = b[1] - a[1]
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / len2))
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t))
}

function inConvex(x: number, z: number, poly: Poly): boolean {
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0])
    if (Math.abs(c) < 1e-12) continue
    if (sign === 0) sign = Math.sign(c)
    else if (Math.sign(c) !== sign) return false
  }
  return true
}

// circleHitsPoly——圓(x, z, r)與凸多邊形有沒有重疊(圓心在內,或到任一邊的距離 < r)
export function circleHitsPoly(x: number, z: number, r: number, poly: Poly): boolean {
  if (poly.length === 0) return false
  if (poly.length === 1) return Math.hypot(x - poly[0][0], z - poly[0][1]) < r
  if (poly.length >= 3 && inConvex(x, z, poly)) return true
  for (let i = 0; i < poly.length; i++) if (distToSeg(x, z, poly[i], poly[(i + 1) % poly.length]) < r) return true
  return false
}

// 格子雜湊索引:碰撞查詢只比對附近格子裡的多邊形
export function createColliderIndex(polys: ReadonlyArray<Poly>, cell = 4) {
  const grid = new Map<string, number[]>()
  const key = (cx: number, cz: number) => `${cx},${cz}`
  polys.forEach((poly, i) => {
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1])
    for (let cx = Math.floor(Math.min(...xs) / cell); cx <= Math.floor(Math.max(...xs) / cell); cx++) {
      for (let cz = Math.floor(Math.min(...zs) / cell); cz <= Math.floor(Math.max(...zs) / cell); cz++) {
        const k = key(cx, cz)
        const list = grid.get(k)
        if (list) list.push(i)
        else grid.set(k, [i])
      }
    }
  })
  return {
    count: polys.length,
    hits(x: number, z: number, r: number): boolean {
      for (let cx = Math.floor((x - r) / cell); cx <= Math.floor((x + r) / cell); cx++) {
        for (let cz = Math.floor((z - r) / cell); cz <= Math.floor((z + r) / cell); cz++) {
          for (const i of grid.get(key(cx, cz)) ?? []) if (circleHitsPoly(x, z, r, polys[i])) return true
        }
      }
      return false
    },
  }
}

// ---- 移動 ----

function canStand(world: WalkWorld, o: WalkOpts, fromY: number, x: number, z: number): { ok: boolean; y: number } {
  if (!world.inside(x, z) || world.blocked(x, z, o.radius)) return { ok: false, y: fromY }
  const y = world.surfaceY(x, z, fromY)
  return { ok: Math.abs(y - fromY) <= o.maxStep, y }
}

// tryStep——從 from 位移 (dx, dz):先完整位移,不行就只走 x、只走 z(沿牆滑),都不行就原地。
export function tryStep(world: WalkWorld, o: WalkOpts, from: WalkState, dx: number, dz: number): WalkState & { moved: boolean } {
  for (const [sx, sz] of [[dx, dz], [dx, 0], [0, dz]] as Array<[number, number]>) {
    if (sx === 0 && sz === 0) continue
    const r = canStand(world, o, from.y, from.x + sx, from.z + sz)
    if (r.ok) return { x: from.x + sx, z: from.z + sz, y: r.y, moved: true }
  }
  return { ...from, moved: false }
}

// 朝目標走一步(最多 step 格);回傳位移與是否已到達
export function steerToward(from: Pt, target: Pt, step: number, arriveDist = 0.12): { dx: number; dz: number; arrived: boolean } {
  const dx = target[0] - from[0], dz = target[1] - from[1]
  const d = Math.hypot(dx, dz)
  if (d <= arriveDist) return { dx: 0, dz: 0, arrived: true }
  const k = Math.min(1, step / d)
  return { dx: dx * k, dz: dz * k, arrived: d - step <= arriveDist }
}

// ---- 跟隨(小孩跟在家長身後)----

// trailPointBehind——沿軌跡(最後一點是現在位置)往回走 dist 格的位置;軌跡不夠長就回傳最舊的點。
export function trailPointBehind(trail: ReadonlyArray<Pt>, dist: number): Pt {
  let left = dist
  for (let i = trail.length - 1; i > 0; i--) {
    const a = trail[i], b = trail[i - 1]
    const seg = Math.hypot(a[0] - b[0], a[1] - b[1])
    if (seg >= left) { const t = seg === 0 ? 0 : left / seg; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] }
    left -= seg
  }
  return trail[0] ?? [0, 0]
}

// 記錄軌跡:移動超過 minGap 才加點,最多保留 max 點
export function pushTrail(trail: Pt[], p: Pt, minGap = 0.15, max = 160): void {
  const last = trail[trail.length - 1]
  if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < minGap) return
  trail.push(p)
  if (trail.length > max) trail.splice(0, trail.length - max)
}
