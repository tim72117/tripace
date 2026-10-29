// walkWorld.ts——由版面組出人物走動的「世界」(純函式,碰撞索引由呼叫端傳入)。
//
// 腳底高度:站在步道路面範圍內(離中線 ≤ 半寬 + PATH_RIBBON_EXTRA)取步道剖面高度(石階的踏面,+0.06 與畫出來的路面一致);
// 其他地方取地面高度。步道轉彎處可能有好幾段路面範圍重疊、高度不同(例如小石階上段的東側就是高約 1 m 的茶樓肩步道):
// 平常取最近那段的高度;有給 nearY(目前的腳底高度)而最近那段比它高或低超過 OVERLAP_JUMP 時,改取重疊各段裡最接近 nearY 的,
// 人物沿著自己正在走的那段路走,不會被旁邊另一段的高度擋住。只在高差夠大時才改選:否則走到路口時會黏在舊的那段、一路滑下去。
export const OVERLAP_JUMP = 0.45
// 在島內:輪廓內、且離島緣至少 EDGE_MARGIN(不讓人物走到懸崖邊)。
import type { IslandLayout, Pt } from '../data/layoutTypes'
import { pointInPolygon } from './geometry'
import type { PathCurve } from './pathCurve'
import type { WalkWorld } from './walk'

export const EDGE_MARGIN = 0.8
export const PATH_RIBBON_EXTRA = 0.78

function distToRing(x: number, z: number, ring: ReadonlyArray<Pt>): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i]
    const [x2, z2] = ring[(i + 1) % ring.length]
    const dx = x2 - x1, dz = z2 - z1
    const len2 = dx * dx + dz * dz
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / len2))
    best = Math.min(best, Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t)))
  }
  return best
}

export function makeWalkWorld(args: {
  layout: Pick<IslandLayout, 'outline' | 'path'>
  curve: PathCurve
  groundY: (x: number, z: number) => number
  pathY: (s: number, x: number, z: number) => number
  blocked: (x: number, z: number, r: number) => boolean
}): WalkWorld {
  const { layout, curve, groundY, pathY, blocked } = args
  const ribbon = layout.path.width / 2 + PATH_RIBBON_EXTRA
  return {
    inside: (x, z) => pointInPolygon(x, z, layout.outline) && distToRing(x, z, layout.outline) >= EDGE_MARGIN,
    surfaceY(x, z, nearY) {
      const s = curve.nearestArc(x, z)
      const p = curve.at(s)
      const onPath = Math.hypot(p.x - x, p.z - z) <= ribbon
      const nearest = onPath ? pathY(s, x, z) + 0.06 : groundY(x, z)
      if (nearY === undefined || !onPath || Math.abs(nearest - nearY) <= OVERLAP_JUMP) return nearest
      // 路面範圍內的每個取樣點都是一個候選高度
      let best = nearest
      for (const q of curve.samples) {
        if (Math.hypot(q.x - x, q.z - z) > ribbon) continue
        const y = pathY(q.s, x, z) + 0.06
        if (Math.abs(y - nearY) < Math.abs(best - nearY)) best = y
      }
      return best
    },
    blocked,
  }
}
