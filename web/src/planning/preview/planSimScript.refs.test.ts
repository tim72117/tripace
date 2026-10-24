// 劇本的主題點/候選卡只存 id(attractions/places/farFromNext),不內嵌子景點的顯示資料;
// 每個 id 都必須能被假資料來源回答,模擬態才畫得出內容。
import { describe, it, expect } from 'vitest'
import { PLAN_SIM_SCRIPT } from './planSimScript'
import { DEMO_SCRIPT } from './demoScript'
import { planAiFakeDataSource } from '../data/fake'

describe.each([
  ['planSimScript', PLAN_SIM_SCRIPT],
  ['demoScript', DEMO_SCRIPT],
])('%s', (_name, script) => {
  it('沒有內嵌的 children;places/farFromNext 是字串 id 陣列,farFromNext 必為 places/attractions 的子集', () => {
    for (const a of script) {
      expect(a, `${a.id ?? a.type} 不該有 children`).not.toHaveProperty('children')
      for (const key of ['attractions', 'places', 'farFromNext'] as const) {
        const v = a[key]
        if (v !== undefined) expect(Array.isArray(v) && v.every((x) => typeof x === 'string')).toBe(true)
      }
      const all = [...(a.attractions ?? []), ...(a.places ?? [])]
      for (const f of a.farFromNext ?? []) expect(all).toContain(f)
    }
  })

  it('所有 places 的 id 都能由假資料來源 placeDetails 查到名稱與座標', async () => {
    const ids = script.flatMap((a) => a.places ?? [])
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      const r = await planAiFakeDataSource.placeDetails(id)
      expect(r.found, id).toBe(true)
      expect(r.name, id).toBeTruthy()
      expect(r.lat, id).toBeTypeOf('number')
    }
  })
})
