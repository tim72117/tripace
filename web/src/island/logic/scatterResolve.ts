// scatterResolve.ts——裝飾散落物的避障與貼地(純函式)。
//
// 版面資料裡的 scatter 是「美術放的候選位置」,這裡把明顯有問題的剔除、其餘貼到正確高度:
// 在島外、擋在步道或河上、擠在站點建築旁、離島邊緣太近、騎在階地邊緣(半徑內高度不一致,
// 物件會一半懸空)。被剔除的都附原因,方便美術回頭調整。決定性:同輸入同輸出。
import type { IslandLayout, Placement, Pt } from '../data/layoutTypes'
import { dist, distToPolyline, pointInPolygon } from './geometry'
import { heightAt } from './terrain'

export type ResolvedPlacement = Placement & { y: number }

export type ResolveOpts = {
  pathLine: ReadonlyArray<Pt> // 平滑後的步道密集折線
  pathWidth: number
  stopClear: number // 站點建築周圍保留的半徑(加上物件半徑)
  edgeClear: number // 離島邊緣至少多遠
  radiusOf: (p: Placement) => number
}

// 物件可墊高的上限(格):蒸氣、掛在牆上的燈等。
export const MAX_RAISE = 4

type Ctx = Pick<IslandLayout, 'outline' | 'topY' | 'terraces' | 'stops' | 'river'>

export function resolveScatter(
  scatter: ReadonlyArray<Placement>,
  layout: Ctx,
  opts: ResolveOpts,
): { kept: ResolvedPlacement[]; dropped: Array<{ p: Placement; reason: string }> } {
  const kept: ResolvedPlacement[] = []
  const dropped: Array<{ p: Placement; reason: string }> = []
  const riverPts = layout.river?.points ?? []
  const riverHalf = (layout.river?.width ?? 0) / 2

  for (const p of scatter) {
    const r = opts.radiusOf(p)
    const drop = (reason: string) => dropped.push({ p, reason })
    if (!pointInPolygon(p.x, p.z, layout.outline)) { drop('在島外'); continue }
    // 離島邊緣:用輪廓各邊的最短距離(閉合多邊形)
    const ring = [...layout.outline, layout.outline[0]]
    if (distToPolyline(p.x, p.z, ring) < opts.edgeClear + r * 0.5) { drop('離島邊緣太近'); continue }
    if (opts.pathLine.length > 1 && distToPolyline(p.x, p.z, opts.pathLine) < opts.pathWidth / 2 + r) { drop('擋在步道上'); continue }
    if (riverPts.length > 1 && distToPolyline(p.x, p.z, riverPts) < riverHalf + r) { drop('落在河道上'); continue }
    if (layout.stops.some((s) => dist([p.x, p.z], [s.x, s.z]) < opts.stopClear + r)) { drop('擠在站點建築旁'); continue }
    // 階地邊緣:中心與四個方向的取樣點高度必須一致,否則物件會一半懸空
    const h = heightAt(layout, p.x, p.z)
    const around = [[r, 0], [-r, 0], [0, r], [0, -r]].map(([dx, dz]) => heightAt(layout, p.x + dx, p.z + dz))
    if (around.some((a) => Math.abs(a - h) > 1e-6)) { drop('騎在階地邊緣'); continue }
    // y 的規則:契約的 y 是「腳底高度」。放在攤位上方的蒸氣這類物件會刻意把 y 墊高,所以
    // 只要 y 落在「地面到地面上方 MAX_RAISE」之間就保留;沒填或不合理(低於地面、高得離譜)
    // 一律以地面高度為準,不剔除、仍保留位置。
    const raised = p.y !== undefined && p.y >= h - 1e-6 && p.y <= h + MAX_RAISE
    kept.push({ ...p, y: raised ? p.y! : h })
  }
  return { kept, dropped }
}
