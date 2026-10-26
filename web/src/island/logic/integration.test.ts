// 真實資料的整合驗證:Fable 的版面 + 部落客文章 + 全部模型檔(不 import three,純資料與純邏輯)。
import { describe, expect, it } from 'vitest'
import article from '../data/night-jiufen.json'
import { ISLAND_LAYOUT, PATH_POINT_Y, groundY } from '../data/layout'
import { articleToIsland, type ArticleSource } from './articleToIsland'
import { buildPathCurve } from './pathCurve'
import { lanternOrder } from './lanternSchedule'
import { parseTime, sampleLight } from './lighting'
import { resolveScatter } from './scatterResolve'
import { heightAt } from './terrain'
import { loadIslandData } from '../islandData'
import { validateLayout } from './validateLayout'

const modelFiles = import.meta.glob('../models/*.ts')
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
  it('PATH_POINT_Y 與步道點一一對應,且每個值都落在「最低地面 ~ 最高階地」之間', () => {
    // 石階路段的步道點在階地之間的斜坡上,高度是中間值,不會等於任何一層階地的 y,
    // 所以不能要求它與 heightAt 相等,只檢查範圍合理。
    expect(PATH_POINT_Y).toHaveLength(ISLAND_LAYOUT.path.points.length)
    const top = Math.max(...(ISLAND_LAYOUT.terraces ?? []).map((t) => t.y))
    for (const y of PATH_POINT_Y) {
      expect(y).toBeGreaterThanOrEqual(ISLAND_LAYOUT.topY - 1e-6)
      expect(y).toBeLessThanOrEqual(top + 1e-6)
    }
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
  it('loadIslandData 的 stops 是過濾後的唯一清單:真實資料四站全部可顯示,順序與文章一致', () => {
    const d = loadIslandData()
    expect(d.stops).toHaveLength(d.island.stops.length)
    expect(d.stops.map((s) => s.stopId)).toEqual(d.island.stops.map((s) => s.stopId))
    expect(d.stops.every((s) => s.anchor !== null && d.models[s.anchor.model] !== undefined)).toBe(true)
  })
})
