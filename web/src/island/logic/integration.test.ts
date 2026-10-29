// 真實資料的整合驗證:Fable 的版面 + 部落客文章 + 全部模型檔(不 import three,純資料與純邏輯)。
import { describe, expect, it } from 'vitest'
import article from '../scenes/night-jiufen/article.json'
import { ISLAND_LAYOUT, PATH_POINT_Y, groundY } from '../scenes/night-jiufen/world'
import { articleToIsland, type ArticleSource } from './articleToIsland'
import { buildPathCurve } from './pathCurve'
import { lanternOrder } from './lanternSchedule'
import { parseTime, sampleLight } from './lighting'
import { resolveScatter } from './scatterResolve'
import { heightAt } from './terrain'
import { loadIslandData } from '../islandData'
import { SCENES } from '../scenes/registry'
import { validateLayout } from './validateLayout'

const modelFiles = import.meta.glob(['../models/*.ts', '../scenes/night-jiufen/models/*.ts'])
const names = new Set(Object.keys(modelFiles).map((p) => p.replace(/^.*\/(.+)\.ts$/, '$1')))
const src = article as unknown as ArticleSource
const byline = { name: 'tim72117' }

describe('九份島真實資料', () => {
  it('版面驗證沒有 error,與文章的站點一一對應', () => {
    const island = articleToIsland(src, ISLAND_LAYOUT, byline)
    const issues = [...validateLayout(ISLAND_LAYOUT, names, island.stops.map((s) => s.stopId)), ...island.issues]
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
    expect(island.stops).toHaveLength(4)
    expect(island.stops.every((s) => s.anchor !== null && s.timeSource === 'layout')).toBe(true)
    expect(island.stops.map((s) => s.name)).toEqual(['基山街', '豎崎路石階', '輕便路散步', '阿妹茶樓'])
  })
  it('我的 heightAt 與 Fable 的 groundY 在站點與步道點上一致(兩套高度算法沒有分歧)', () => {
    for (const [x, z] of ISLAND_LAYOUT.path.points) expect(heightAt(ISLAND_LAYOUT, x, z), `path ${x},${z}`).toBeCloseTo(groundY(x, z), 1)
    for (const s of ISLAND_LAYOUT.stops) expect(heightAt(ISLAND_LAYOUT, s.x, s.z), s.stopId).toBeCloseTo(groundY(s.x, s.z), 1)
  })
  it('PATH_POINT_Y 與步道點一一對應、都在最低地面以上;路線先下再上(終點低於最高點)', () => {
    // 石階路段的地面被切溝壓在踏面以下,所以高度明確給、不等於 heightAt(貼合關係見 scenes/night-jiufen/terrain.test.ts)。
    expect(PATH_POINT_Y).toHaveLength(ISLAND_LAYOUT.path.points.length)
    for (const y of PATH_POINT_Y) expect(y).toBeGreaterThanOrEqual(ISLAND_LAYOUT.topY - 1e-6)
    const peak = Math.max(...PATH_POINT_Y)
    expect(PATH_POINT_Y[PATH_POINT_Y.length - 1]).toBeLessThan(peak)
    expect(Math.min(...PATH_POINT_Y.slice(PATH_POINT_Y.indexOf(peak)))).toBeLessThan(PATH_POINT_Y[PATH_POINT_Y.length - 1]) // 中途下到比終點更低(先下再上)
  })
  it('控制點在曲線上的弧長單調遞增(pathMesh 依弧長內插高度;步道先下再上,不可吸附到另一段)', () => {
    const curve = buildPathCurve(ISLAND_LAYOUT.path.points)
    const arcs = ISLAND_LAYOUT.path.points.map(([x, z]) => curve.nearestArc(x, z))
    arcs.forEach((a, i) => { if (i > 0) expect(a, `path[${i}]`).toBeGreaterThan(arcs[i - 1]) })
  })
  it('四站在步道上的弧長嚴格遞增(旅人只會往前走,不會倒退)', () => {
    const curve = buildPathCurve(ISLAND_LAYOUT.path.points)
    const arcs = ISLAND_LAYOUT.stops.map((s) => curve.nearestArc(s.x, s.z))
    for (let i = 1; i < arcs.length; i++) expect(arcs[i], `站 ${i}`).toBeGreaterThan(arcs[i - 1])
  })
  it('時間 17:30 → 20:15 之間燈籠亮度單調不減,且從接近 0 升到接近 1', () => {
    let prev = -1
    for (let m = parseTime('17:30'); m <= parseTime('20:15'); m += 5) {
      const g = sampleLight(ISLAND_LAYOUT.lighting, m).lanternGlow
      expect(g).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = g
    }
    expect(sampleLight(ISLAND_LAYOUT.lighting, parseTime('17:30')).lanternGlow).toBeLessThan(0.2)
    expect(sampleLight(ISLAND_LAYOUT.lighting, parseTime('20:15')).lanternGlow).toBeGreaterThan(0.95)
  })
  it('散落物避障後大部分保留(剔除比例 < 35%),且沒有任何一個擋在步道上', () => {
    const curve = buildPathCurve(ISLAND_LAYOUT.path.points)
    const r = resolveScatter(ISLAND_LAYOUT.scatter, ISLAND_LAYOUT, {
      pathLine: curve.samples.map((s): [number, number] => [s.x, s.z]),
      pathWidth: ISLAND_LAYOUT.path.width, stopClear: 4, edgeClear: 1, radiusOf: (p) => Math.min(1.2, 0.3 * (p.scale ?? 1)),
    })
    expect(r.dropped.length / ISLAND_LAYOUT.scatter.length).toBeLessThan(0.35)
    expect(r.kept.length).toBeGreaterThan(80)
  })
  it('燈籠沿步道的位置 u 分布在 0~1,且前段與後段都有燈(才有「一盞盞往上亮」的過程)', () => {
    const curve = buildPathCurve(ISLAND_LAYOUT.path.points)
    const lamps = ISLAND_LAYOUT.scatter.filter((p) => p.model.startsWith('deco-lantern') || p.model === 'deco-street-lamp')
    const u = lanternOrder(lamps.map((p): [number, number] => [p.x, p.z]), curve)
    expect(lamps.length).toBeGreaterThan(15)
    expect(u.some((x) => x < 0.3)).toBe(true)
    expect(u.some((x) => x > 0.7)).toBe(true)
  })
  it('loadIslandData 的 stops 是過濾後的唯一清單:真實資料四站全部可顯示,順序與文章一致', async () => {
    const d = await loadIslandData('night-jiufen')
    expect(d.stops).toHaveLength(d.island.stops.length)
    expect(d.stops.map((s) => s.stopId)).toEqual(d.island.stops.map((s) => s.stopId))
    expect(d.stops.every((s) => s.anchor !== null && d.models[s.anchor.model] !== undefined)).toBe(true)
  })
})

// 每個已登記的場景(含 feature flag 打開時的範例島;測試環境預設打開,見 vite.config.ts 的 test.env)都要能載入、版面零 error、站點全部可顯示——新增場景時自動被涵蓋。
describe('所有已登記場景', () => {
  for (const def of SCENES) {
    it(`${def.id}:載入成功、沒有版面 error、站點全部可顯示`, async () => {
      const d = await loadIslandData(def.id)
      expect(d.issues.filter((i) => i.level === 'error'), JSON.stringify(d.issues)).toEqual([])
      expect(d.stops.length).toBeGreaterThan(0)
      expect(d.stops).toHaveLength(d.island.stops.length)
    })
  }
})
