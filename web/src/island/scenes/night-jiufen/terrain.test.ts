// 九份連續地形的貼合驗證(設計見 docs/refactor-island-terrain-2026-10.md 第 9.3 節):
// 站點、石階、輕便路與地面的關係,以及平台、散落物的基本合理性。
import { describe, expect, it } from 'vitest'
import type { Pt } from '../../data/layoutTypes'
import { baseFieldAt, padWeight } from '../../logic/heightfield'
import { pointInPolygon } from '../../logic/geometry'
import { ISLAND_LAYOUT, PATH_POINT_Y, groundY } from './layout'

const L = ISLAND_LAYOUT
const terrain = L.terrain!
const stop = (id: string) => L.stops.find((s) => s.stopId === id)!

// 步道折線在弧長位置的腳底高度(線性內插 PATH_POINT_Y)
function pathSamples(step: number): Array<{ x: number; z: number; y: number; i: number }> {
  const out: Array<{ x: number; z: number; y: number; i: number }> = []
  const pts = L.path.points
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    const n = Math.max(1, Math.ceil(len / step))
    for (let k = 0; k < n; k++) {
      const t = k / n
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, y: PATH_POINT_Y[i] + (PATH_POINT_Y[i + 1] - PATH_POINT_Y[i]) * t, i })
    }
  }
  return out
}

describe('九份連續地形:站點', () => {
  it('站①(基山街)與站④(茶樓)放在平台上:y 等於該處地面高度', () => {
    for (const id of ['stop_1', 'stop_6']) {
      const s = stop(id)
      expect(s.y, id).toBeCloseTo(groundY(s.x, s.z), 1)
    }
  })
  it('站②③是石階與緩坡模型:y 是最低一階的底面高度,地面不低於它', () => {
    const s2 = stop('stop_4'), s3 = stop('stop_5')
    expect(s2.y).toBeCloseTo(3.4)
    expect(s3.y).toBeCloseTo(3.4)
    expect(groundY(s2.x, s2.z)).toBeGreaterThanOrEqual(s2.y! - 0.05)
    expect(groundY(s3.x, s3.z)).toBeGreaterThanOrEqual(s3.y! - 0.05)
  })
  it('路線先下再上(接近真實九份):① 基山街最高,② 豎崎路下到最低,④ 茶樓在中間高度(不是最高點)', () => {
    const [y1, y2, y3, y4] = L.stops.map((s) => s.y!)
    expect(y1).toBeGreaterThan(y2)
    expect(y1).toBeGreaterThan(y4)
    expect(y4).toBeGreaterThan(y3)
    expect(y4).toBeGreaterThan(y2)
  })
})

describe('九份連續地形:步道與地面', () => {
  it('豎崎路、輕便路、小石階沿中線每 0.5 格取樣:底面 - 0.05 ≤ 地面 ≤ 踏面 + 0.05(不穿出踏面、也不在實心階梯下露空)', () => {
    // 步道點索引(見 layout.ts 的 PATH3)與各段模型的底面高度:11~14 豎崎路(底面 3.4)、18~19 輕便路(3.4)、21~22 小石階(4.9)
    const base = new Map<number, number>([[11, 3.4], [12, 3.4], [13, 3.4], [14, 3.4], [18, 3.4], [19, 3.4], [21, 4.9], [22, 4.9]])
    const bad = pathSamples(0.5)
      .filter((p) => base.has(p.i))
      .flatMap((p) => {
        const g = groundY(p.x, p.z)
        return g > p.y + 0.05 || g < base.get(p.i)! - 0.05 ? [`(${p.x.toFixed(1)}, ${p.z.toFixed(1)}) 地面 ${g.toFixed(2)} 不在 ${base.get(p.i)} ~ ${p.y.toFixed(2)}`] : []
      })
    expect(bad).toEqual([])
  })
  it('豎崎路段步道高度遞減(旅人從基山街走下來);輕便路與小石階段遞增', () => {
    for (let i = 10; i < 15; i++) expect(PATH_POINT_Y[i + 1], `idx ${i}`).toBeLessThanOrEqual(PATH_POINT_Y[i])
    for (let i = 17; i < 23; i++) expect(PATH_POINT_Y[i + 1], `idx ${i}`).toBeGreaterThanOrEqual(PATH_POINT_Y[i])
  })
  it('整條步道都在島內', () => {
    for (const [x, z] of L.path.points) expect(pointInPolygon(x, z, L.outline), `${x},${z}`).toBe(true)
  })
})

