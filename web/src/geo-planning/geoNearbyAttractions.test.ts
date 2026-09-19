import { describe, expect, it } from 'vitest'
import type { GeoAttraction } from '../api'
import { computeNearbyAttractions, filterNearbyByCategory, nearbyCategoriesPresent } from './geoNearbyAttractions'

// geoNearbyAttractions.test.ts——「附近景點」清單純邏輯(距離排序、分類
// 篩選規則)的回歸測試,這三支函式是 DesktopLayout.tsx/AttractionInfoPanel.tsx/
// KiyomizuDemoPage.tsx 原本各自寫死、之後 GeoOutlinePhoneView.tsx 手機版
// 也共用的唯一真相來源(見該檔案開頭的完整說明)。
function attraction(overrides: Partial<GeoAttraction> = {}): GeoAttraction {
  return { name: '忠僕茶屋', lat: 34.99, lng: 135.78, isTheme: false, ...overrides }
}

describe('computeNearbyAttractions', () => {
  it('依步行分鐘數由近到遠排序', () => {
    const anchor = attraction({ name: '清水寺', lat: 34.9949, lng: 135.785, isTheme: true })
    const far = attraction({ name: '遠的', lat: 35.01, lng: 135.8 })
    const near = attraction({ name: '近的', lat: 34.995, lng: 135.7851 })
    const result = computeNearbyAttractions(anchor, [far, near], 10)
    expect(result.map((r) => r.attraction.name)).toEqual(['近的', '遠的'])
  })

  it('排除錨點自身(name/lat/lng 全部相同)', () => {
    const anchor = attraction({ name: '清水寺', lat: 34.9949, lng: 135.785, isTheme: true })
    const self = attraction({ name: '清水寺', lat: 34.9949, lng: 135.785, isTheme: true })
    const other = attraction({ name: '忠僕茶屋', lat: 34.995, lng: 135.7851 })
    const result = computeNearbyAttractions(anchor, [self, other], 10)
    expect(result.map((r) => r.attraction.name)).toEqual(['忠僕茶屋'])
  })

  it('依 limit 截斷', () => {
    const anchor = attraction({ name: '清水寺', lat: 34.9949, lng: 135.785, isTheme: true })
    const pool = Array.from({ length: 10 }, (_, i) =>
      attraction({ name: `景點${i}`, lat: 34.995 + i * 0.001, lng: 135.785 }))
    const result = computeNearbyAttractions(anchor, pool, 3)
    expect(result).toHaveLength(3)
  })

  it('limit 為 Infinity 時不截斷(KiyomizuDemoPage.tsx 的用法)', () => {
    const anchor = attraction({ name: '清水寺', lat: 34.9949, lng: 135.785, isTheme: true })
    const pool = Array.from({ length: 20 }, (_, i) =>
      attraction({ name: `景點${i}`, lat: 34.995 + i * 0.001, lng: 135.785 }))
    const result = computeNearbyAttractions(anchor, pool, Infinity)
    expect(result).toHaveLength(20)
  })
})

describe('nearbyCategoriesPresent', () => {
  it('只回傳清單裡實際出現過的分類', () => {
    const list = [
      { attraction: attraction({ name: 'A', category: 'tea' }), minutes: 1 },
      { attraction: attraction({ name: 'B', category: 'craft' }), minutes: 2 },
      { attraction: attraction({ name: 'C', category: 'tea' }), minutes: 3 },
      { attraction: attraction({ name: 'D' }), minutes: 4 },
    ]
    expect(nearbyCategoriesPresent(list)).toEqual(new Set(['tea', 'craft']))
  })

  it('空清單回傳空集合', () => {
    expect(nearbyCategoriesPresent([])).toEqual(new Set())
  })
})

describe('filterNearbyByCategory', () => {
  const list = [
    { attraction: attraction({ name: 'A', category: 'tea' }), minutes: 1 },
    { attraction: attraction({ name: 'B', category: 'craft' }), minutes: 2 },
    { attraction: attraction({ name: 'C', category: undefined }), minutes: 3 },
  ]

  it('filter 為 null 時回傳完整清單(含無分類項目)', () => {
    expect(filterNearbyByCategory(list, null)).toHaveLength(3)
  })

  it('filter 有值時只留符合分類的項目,無分類項目一律排除', () => {
    const result = filterNearbyByCategory(list, 'tea')
    expect(result.map((r) => r.attraction.name)).toEqual(['A'])
  })
})
