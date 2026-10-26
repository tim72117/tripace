// terrain.ts——由版面資料算地面高度(純函式)。
//
// 九份是依山而建的階梯山城:layout.terraces 是一組疊起來的階地(頂視圖多邊形加頂面高度 y)。
// 任一點的地面高度 = 所有包含該點的階地裡最高的 y;不在任何階地內就是最低層 topY。
// 渲染層擠出階地、把步道/建築/旅人貼地、散落物落在正確高度,都用這支函式,
// 避免各處各算一套。
import type { IslandLayout } from '../data/layoutTypes'
import { pointInPolygon } from './geometry'

export function heightAt(layout: Pick<IslandLayout, 'topY' | 'terraces'>, x: number, z: number): number {
  let h = layout.topY
  for (const t of layout.terraces ?? []) {
    if (t.y > h && pointInPolygon(x, z, t.outline)) h = t.y
  }
  return h
}
