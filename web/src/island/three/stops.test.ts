// stops.ts 的站點索引測試(three 的物件與 CSS2D 在 jsdom 就能跑,不需要 WebGL)。
//
// 重點:views[i].index 是「站點在清單中的索引」,glowPerStop 以這個索引為鍵。若某一站沒有建築被跳過,
// 後面站點的亮度仍必須對到自己的索引,不能因為 views 少一個而往前錯位。
import { describe, expect, it, vi } from 'vitest'
import type { IslandStop } from '../logic/articleToIsland'
import type { Model3D } from './model'
import { buildStops } from './stops'

const LAMP: Model3D = { parts: [{ shape: { type: 'box', size: [1, 1, 1] }, color: '#ffffff', emissive: '#ff0000' }] }
const stop = (i: number, withAnchor: boolean): IslandStop => ({
  stopId: `s${i}`, order: i, index: String(i), name: `站${i}`, excerpt: '', time: '17:30', timeSource: 'layout',
  anchor: withAnchor ? { stopId: `s${i}`, model: 'lamp', x: i * 10, z: 0, label: `站${i}`, time: '17:30' } : null,
})
const flat = () => 0

describe('buildStops 的站點索引', () => {
  it('全部都有版面:views[i].index === i', () => {
    const s = buildStops([stop(0, true), stop(1, true), stop(2, true)], { lamp: LAMP }, flat, () => {})
    expect(s.views.map((v) => v.index)).toEqual([0, 1, 2])
  })

  it('中間一站被跳過:後面的站仍保有自己的索引,亮度以索引為鍵(不會錯位到前一站)', () => {
    const s = buildStops([stop(0, true), stop(1, false), stop(2, true)], { lamp: LAMP }, flat, () => {})
    expect(s.views.map((v) => v.index)).toEqual([0, 2]) // 跳過了索引 1
    const glow: number[] = []
    glow[0] = 0.1
    glow[2] = 0.9
    s.update(0, glow, -1, -1)
    const intensity = (k: number) => s.views[k].glowMats[0].m.emissiveIntensity
    const base = s.views[0].glowMats[0].base
    expect(intensity(0)).toBeCloseTo(base * (0.2 + 2.2 * 0.1))
    expect(intensity(1)).toBeCloseTo(base * (0.2 + 2.2 * 0.9)) // 索引 2 的站,用的是 glow[2]
  })

  it('標籤的 is-active / is-selected 以站點索引判斷', () => {
    const s = buildStops([stop(0, true), stop(1, false), stop(2, true)], { lamp: LAMP }, flat, () => {})
    s.update(0, [0, 0, 0], 2, 2)
    expect(s.views[0].labelEl.classList.contains('is-active')).toBe(false)
    expect(s.views[1].labelEl.classList.contains('is-active')).toBe(true) // 第二個 view 就是索引 2
    expect(s.views[1].labelEl.classList.contains('is-selected')).toBe(true)
  })

  it('點標籤觸發 onLabelClick(站點索引,不是 views 的順序);標籤只有序號與站名,沒有時間;建築模型本身不可點選', () => {
    const clicked = vi.fn()
    const s = buildStops([stop(0, true), stop(1, false), stop(2, true)], { lamp: LAMP }, flat, clicked)
    s.views[1].labelEl.click()
    expect(clicked).toHaveBeenCalledWith(2)
    expect(s.views[1].labelEl.querySelector('em')).toBeNull()
    expect(s.views[1].labelEl.textContent).not.toMatch(/\d{1,2}:\d{2}/)
    expect('pick' in s).toBe(false)
  })
})
