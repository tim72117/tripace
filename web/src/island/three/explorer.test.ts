import { describe, expect, it } from 'vitest'
import { buildPathCurve } from '../logic/pathCurve'
import { buildPathProfile } from '../logic/pathProfile'
import { resolveScatter } from '../logic/scatterResolve'
import { heightAt } from '../logic/terrain'
import { loadScene } from '../scenes/registry'
import { Explorer, turnToward } from './explorer'

async function makeExplorer() {
  const scene = await loadScene('night-jiufen')
  const layout = scene.layout
  const curve = buildPathCurve(layout.path.points)
  const ground = (x: number, z: number) => heightAt(layout, x, z)
  const kept = resolveScatter(layout.scatter, layout, {
    pathLine: curve.samples.map((s): [number, number] => [s.x, s.z]),
    pathWidth: layout.path.width, stopClear: 4, edgeClear: 1, radiusOf: (p) => Math.min(1.2, 0.3 * (p.scale ?? 1)),
  }).kept
  const ex = new Explorer({
    layout, models: scene.models, curve, groundY: ground, pathY: buildPathProfile(layout.path.points, curve, ground, scene.pathPointY).at,
    placements: [
      ...kept.map((p) => ({ model: p.model, x: p.x, y: p.y, z: p.z, rotY: p.rotY, scale: p.scale })),
      ...layout.stops.map((s) => ({ model: s.model, x: s.x, y: s.y ?? ground(s.x, s.z), z: s.z, rotY: s.rotY, scale: s.scale })),
    ],
  })
  return { ex, layout, curve }
}

describe('Explorer(探索模式的人物)', () => {
  it('enter 把人物放在步道起點,高度是有限數字', async () => {
    const { ex, layout } = await makeExplorer()
    ex.enter()
    const p = ex.position
    expect(p.x).toBeCloseTo(layout.path.points[0][0], 0)
    expect(p.z).toBeCloseTo(layout.path.points[0][1], 0)
    expect(Number.isFinite(p.y)).toBe(true)
    expect(ex.group.children).toHaveLength(2) // 家長 + 小孩
  })

  it('給移動方向就會前進;停手就停;小孩跟在家長後面(距離不會拉得太遠)', async () => {
    const { ex, curve } = await makeExplorer()
    ex.enter()
    const start = ex.position.clone()
    const p0 = curve.at(0)
    for (let i = 0; i < 90; i++) ex.update(1 / 60, { x: p0.dirX, z: p0.dirZ }, i / 60)
    const moved = ex.position.distanceTo(start)
    expect(moved).toBeGreaterThan(3) // 4 格/秒 × 1.5 秒,沿步道方向(可能略被擋,但不會原地不動)
    expect(ex.isMoving).toBe(true)
    for (let i = 0; i < 30; i++) ex.update(1 / 60, { x: 0, z: 0 }, 2 + i / 60)
    expect(ex.isMoving).toBe(false)
    const child = ex.group.children[1].position
    expect(Math.hypot(child.x - ex.position.x, child.z - ex.position.z)).toBeLessThan(3)
  })

  it('點地面的目標:走到就停;目標在島外(被擋)會放棄,不會一直撞', async () => {
    const { ex, curve } = await makeExplorer()
    ex.enter()
    const near = curve.at(6) // 沿步道前方 6 格
    ex.setTarget(near.x, near.z)
    for (let i = 0; i < 200 && ex.isMoving !== false; i++) ex.update(1 / 60, { x: 0, z: 0 }, i / 60)
    for (let i = 0; i < 120; i++) ex.update(1 / 60, { x: 0, z: 0 }, i / 60)
    expect(Math.hypot(ex.position.x - near.x, ex.position.z - near.z)).toBeLessThan(0.6)
    ex.setTarget(200, 200)
    for (let i = 0; i < 600; i++) ex.update(1 / 60, { x: 0, z: 0 }, i / 60)
    expect(ex.isMoving).toBe(false)
    expect(Math.abs(ex.position.x)).toBeLessThan(60) // 沒有跑出島
  })

  it('一直往一個方向走不會穿出島(邊界與固體擋住)', async () => {
    const { ex } = await makeExplorer()
    ex.enter()
    for (let i = 0; i < 60 * 40; i++) ex.update(1 / 60, { x: 1, z: 0.4 }, i / 60)
    const p = ex.position
    expect(Math.abs(p.x)).toBeLessThan(50)
    expect(p.z).toBeLessThan(40)
  })
})

describe('turnToward', () => {
  it('走最短弧、每次依比例轉向', () => {
    expect(turnToward(0, 1, 1)).toBeCloseTo(1)
    expect(turnToward(0, 1, 0.5)).toBeCloseTo(0.5)
    expect(turnToward(3, -3, 1)).toBeCloseTo(-3 + 2 * Math.PI) // 3 → -3 走 0.28 的短弧,不是繞 6 的長弧
  })
})
