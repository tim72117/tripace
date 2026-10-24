// searchResultLayer 純函式測試:搜尋結果標記功能層(從獨立的 marker hook 遷移進統一繪製層)。
// 行為對照舊 hook:飯店、地點、定位三種外觀;選中/hover 與「已加入候選」兩種狀態;定位結果有編號;
// 選中置頂(999)、定位結果次之(998);可點(回報原本的結果)。fitBounds 鏡頭動作不是繪製,不在這一層。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GeoSearchResult } from '../../../../api'
import type { MarkerDrawable } from '../types'

const content = vi.hoisted(() => ({ calls: [] as unknown[][] }))
vi.mock('../../mapMarkers', () => ({
  searchResultMarkerContent: (...args: unknown[]) => {
    content.calls.push(args)
    return document.createElement('i')
  },
}))

import { searchResultLayer } from './searchResultLayer'
import { itemKey } from '../../../explore/selectedKey'

const res = (kind: GeoSearchResult['kind'], name: string, extra: Partial<GeoSearchResult> = {}): GeoSearchResult => ({
  kind,
  name,
  address: '',
  lat: 1,
  lng: 2,
  ...extra,
})
const layer = (results: GeoSearchResult[], over: Partial<Parameters<typeof searchResultLayer>[0]> = {}) =>
  searchResultLayer({ results, ...over })
const markers = (l: ReturnType<typeof layer>) => l.drawables.filter((d): d is MarkerDrawable => d.kind === 'marker')

beforeEach(() => {
  content.calls = []
})

describe('searchResultLayer 基本', () => {
  it('功能層 id 固定;沒有結果就沒有東西可畫', () => {
    expect(layer([]).id).toBe('searchResult')
    expect(layer([]).drawables).toEqual([])
  })

  it('每筆結果一顆 marker:座標、標題、可點', () => {
    const l = layer([res('hotel', 'H', { lat: 3, lng: 4 }), res('place', 'P')])
    const [h] = markers(l)
    expect(markers(l)).toHaveLength(2)
    expect(h.position).toEqual({ lat: 3, lng: 4 })
    expect(h.title).toBe('H')
    expect(h.clickable).toBe(true)
  })

  it('點 marker:回報原本的結果(第幾顆就是哪一筆)', () => {
    const results = [res('hotel', 'H'), res('place', 'P')]
    const onSelect = vi.fn()
    const l = layer(results, { onSelect })
    const ms = markers(l)
    ms[1].onClick!(ms[1].id)
    expect(onSelect).toHaveBeenCalledWith(results[1])
  })

  it('沒傳 onSelect 點了也不會出錯', () => {
    const [m] = markers(layer([res('hotel', 'H')]))
    expect(() => m.onClick!(m.id)).not.toThrow()
  })

  it('同種類同名同座標的兩筆:id 不衝突', () => {
    const ids = markers(layer([res('place', 'P'), res('place', 'P')])).map((m) => m.id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('searchResultLayer 群組(疊放順序在 GROUP_Z)', () => {
  it('一般結果在 searchResult;定位結果在 searchResultGeocode;選中或 hover 的在 searchResultSelected', () => {
    const results = [res('hotel', 'H'), res('geocode', 'G'), res('place', 'P'), res('place', 'Q')]
    const l = layer(results, { selectedKey: itemKey('place', results[2]), hoverKey: itemKey('hotel', results[0]) })
    expect(markers(l).map((m) => m.group)).toEqual(['searchResultSelected', 'searchResultGeocode', 'searchResultSelected', 'searchResult'])
  })

  it('選中的定位結果:選中優先(searchResultSelected)', () => {
    const results = [res('geocode', 'G')]
    const l = layer(results, { selectedKey: itemKey('geocode', results[0]) })
    expect(markers(l)[0].group).toBe('searchResultSelected')
  })
})

describe('searchResultLayer 內容與 contentKey', () => {
  it('內容:用 searchResultMarkerContent(結果、選中、候選、定位編號)', () => {
    const results = [res('hotel', 'H'), res('geocode', 'G1'), res('geocode', 'G2')]
    const l = layer(results, {
      selectedKey: itemKey('geocode', results[2]),
      candidateKeys: new Set([itemKey('hotel', results[0])]),
    })
    const ms = markers(l)
    ms[0].createContent()
    ms[1].createContent()
    ms[2].createContent()
    expect(content.calls[0]).toEqual([results[0], false, true, undefined])
    expect(content.calls[1]).toEqual([results[1], false, false, 1])
    expect(content.calls[2]).toEqual([results[2], true, false, 2])
  })

  it('定位編號只算定位結果,其他種類不佔編號', () => {
    const results = [res('place', 'P'), res('geocode', 'G'), res('hotel', 'H'), res('geocode', 'G2')]
    markers(layer(results)).forEach((m) => m.createContent())
    expect(content.calls.map((c) => c[3])).toEqual([undefined, 1, undefined, 2])
  })

  it('contentKey 隨種類、類別、選中、候選、編號改變;輸入相同就相同', () => {
    const base = [res('place', 'P', { category: 'museum' })]
    const key = (results: GeoSearchResult[], over: Partial<Parameters<typeof searchResultLayer>[0]> = {}) =>
      markers(layer(results, over))[0].contentKey
    expect(key(base)).toBe(key(base))
    expect(key([res('place', 'P', { category: 'park' })])).not.toBe(key(base))
    expect(key([res('hotel', 'P')])).not.toBe(key(base))
    expect(key(base, { selectedKey: itemKey('place', base[0]) })).not.toBe(key(base))
    expect(key(base, { candidateKeys: new Set([itemKey('place', base[0])]) })).not.toBe(key(base))
  })

  it('名稱改變(座標不變)不影響內容 key(內容不畫名稱),標題照常更新', () => {
    const a = markers(layer([res('place', 'A')]))[0]
    const b = markers(layer([res('place', 'B')]))[0]
    expect(a.contentKey).toBe(b.contentKey)
    expect(b.title).toBe('B')
  })
})
