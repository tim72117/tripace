import { describe, expect, it } from 'vitest'
import { resolveExpandedThemeId } from './reducer'
import type { MapMarkerPoint } from './types'

// reducer.test.ts——resolveExpandedThemeId 是 useMapMarkerLayer 的核心
// 純函式判斷邏輯(見 reducer.ts/types.ts 開頭的完整說明:2026-10 改版為
// 完全受控之後,這裡不再是真正的 reducer,只保留這個純函式)。

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
