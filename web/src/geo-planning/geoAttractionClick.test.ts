import { describe, it, expect } from 'vitest'
import {
  planAttractionClick,
  minZoomForLevel,
  FALLBACK_ZOOM_NO_LEVEL,
} from './geoAttractionClick'

describe('planAttractionClick', () => {
  it('有 radiusMeters 時優先選 fit-bounds,即使同時也帶 level', () => {
    // radiusMeters 的優先順序高於 level——這是斷言「判斷順序」而非只看
    // 單一欄位的結果:若順序寫反(level 優先),帶了兩個欄位的地標會被
    // 誤判成 pan-and-zoom,放大幅度會跟手動整理的觀光慣稱分區(古城區/
    // 尼曼區)的實際範圍對不上。
    expect(planAttractionClick({ radiusMeters: 800, level: 3 })).toEqual({
      kind: 'fit-bounds',
      radiusMeters: 800,
    })
  })

  it('radiusMeters 為 0 視同沒有範圍,退回 pan-and-zoom', () => {
    expect(planAttractionClick({ radiusMeters: 0, level: 2 })).toEqual({
      kind: 'pan-and-zoom',
      minZoom: minZoomForLevel(2),
    })
  })

  it('沒有 radiusMeters、有 level:pan-and-zoom 帶對應的 minZoom', () => {
    expect(planAttractionClick({ level: 4 })).toEqual({
      kind: 'pan-and-zoom',
      minZoom: minZoomForLevel(4),
    })
  })

  it('沒有 radiusMeters、也沒有 level(即時查詢結果):minZoom 為 null,呼叫端應改用固定 zoom', () => {
    const plan = planAttractionClick({})
    expect(plan).toEqual({ kind: 'pan-and-zoom', minZoom: null })
    // 明確斷言呼叫端在 minZoom 為 null 時該退回的固定值仍是預期的
    // FALLBACK_ZOOM_NO_LEVEL,避免這個常數被改動時沒人注意到。
    expect(FALLBACK_ZOOM_NO_LEVEL).toBe(16)
  })
})

describe('minZoomForLevel(與 GeoOutlineMap.tsx 的門檻表同步)', () => {
  it.each([
    [1, 0],
    [2, 11],
    [3, 12],
    [4, 14],
    [5, 15],
  ])('level=%i → minZoom=%i', (level, expected) => {
    expect(minZoomForLevel(level)).toBe(expected)
  })
})
