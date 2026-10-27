// terrain.ts——由版面資料算地面高度(純函式)。
//
// 九份是依山而建的階梯山城:layout.terraces 是一組疊起來的階地(頂視圖多邊形加頂面高度 y)。
// 任一點的地面高度 = 所有包含該點的階地與斜坡(layout.slopes,沿方向線性升高)裡最高的;都不在內就是最低層 topY。
// 渲染層擠出階地、把步道/建築/旅人貼地、散落物落在正確高度,都用這支函式,
// 避免各處各算一套。
import type { IslandLayout } from '../data/layoutTypes'
import { pointInPolygon } from './geometry'

export type Slope = NonNullable<IslandLayout['slopes']>[number]

// slopeHeightAt——斜面在 (x, z) 的高度:把點投影到 from→to 方向線上取比例 t(夾在 0~1),y0 + (y1 - y0) * t。
// 只看沿方向線的分量,橫向位置不影響高度;from 與 to 重合時取 y0。
export function slopeHeightAt(s: Pick<Slope, 'from' | 'to' | 'y0' | 'y1'>, x: number, z: number): number {
  const dx = s.to[0] - s.from[0]
  const dz = s.to[1] - s.from[1]
  const len2 = dx * dx + dz * dz
  if (len2 === 0) return s.y0
  const t = Math.max(0, Math.min(1, ((x - s.from[0]) * dx + (z - s.from[1]) * dz) / len2))
  return s.y0 + (s.y1 - s.y0) * t
}

export function heightAt(layout: Pick<IslandLayout, 'topY' | 'terraces' | 'slopes'>, x: number, z: number): number {
  let h = layout.topY
  for (const t of layout.terraces ?? []) {
    if (t.y > h && pointInPolygon(x, z, t.outline)) h = t.y
  }
  for (const s of layout.slopes ?? []) {
    if (!pointInPolygon(x, z, s.outline)) continue
    const sh = slopeHeightAt(s, x, z)
    if (sh > h) h = sh
  }
  return h
}
