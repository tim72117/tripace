// planStopsToPoints 純函式測試——規則見 planStops.ts 檔頭。
import { describe, expect, it } from 'vitest'
import { resolveExpandedThemeId, planStopsToPoints, type MapMarkerPoint, type PlanStopMarker } from './planStops'

// planStops 測試(2026-10 合併自 reducer.test.ts 與 planStopsToPoints.test.ts)——resolveExpandedThemeId 是站點圓點的
// 核心純函式判斷邏輯(見 planStops.ts 開頭的完整說明:改版為完全受控之後只保留這個純函式),planStopsToPoints 把規劃面板
// 回報的站點轉成點。

const attraction: MapMarkerPoint = { id: 'a', lat: 1, lng: 1, kind: 'attraction' }
const featured: MapMarkerPoint = { id: 'f', lat: 2, lng: 2, kind: 'featured' }
const themeWithChildren: MapMarkerPoint = {
  id: 't',
  lat: 3,
  lng: 3,
  kind: 'theme',
  children: [{ id: 't-c1', lat: 3.001, lng: 3.001 }],
}
const themeNoChildren: MapMarkerPoint = { id: 't-none', lat: 4, lng: 4, kind: 'theme' }
const themeEmptyChildren: MapMarkerPoint = { id: 't-empty', lat: 5, lng: 5, kind: 'theme', children: [] }
// 非 theme 的點即使帶了 children 也不應展開(children 只在 kind:'theme' 有意義)
const attractionWithChildren: MapMarkerPoint = {
  id: 'a-kids',
  lat: 6,
  lng: 6,
  kind: 'attraction',
  children: [{ id: 'x', lat: 6, lng: 6 }],
}

const points = [attraction, featured, themeWithChildren, themeNoChildren, themeEmptyChildren, attractionWithChildren]

describe('resolveExpandedThemeId', () => {
  it('selectedId 為 null 時回傳 null', () => {
    expect(resolveExpandedThemeId(null, points)).toBeNull()
  })

  it('選中帶 children 的主題點時回傳該點 id', () => {
    expect(resolveExpandedThemeId('t', points)).toBe('t')
  })

  it('選中沒有 children 的主題點時回傳 null', () => {
    expect(resolveExpandedThemeId('t-none', points)).toBeNull()
  })

  it('選中 children 是空陣列的主題點時回傳 null', () => {
    expect(resolveExpandedThemeId('t-empty', points)).toBeNull()
  })

  it('選中一般站點(attraction)時回傳 null,即使帶了 children', () => {
    expect(resolveExpandedThemeId('a', points)).toBeNull()
    expect(resolveExpandedThemeId('a-kids', points)).toBeNull()
  })

  it('選中 featured 點時回傳 null', () => {
    expect(resolveExpandedThemeId('f', points)).toBeNull()
  })

  it('查無此點的 id 時回傳 null', () => {
    expect(resolveExpandedThemeId('unknown', points)).toBeNull()
  })

  it('選中主題點的子景點 id 本身時,回傳其所屬父主題點的 id', () => {
    expect(resolveExpandedThemeId('t-c1', points)).toBe('t')
  })

  it('children 非同步晚到:選取同一個 id,points 更新後重新呼叫會反映最新內容', () => {
    const beforeChildren = { ...themeWithChildren, children: [] }
    expect(resolveExpandedThemeId('t', [beforeChildren])).toBeNull()
    expect(resolveExpandedThemeId('t', [themeWithChildren])).toBe('t')
  })
})

const stop = (id: string, extra: Partial<PlanStopMarker> = {}): PlanStopMarker => ({ id, lat: 1, lng: 2, name: id, ...extra })

describe('planStopsToPoints', () => {
  it('沒有 children:kind 是 attraction,欄位原樣帶過去', () => {
    const [p] = planStopsToPoints([stop('a')])
    expect(p).toMatchObject({ id: 'a', lat: 1, lng: 2, name: 'a', kind: 'attraction' })
    expect(p.children).toBeUndefined()
  })

  it('有 children:kind 是 theme,children 原樣帶過去(主題點選中時才會展開)', () => {
    const children = [{ id: 'c1', lat: 3, lng: 4, name: 'C1' }]
    const [p] = planStopsToPoints([stop('t', { children })])
    expect(p.kind).toBe('theme')
    expect(p.children).toEqual(children)
  })

  it('children 是空陣列:當一般站點,不算主題點', () => {
    const [p] = planStopsToPoints([stop('a', { children: [] })])
    expect(p.kind).toBe('attraction')
    expect(p.children).toBeUndefined()
  })

  it('glyph 與 size 有帶就保留,沒帶就不出現', () => {
    const [withBoth, without] = planStopsToPoints([stop('a', { glyph: '<g/>', size: 18 }), stop('b')])
    expect(withBoth.glyph).toBe('<g/>')
    expect(withBoth.size).toBe(18)
    expect('glyph' in without).toBe(false)
    expect('size' in without).toBe(false)
  })

  it('沒有 name 也可以', () => {
    const [p] = planStopsToPoints([{ id: 'a', lat: 1, lng: 2 }])
    expect(p.name).toBeUndefined()
  })

  it('順序保持不變;空清單回空清單', () => {
    expect(planStopsToPoints([stop('a'), stop('b'), stop('c')]).map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(planStopsToPoints([])).toEqual([])
  })

  it('混合清單:只有帶 children 的是主題點', () => {
    const out = planStopsToPoints([stop('a'), stop('t', { children: [{ id: 'c', lat: 0, lng: 0 }] }), stop('b')])
    expect(out.map((p) => p.kind)).toEqual(['attraction', 'theme', 'attraction'])
  })
})
