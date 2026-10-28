import { describe, expect, it, vi } from 'vitest'
import { mergeAskMapView } from './planMapShared'
import { buildAskMapView, EMPTY_ASK_MAP_VIEW } from '../conversation/askMapView'
import { itemKey } from '../explore/selectedKey'
import type { GeoSearchResult } from '../../api'

const existing: GeoSearchResult = { kind: 'place', name: '既有', address: '', lat: 1, lng: 1, placeId: 'x' }

describe('buildAskMapView / mergeAskMapView', () => {
  it('沒有候選點:原樣回傳搜尋結果輸入(不改身分)', () => {
    const input = { results: [existing] }
    expect(mergeAskMapView(input, undefined)).toBe(input)
    expect(mergeAskMapView(input, EMPTY_ASK_MAP_VIEW)).toBe(input)
    expect(mergeAskMapView(undefined, buildAskMapView([], []))).toBeUndefined()
  })

  it('候選點併進結果;已勾選的進 candidateKeys(勾選徽章),未勾選的不進', () => {
    const view = buildAskMapView(
      [
        { placeId: 'p1', name: '赤崁樓', lat: 22.99, lng: 120.2 },
        { placeId: 'p2', name: '孔廟', lat: 22.98, lng: 120.21 },
      ],
      ['p1'],
    )
    const merged = mergeAskMapView({ results: [existing], candidateKeys: new Set(['kept']) }, view)!
    expect(merged.results.map((r) => r.name)).toEqual(['既有', '赤崁樓', '孔廟'])
    expect(merged.results[1]).toMatchObject({ kind: 'place', placeId: 'p1' })
    expect(merged.candidateKeys!.has('kept')).toBe(true)
    expect(merged.candidateKeys!.has(itemKey('place', merged.results[1]))).toBe(true)
    expect(merged.candidateKeys!.has(itemKey('place', merged.results[2]))).toBe(false)
  })

  it('點候選標記切換勾選;點原有搜尋結果仍走原本的 onSelect;沒有原輸入也能畫', () => {
    const onToggle = vi.fn()
    const onSelect = vi.fn()
    const view = buildAskMapView([{ placeId: 'p1', name: '赤崁樓', lat: 22.99, lng: 120.2 }], [], onToggle)
    const merged = mergeAskMapView({ results: [existing], onSelect }, view)!
    merged.onSelect!(merged.results[1])
    expect(onToggle).toHaveBeenCalledWith('p1')
    expect(onSelect).not.toHaveBeenCalled()
    merged.onSelect!(merged.results[0])
    expect(onSelect).toHaveBeenCalledWith(existing)

    const only = mergeAskMapView(undefined, view)!
    expect(only.results).toHaveLength(1)
  })
})
