// composeLayers 純函式測試——規則見 compose.ts 檔頭。
import { describe, it, expect } from 'vitest'
import { composeLayers } from './compose'
import type { FeatureLayer, MarkerDrawable } from './types'

const marker = (id: string): MarkerDrawable => ({
  id,
  group: 'currentLocation',
  kind: 'marker',
  position: { lat: 0, lng: 0 },
  contentKey: 'k',
  createContent: () => document.createElement('i'),
})

describe('composeLayers', () => {
  it('把多個功能層的 drawables 攤平成一份清單,依功能層順序排列', () => {
    const layers: FeatureLayer[] = [
      { id: 'a', drawables: [marker('1'), marker('2')] },
      { id: 'b', drawables: [marker('3')] },
    ]
    expect(composeLayers(layers).map((d) => d.id)).toEqual(['a:1', 'a:2', 'b:3'])
  })

  it('id 加上功能層前綴:不同功能層可以各自使用相同的 id 而不互相衝突', () => {
    const out = composeLayers([
      { id: 'a', drawables: [marker('x')] },
      { id: 'b', drawables: [marker('x')] },
    ])
    expect(new Set(out.map((d) => d.id)).size).toBe(2)
  })

  it('沒有東西可畫的功能層(空陣列)不影響其他功能層', () => {
    const out = composeLayers([
      { id: 'a', drawables: [] },
      { id: 'b', drawables: [marker('1')] },
    ])
    expect(out.map((d) => d.id)).toEqual(['b:1'])
  })

  it('不改動原本的 drawable 物件(回傳新物件,函式屬性保留)', () => {
    const original = marker('1')
    const [out] = composeLayers([{ id: 'a', drawables: [original] }])
    expect(original.id).toBe('1')
    expect(out).not.toBe(original)
    expect((out as MarkerDrawable).createContent).toBe(original.createContent)
  })

  it('空清單 → 空清單', () => {
    expect(composeLayers([])).toEqual([])
  })
})
