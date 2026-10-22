// diffDrawables 純函式測試——規則見 diff.ts 檔頭。
import { describe, it, expect } from 'vitest'
import { diffDrawables, signatureOf, type Entry } from './diff'
import type { Drawable, MarkerDrawable } from './types'

const marker = (id: string, extra: Partial<MarkerDrawable> = {}): MarkerDrawable => ({
  id,
  group: 'currentLocation',
  kind: 'marker',
  position: { lat: 1, lng: 2 },
  contentKey: 'k',
  createContent: () => document.createElement('i'),
  ...extra,
})

const entries = (...ds: Drawable[]) =>
  new Map<string, Entry>(ds.map((d) => [d.id, { kind: d.kind, ...signatureOf(d) }]))

describe('diffDrawables', () => {
  it('空到有:全部 add', () => {
    const r = diffDrawables(new Map(), [marker('a'), marker('b')])
    expect(r.add.map((d) => d.id)).toEqual(['a', 'b'])
    expect(r.update).toEqual([])
    expect(r.remove).toEqual([])
  })

  it('完全相同:沒有任何操作', () => {
    const r = diffDrawables(entries(marker('a')), [marker('a')])
    expect(r).toEqual({ add: [], update: [], remove: [] })
  })

  it('資料改變(位置):update,不重建', () => {
    const r = diffDrawables(entries(marker('a')), [marker('a', { position: { lat: 9, lng: 9 } })])
    expect(r.update.map((d) => d.id)).toEqual(['a'])
    expect(r.add).toEqual([])
    expect(r.remove).toEqual([])
  })

  it('內容 key 改變:update', () => {
    const r = diffDrawables(entries(marker('a')), [marker('a', { contentKey: 'k2' })])
    expect(r.update.map((d) => d.id)).toEqual(['a'])
  })

  it('不在新清單裡的:remove', () => {
    const r = diffDrawables(entries(marker('a'), marker('b')), [marker('a')])
    expect(r.remove).toEqual(['b'])
  })

  it('結構改變(marker 的 clickable):remove 加 add,因為 gmpClickable 只能在建立時決定', () => {
    const r = diffDrawables(entries(marker('a')), [marker('a', { clickable: true })])
    expect(r.remove).toEqual(['a'])
    expect(r.add.map((d) => d.id)).toEqual(['a'])
    expect(r.update).toEqual([])
  })

  it('同 id 但種類改變(marker 變 circle):remove 加 add', () => {
    const circle: Drawable = { id: 'a', group: 'currentLocation', kind: 'circle', center: { lat: 1, lng: 2 }, radiusMeters: 100 }
    const r = diffDrawables(entries(marker('a')), [circle])
    expect(r.remove).toEqual(['a'])
    expect(r.add.map((d) => d.kind)).toEqual(['circle'])
  })

  it('群組(疊放順序)改變算資料改變:update', () => {
    const r = diffDrawables(entries(marker('a')), [marker('a', { group: 'planStop' })])
    expect(r.update.map((d) => d.id)).toEqual(['a'])
  })

  it('同一份清單裡 id 重複:以後面的為準', () => {
    const r = diffDrawables(new Map(), [marker('a', { contentKey: 'first' }), marker('a', { contentKey: 'second' })])
    expect(r.add).toHaveLength(1)
    expect((r.add[0] as MarkerDrawable).contentKey).toBe('second')
  })

  it('函式(createContent、onClick)身分改變不算資料改變——否則呼叫端每次渲染都會觸發 update', () => {
    const r = diffDrawables(entries(marker('a')), [
      marker('a', { createContent: () => document.createElement('b'), onClick: () => {} }),
    ])
    expect(r).toEqual({ add: [], update: [], remove: [] })
  })
})

describe('signatureOf', () => {
  it('circle 與 polyline 的資料(半徑、路徑、樣式)都納入比對', () => {
    const c = (radius: number): Drawable => ({ id: 'c', group: 'planStop', kind: 'circle', center: { lat: 1, lng: 2 }, radiusMeters: radius })
    expect(signatureOf(c(100)).data).not.toBe(signatureOf(c(200)).data)
    const p = (lng: number): Drawable => ({ id: 'p', group: 'planStop', kind: 'polyline', path: [{ lat: 1, lng: 1 }, { lat: 2, lng }] })
    expect(signatureOf(p(3)).data).not.toBe(signatureOf(p(4)).data)
    const styled = (w: number): Drawable => ({ id: 'p', group: 'planStop', kind: 'polyline', path: [], options: { strokeWeight: w } })
    expect(signatureOf(styled(1)).data).not.toBe(signatureOf(styled(2)).data)
  })
})
