import { describe, expect, it } from 'vitest'
// 烘焙檢查:全部模型都能烘焙(three 的幾何建立在 node/jsdom 可跑,不需要 WebGL)。
import { bakeModel } from './bake'
import type { Model3D } from './model'

const mods = import.meta.glob<Model3D>('../models/*.ts', { eager: true, import: 'default' })
const entries = Object.entries(mods).map(([p, m]) => [p.replace(/^.*\/(.+)\.ts$/, '$1'), m] as const)

describe('全部模型都能烘焙(三種索引/非索引形狀混合不會讓 mergeGeometries 回 null)', () => {
  it('模型數量符合預期', () => expect(entries.length).toBeGreaterThanOrEqual(20))
  for (const [name, model] of entries) {
    it(name, () => {
      const b = bakeModel(model)
      expect(b.solids.length + (b.lamps ? 1 : 0)).toBeGreaterThan(0)
      for (const s of b.solids) expect(s.geo.attributes.position.count).toBeGreaterThan(0)
      expect(b.height).toBeGreaterThan(0)
    })
  }
  it('燈籠與窗戶等發光部件會被收進 lamps,且頂點色存在', () => {
    const lantern = entries.find(([n]) => n === 'deco-lantern-red')![1]
    const b = bakeModel(lantern)
    expect(b.lamps).not.toBeNull()
    expect(b.lamps!.geo.attributes.color.count).toBe(b.lamps!.geo.attributes.position.count)
    expect(b.lamps!.centers.length).toBeGreaterThan(0)
  })
  it('岩石這類沒有發光部件的模型 lamps 為 null', () => {
    expect(bakeModel(entries.find(([n]) => n === 'deco-rock')![1]).lamps).toBeNull()
  })
})
