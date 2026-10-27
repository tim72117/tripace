// 斜坡:heightAt 對 layout.slopes 的行為與版面驗證。
import { describe, expect, it } from 'vitest'
import type { IslandLayout, Pt } from '../data/layoutTypes'
import { MAX_SINK, resolveScatter } from './scatterResolve'
import { heightAt, slopeHeightAt } from './terrain'
import { validateLayout } from './validateLayout'

// 往 +z 方向上坡:z=0 為低端(y0=2)、z=10 為高端(y1=6)
const slope = { outline: [[0, 0], [10, 0], [10, 10], [0, 10]] as Pt[], from: [5, 0] as Pt, to: [5, 10] as Pt, y0: 2, y1: 6 }

describe('slopeHeightAt', () => {
  it('沿方向線線性內插', () => {
    expect(slopeHeightAt(slope, 5, 0)).toBeCloseTo(2)
    expect(slopeHeightAt(slope, 5, 5)).toBeCloseTo(4)
    expect(slopeHeightAt(slope, 5, 10)).toBeCloseTo(6)
  })
  it('只看沿方向線的分量,橫向位置不影響高度', () => {
    expect(slopeHeightAt(slope, 1, 5)).toBeCloseTo(4)
    expect(slopeHeightAt(slope, 9, 5)).toBeCloseTo(4)
  })
  it('超出兩端夾在 y0 / y1', () => {
    expect(slopeHeightAt(slope, 5, -5)).toBeCloseTo(2)
    expect(slopeHeightAt(slope, 5, 20)).toBeCloseTo(6)
  })
  it('from 與 to 重合時不除以零,取 y0', () => {
    expect(slopeHeightAt({ ...slope, from: [5, 5], to: [5, 5] }, 5, 9)).toBeCloseTo(2)
  })
})

describe('heightAt 含斜坡', () => {
  const layout = { topY: 0, slopes: [slope] }
  it('在斜坡輪廓內回斜坡高度;輪廓外回 topY', () => {
    expect(heightAt(layout, 5, 5)).toBeCloseTo(4)
    expect(heightAt(layout, 20, 5)).toBe(0)
  })
  it('與階地重疊時取較高者', () => {
    const terrace = { outline: [[0, 0], [10, 0], [10, 10], [0, 10]] as Pt[], y: 5 }
    expect(heightAt({ ...layout, terraces: [terrace] }, 5, 2)).toBe(5) // 斜坡 2.8 < 階地 5
    expect(heightAt({ ...layout, terraces: [terrace] }, 5, 9)).toBeCloseTo(5.6) // 斜坡 5.6 > 階地 5
  })
  it('沒有 slopes 時行為不變', () => {
    expect(heightAt({ topY: 1.5 }, 3, 3)).toBe(1.5)
  })
})

describe('validateLayout 斜坡', () => {
  const base: IslandLayout = {
    outline: [[-20, -20], [20, -20], [20, 20], [-20, 20]],
    topY: 0,
    sea: undefined,
    thickness: 5,
    river: { points: [], width: 1 },
    path: { points: [[-10, 0], [10, 0]], width: 2 },
    stops: [],
    scatter: [],
    lighting: [],
    palette: { grass: '#000', grassAlt: '#000', dirt: '#000', water: '#000', waterDeep: '#000', path: '#000' },
  }
  const run = (slopes: IslandLayout['slopes']) => validateLayout({ ...base, slopes }, new Set(), [])
  const paths = (slopes: IslandLayout['slopes']) => run(slopes).map((i) => i.path)

  it('合法斜坡沒有問題', () => {
    expect(paths([slope])).not.toContain('slopes[0].outline')
    expect(paths([slope]).filter((p) => p.startsWith('slopes'))).toEqual([])
  })
  it('輪廓少於 3 個點、輪廓自交都是錯誤', () => {
    expect(run([{ ...slope, outline: [[0, 0], [1, 1]] }]).some((i) => i.level === 'error' && i.path === 'slopes[0].outline')).toBe(true)
    expect(run([{ ...slope, outline: [[0, 0], [10, 10], [10, 0], [0, 10]] }]).some((i) => i.level === 'error' && i.path === 'slopes[0].outline')).toBe(true)
  })
  it('from 與 to 重合是錯誤', () => {
    expect(run([{ ...slope, from: [1, 1], to: [1, 1] }]).some((i) => i.level === 'error' && i.path === 'slopes[0].from')).toBe(true)
  })
  it('高度不得低於 topY', () => {
    expect(run([{ ...slope, y0: -1 }]).some((i) => i.level === 'error' && i.path === 'slopes[0].y0')).toBe(true)
  })
  it('頂點超出島輪廓是警告', () => {
    const out = run([{ ...slope, outline: [[0, 0], [30, 0], [30, 10], [0, 10]] }])
    expect(out.some((i) => i.level === 'warn' && i.path === 'slopes[0].outline')).toBe(true)
  })
})

