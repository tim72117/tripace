// 用真實的九份資料驗證人物能走:沿著整條步道從起點走到終點(不被房子、牆、高度差擋住),且擋得住該擋的。
import { describe, expect, it } from 'vitest'
import { loadScene } from '../scenes/registry'
import { buildColliderPolys } from '../three/colliders'
import { buildPathCurve } from './pathCurve'
import { buildPathProfile } from './pathProfile'
import { resolveScatter } from './scatterResolve'
import { heightAt } from './terrain'
import { createColliderIndex, tryStep, type WalkState } from './walk'
import { makeWalkWorld } from './walkWorld'

async function realWorld() {
  const scene = await loadScene('night-jiufen')
  const layout = scene.layout
  const curve = buildPathCurve(layout.path.points)
  const ground = (x: number, z: number) => heightAt(layout, x, z)
  const profile = buildPathProfile(layout.path.points, curve, ground, scene.pathPointY)
  const kept = resolveScatter(layout.scatter, layout, {
    pathLine: curve.samples.map((s): [number, number] => [s.x, s.z]),
    pathWidth: layout.path.width, stopClear: 4, edgeClear: 1, radiusOf: (p) => Math.min(1.2, 0.3 * (p.scale ?? 1)),
  }).kept
  const placements = [
    ...kept.map((p) => ({ model: p.model, x: p.x, y: p.y, z: p.z, rotY: p.rotY, scale: p.scale })),
    ...layout.stops.map((s) => ({ model: s.model, x: s.x, y: s.y ?? ground(s.x, s.z), z: s.z, rotY: s.rotY, scale: s.scale })),
  ]
  const polys = buildColliderPolys(placements, scene.models)
  const idx = createColliderIndex(polys)
  const world = makeWalkWorld({ layout, curve, groundY: ground, pathY: profile.at, blocked: idx.hits })
  return { layout, world, idx, polys, ground }
}

describe('九份:人物走動的世界', () => {
  it('有一定數量的固體(房子、牆、樹幹),且沒有把整座島擋死', async () => {
    const { polys } = await realWorld()
    expect(polys.length).toBeGreaterThan(100)
  })

  it('沿著整條步道從起點走到終點:每個轉折點都走得到(不被房子、牆或高度差擋住)', async () => {
    const { layout, world } = await realWorld()
    const o = { radius: 0.28, maxStep: 0.7 }
    const pts = layout.path.points
    let cur: WalkState = { x: pts[0][0], z: pts[0][1], y: world.surfaceY(pts[0][0], pts[0][1]) }
    for (let i = 1; i < pts.length; i++) {
      const [tx, tz] = pts[i]
      let guard = 0
      while (Math.hypot(tx - cur.x, tz - cur.z) > 0.3 && guard++ < 400) {
        const d = Math.hypot(tx - cur.x, tz - cur.z)
        const k = Math.min(1, 0.2 / d)
        const r = tryStep(world, o, cur, (tx - cur.x) * k, (tz - cur.z) * k)
        if (!r.moved) throw new Error(`在 path[${i - 1}]→path[${i}] 被擋住:(${cur.x.toFixed(2)}, ${cur.z.toFixed(2)}, y ${cur.y.toFixed(2)}) 目標 (${tx}, ${tz})`)
        cur = { x: r.x, z: r.z, y: r.y }
      }
      expect(guard, `走到 path[${i}] 太久`).toBeLessThan(400)
    }
  })

  it('該擋的擋得住:茶樓、戲院的本體、島外', async () => {
    const { layout, world } = await realWorld()
    const tea = layout.stops.find((s) => s.stopId === 'stop_6')!
    const theater = layout.scatter.find((p) => p.model === 'landmark-sheng-ping-theater')!
    expect(world.blocked(tea.x, tea.z, 0.35)).toBe(true)
    expect(world.blocked(theater.x, theater.z - 0.5, 0.35)).toBe(true)
    expect(world.inside(60, 0)).toBe(false)
    expect(world.inside(layout.path.points[0][0], layout.path.points[0][1])).toBe(true)
  })

  it('石階旁邊的地面比踏面低很多:從石階中線往側邊走會被高度差擋住(只能走在石階上)', async () => {
    const { world } = await realWorld()
    const o = { radius: 0.28, maxStep: 0.7 }
    const from = { x: 6, z: 8, y: world.surfaceY(6, 8) } // 豎崎路中段(踏面約 6.4)
    let cur: WalkState = from
    for (let i = 0; i < 40; i++) { const r = tryStep(world, o, cur, 0.1, 0); if (!r.moved) break; cur = { x: r.x, z: r.z, y: r.y } }
    expect(cur.x).toBeLessThan(from.x + 2.2) // 走不出石階的寬度
  })
})
