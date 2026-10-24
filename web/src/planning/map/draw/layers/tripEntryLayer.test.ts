// tripEntryLayer 純函式測試:行程 entry 旗子標記功能層(從獨立的 marker hook 遷移進統一繪製層)。
// 行為對照舊 hook:一筆 entry 一顆旗子、選中或 hover 時放大並置頂(舊 hook 的 zIndex 999)、不可點、顏色用強調色。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MarkerDrawable } from '../types'

const content = vi.hoisted(() => ({ calls: [] as unknown[][] }))
vi.mock('../../mapMarkers', () => ({
  tripEntryMarkerContent: (...args: unknown[]) => {
    content.calls.push(args)
    return document.createElement('i')
  },
}))

import { tripEntryLayer } from './tripEntryLayer'
import { itemKey } from '../../../explore/selectedKey'

const ACCENT = '#8B3A2F'
const entry = (id: string, over: Partial<{ name: string; lat: number; lng: number }> = {}) => ({
  id,
  name: id,
  lat: 1,
  lng: 2,
  ...over,
})
const layer = (over: Partial<Parameters<typeof tripEntryLayer>[0]> = {}) =>
  tripEntryLayer({ entries: [entry('a')], accentColor: ACCENT, ...over })
const markers = (l: ReturnType<typeof layer>) => l.drawables.filter((d): d is MarkerDrawable => d.kind === 'marker')

beforeEach(() => {
  content.calls = []
})

describe('tripEntryLayer', () => {
  it('功能層 id 固定;沒有 entry 就沒有東西可畫', () => {
    expect(layer({ entries: [] }).id).toBe('tripEntry')
    expect(layer({ entries: [] }).drawables).toEqual([])
  })

  it('每筆 entry 一顆 marker:座標、標題;不可點', () => {
    const l = layer({ entries: [entry('a'), entry('b', { name: 'B', lat: 9, lng: 8 })] })
    const [a, b] = markers(l)
    expect(markers(l)).toHaveLength(2)
    expect(b.position).toEqual({ lat: 9, lng: 8 })
    expect(b.title).toBe('B')
    expect(a.clickable).toBeFalsy()
  })

  it('一般 entry 在 tripEntry 群組;選中或 hover 的在 tripEntrySelected 群組(疊在上面)', () => {
    const entries = [entry('a'), entry('b'), entry('c')]
    const l = layer({ entries, selectedKey: itemKey('entry', entries[0]), hoverKey: itemKey('entry', entries[1]) })
    expect(markers(l).map((m) => m.group)).toEqual(['tripEntrySelected', 'tripEntrySelected', 'tripEntry'])
  })

  it('內容:用 tripEntryMarkerContent(選中與否、強調色);第一次建立就是當下的狀態', () => {
    const entries = [entry('a')]
    const l = layer({ entries, selectedKey: itemKey('entry', entries[0]) })
    markers(l)[0].createContent()
    expect(content.calls[0]).toEqual([true, ACCENT])
    content.calls = []
    markers(layer({ entries }))[0].createContent()
    expect(content.calls[0]).toEqual([false, ACCENT])
  })

  it('contentKey 隨選中狀態與強調色改變;輸入相同就相同(內容沒變不該重做)', () => {
    const entries = [entry('a')]
    const key = (over: Partial<Parameters<typeof tripEntryLayer>[0]> = {}) => markers(layer({ entries, ...over }))[0].contentKey
    expect(key()).toBe(key())
    expect(key({ selectedKey: itemKey('entry', entries[0]) })).not.toBe(key())
    expect(key({ accentColor: '#000000' })).not.toBe(key())
  })

  it('同名同座標的兩筆 entry:id 不衝突', () => {
    const l = layer({ entries: [entry('a'), entry('a')] })
    const ids = markers(l).map((m) => m.id)
    expect(new Set(ids).size).toBe(2)
  })
})
