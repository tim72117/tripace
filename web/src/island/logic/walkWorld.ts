// walkWorld.ts——由版面組出人物走動的「世界」(純函式,碰撞索引由呼叫端傳入)。
//
// 腳底高度:站在步道路面範圍內(離中線 ≤ 半寬 + 0.5)取步道剖面高度(石階的踏面,+0.06 與畫出來的路面一致);其他地方取地面高度。
// 在島內:輪廓內、且離島緣至少 EDGE_MARGIN(不讓人物走到懸崖邊)。
import type { IslandLayout, Pt } from '../data/layoutTypes'
import { pointInPolygon } from './geometry'
import type { PathCurve } from './pathCurve'
import type { WalkWorld } from './walk'

export const EDGE_MARGIN = 0.8
export const PATH_RIBBON_EXTRA = 0.5

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
    surfaceY(x, z) {
      const s = curve.nearestArc(x, z)
      const p = curve.at(s)
      if (Math.hypot(p.x - x, p.z - z) <= ribbon) return pathY(s, x, z) + 0.06
      return groundY(x, z)
    },
    blocked,
  }
}