describe('validateLayout 峭壁(crag)與 tilt', () => {
  const base: IslandLayout = {
    outline: [[-20, -20], [20, -20], [20, 20], [-20, 20]],
    topY: 0,
    sea: undefined,
    thickness: 5,
    river: { points: [], width: 1 },
    path: { points: [[-10, 0], [10, 0]], width: 2 },
    stops: [],
    scatter: [],
    lighting: [],
    palette: { grass: '#000', grassAlt: '#000', dirt: '#000', water: '#000', waterDeep: '#000', path: '#000' },
  }
  const crag = { seed: 1, amp: 0.5, detail: 3 }
  const run = (slopes: IslandLayout['slopes'], scatter: IslandLayout['scatter'] = []) => validateLayout({ ...base, slopes, scatter }, new Set(['rock']), [])
  const has = (issues: ReturnType<typeof run>, level: string, path: string) => issues.some((i) => i.level === level && i.path === path)

  it('合法的 crag 沒有問題', () => {
    expect(run([{ ...slope, crag }]).filter((i) => i.path.startsWith('slopes'))).toEqual([])
  })
  it('detail 必須是 0~5 的整數(太大會產生數百萬格點),amp 不得為負或非有限', () => {
    expect(has(run([{ ...slope, crag: { ...crag, detail: 6 } }]), 'error', 'slopes[0].crag.detail')).toBe(true)
    expect(has(run([{ ...slope, crag: { ...crag, detail: 2.5 } }]), 'error', 'slopes[0].crag.detail')).toBe(true)
    expect(has(run([{ ...slope, crag: { ...crag, detail: -1 } }]), 'error', 'slopes[0].crag.detail')).toBe(true)
    expect(has(run([{ ...slope, crag: { ...crag, amp: -0.1 } }]), 'error', 'slopes[0].crag.amp')).toBe(true)
    expect(has(run([{ ...slope, crag: { ...crag, amp: NaN } }]), 'error', 'slopes[0].crag.amp')).toBe(true)
  })
  it('凹形輪廓加峭壁是警告(Delaunay 不保證密閉);沒有 crag 的凹形不警告', () => {
    const concave: Pt[] = [[0, 0], [10, 0], [10, 10], [5, 4], [0, 10]]
    expect(has(run([{ ...slope, outline: concave, crag }]), 'warn', 'slopes[0].outline')).toBe(true)
    expect(has(run([{ ...slope, outline: concave }]), 'warn', 'slopes[0].outline')).toBe(false)
  })
  it('scatter 的 tilt 必須是有限數字', () => {
    expect(has(run([], [{ model: 'rock', x: 0, z: 5, tilt: [NaN, 0] }]), 'error', 'scatter[0].tilt')).toBe(true)
    expect(has(run([], [{ model: 'rock', x: 0, z: 5, tilt: [Math.PI / 3, 0] }]), 'error', 'scatter[0].tilt')).toBe(false)
  })
})

describe('resolveScatter 貼著斜坡的物件(tilt)', () => {
  const layout = { outline: [[-20, -20], [20, -20], [20, 20], [-20, 20]] as Pt[], topY: 0, slopes: [slope], stops: [], river: { points: [], width: 0 } }
  const opts = { pathLine: [] as Pt[], pathWidth: 0, stopClear: 0, edgeClear: 1, radiusOf: () => 0.5 }
  it('沒有 tilt 的物件放在陡坡上會因高度不一致被剔除', () => {
    const r = resolveScatter([{ model: 'rock', x: 5, z: 5 }], layout, opts)
    expect(r.dropped.map((d) => d.reason)).toEqual(['騎在階地邊緣'])
  })
  it('tilt 物件可以埋進坡面(最多 MAX_SINK),超過就以坡面高度為準', () => {
    const r = resolveScatter([{ model: 'rock', x: 5, z: 5, tilt: [Math.PI / 3, 0], y: 3.7 }, { model: 'rock', x: 5, z: 5, tilt: [Math.PI / 3, 0], y: 4 - MAX_SINK - 1 }], layout, opts)
    expect(r.kept.map((k) => k.y)).toEqual([3.7, 4])
  })
  it('有 tilt 的物件保留在斜坡上,y 取該點的坡面高度', () => {
    const r = resolveScatter([{ model: 'rock', x: 5, z: 5, tilt: [Math.PI / 3, 0] }], layout, opts)
    expect(r.kept).toHaveLength(1)
    expect(r.kept[0].y).toBeCloseTo(4)
  })
})
