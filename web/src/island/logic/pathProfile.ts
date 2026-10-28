// pathProfile.ts——步道的高度剖面(純函式):弧長 s → 路面高度。
//
// 有 controlY(與 path.points 一一對應的腳底高度)就依各控制點在曲線上的弧長線性內插(石階、先下再上都靠它);
// 沒有就由 heightAt(地面高度)推。pathMesh(畫路面)與人物走動(腳底高度)共用同一份,才不會一個走在路面上、一個陷進地裡。
import type { Pt } from '../data/layoutTypes'
import type { PathCurve } from './pathCurve'

export function buildPathProfile(
  points: ReadonlyArray<Pt>,
  curve: PathCurve,
  heightAt: (x: number, z: number) => number,
  controlY?: ReadonlyArray<number>,
): { hasControl: boolean; at(s: number, x: number, z: number): number } {
  const ctrlArcs = controlY && controlY.length === points.length ? points.map(([x, z]) => curve.nearestArc(x, z)) : null
  return {
    hasControl: ctrlArcs !== null,
    at(s, x, z) {
      if (!ctrlArcs || !controlY) return heightAt(x, z)
      if (s <= ctrlArcs[0]) return controlY[0]
      for (let i = 0; i < ctrlArcs.length - 1; i++) {
        if (s <= ctrlArcs[i + 1]) {
          const span = ctrlArcs[i + 1] - ctrlArcs[i]
          const t = span <= 0 ? 1 : (s - ctrlArcs[i]) / span
          return controlY[i] + (controlY[i + 1] - controlY[i]) * t
        }
      }
      return controlY[controlY.length - 1]
    },
  }
}
