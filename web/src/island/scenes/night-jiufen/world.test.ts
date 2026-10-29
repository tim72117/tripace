// 場景資料的新鮮度:cells/ 裡 source 為 rule 的擺放,必須等於現在的規則重跑一次的結果。
// 改了 rules.ts 或其他圖層(地形、步道)卻沒重烤,這裡會失敗:cd web && npm run island:bake -- night-jiufen
import { describe, expect, it } from 'vitest'
import { buildPathCurve } from '../../logic/pathCurve'
import { EDGE_CLEAR, MAX_SCATTER_RADIUS, resolveScatter, STOP_CLEAR } from '../../logic/scatterResolve'
import { generatePlacements } from './rules'
import { NIGHT_JIUFEN } from './world'

describe('夜遊九份:場景資料', () => {
  it('cells/ 的程序化擺放與規則重跑結果一致(沒有忘記重烤)', () => {
    const baked = NIGHT_JIUFEN.layout.scatter.filter((p) => 'source' in p && p.source === 'rule')
    const fresh = generatePlacements(NIGHT_JIUFEN)
    const key = (p: { model: string; x: number; z: number }) => `${p.model}@${p.x},${p.z}`
    expect(baked.map(key).sort()).toEqual(fresh.map(key).sort())
  })
  it('手擺的地標與石階都在(昇平戲院、小石階、石階磚)', () => {
    const hand = NIGHT_JIUFEN.layout.scatter.filter((p) => 'source' in p && p.source === 'hand').map((p) => p.model).sort()
    expect(hand).toEqual(['deco-shuqi-stairs-small', 'deco-stone-steps-landing', 'deco-stone-steps-landing', 'landmark-sheng-ping-theater'])
  })
  it('避障不會剔除手擺的石階與地標(它們本來就壓在步道上、坡上);半徑用上限值測最嚴格的情況', () => {
    const L = NIGHT_JIUFEN.layout
    const curve = buildPathCurve(L.path.points)
    const { dropped } = resolveScatter(L.scatter, L, {
      pathLine: curve.samples.map((s): [number, number] => [s.x, s.z]),
      pathWidth: L.path.width, stopClear: STOP_CLEAR, edgeClear: EDGE_CLEAR, radiusOf: () => MAX_SCATTER_RADIUS,
    })
    expect(dropped.filter((d) => 'source' in d.p && d.p.source === 'hand').map((d) => `${d.p.model}:${d.reason}`)).toEqual([])
  })
})