describe('九份連續地形:平台', () => {
  const pads = terrain.pads!
  const area = (outline: Pt[]) => {
    const xs = outline.map((p) => p[0]), zs = outline.map((p) => p[1])
    const pts: Pt[] = []
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.5) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.5) if (pointInPolygon(x, z, outline)) pts.push([x, z])
    return pts
  }
  it('22 塊平台(15 條屋排 + 7 塊道路站點廣場),輪廓全部在島內', () => {
    expect(pads).toHaveLength(22)
    for (const [i, p] of pads.entries()) for (const [x, z] of p.outline) expect(pointInPolygon(x, z, L.outline), `pad[${i}] ${x},${z}`).toBe(true)
  })
  it('每塊平台的切填量不超過 3 格(平台不會變成懸崖或深坑)', () => {
    for (const [i, p] of pads.entries()) {
      const ys = area(p.outline).map(([x, z]) => baseFieldAt({ ...terrain, pads: [] }, x, z))
      expect(Math.max(...ys) - p.y, `pad[${i}] 切`).toBeLessThanOrEqual(3)
      expect(p.y - Math.min(...ys), `pad[${i}] 填`).toBeLessThanOrEqual(3)
    }
  })
  it('平台內部高度精確等於 y', () => {
    for (const p of pads) {
      const [x, z] = p.outline.reduce((a, q) => [a[0] + q[0] / p.outline.length, a[1] + q[1] / p.outline.length], [0, 0])
      // 質心若在多邊形外(凹形)或落在後面平台的範圍/漸變帶內,會被後面的平台改掉,不檢查
      const later = pads.slice(pads.indexOf(p) + 1)
      if (pointInPolygon(x, z, p.outline) && later.every((o) => padWeight(o, x, z) === 0)) expect(groundY(x, z)).toBeCloseTo(p.y, 6)
    }
  })
})

describe('九份連續地形:散落物', () => {
  const count = (re: RegExp) => L.scatter.filter((p) => re.test(p.model)).length
  it('數量級:房子 ≥ 30、燈籠(含燈帶)≥ 60、松樹 ≥ 15(設計文件的 70~90 棟是估的,屋排只有 3 格深,實際排得下的少一些)', () => {
    expect(count(/^deco-house-old/)).toBeGreaterThanOrEqual(30)
    expect(count(/^deco-lantern-red$/)).toBeGreaterThanOrEqual(60)
    expect(count(/^deco-tree-pine$/)).toBeGreaterThanOrEqual(15)
  })
  it('全部在島內;房子的腳底就是地面(都放在平台上)', () => {
    for (const p of L.scatter) expect(pointInPolygon(p.x, p.z, L.outline), `${p.model} ${p.x},${p.z}`).toBe(true)
    for (const p of L.scatter.filter((q) => /^deco-house-old/.test(q.model))) expect(p.y, `house ${p.x},${p.z}`).toBeCloseTo(groundY(p.x, p.z), 1)
  })
  it('小石階用 keepY 保留明確的腳底高度', () => {
    const s = L.scatter.find((p) => p.model === 'stop-shuqi-stairs')!
    expect(s.keepY).toBe(true)
    expect(s.y).toBeCloseTo(4.9)
  })
})

describe('九份連續地形:昇平戲院廣場', () => {
  const theater = L.scatter.find((p) => p.model === 'landmark-sheng-ping-theater')!
  it('戲院放在廣場平台上,keepY 保留明確的腳底高度,y 與該處地面相同', () => {
    expect(theater).toBeDefined()
    expect(theater.keepY).toBe(true)
    expect(theater.y).toBeCloseTo(3.4)
    for (const [dx, dz] of [[-3.5, -2.8], [3.5, -2.8], [0, 2.9]]) expect(groundY(theater.x + dx, theater.z + dz), `${dx},${dz}`).toBeCloseTo(3.4, 1)
  })
  it('廣場擺設都放在平台上(高度 3.4),戲院不壓到步道', () => {
    const near = L.scatter.filter((p) => p !== theater && p.x >= 11 && p.x <= 22 && p.z >= 14 && p.z <= 18)
    expect(near.length).toBeGreaterThanOrEqual(8)
    for (const p of near) expect(groundY(p.x, p.z), `${p.model} ${p.x},${p.z}`).toBeCloseTo(3.4, 1)
    expect(Math.min(...pathSamples(0.5).map((q) => Math.hypot(q.x - theater.x, q.z - theater.z)))).toBeGreaterThan(5)
  })
})
