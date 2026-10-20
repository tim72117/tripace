import { describe, it, expect } from 'vitest'
import { HAND_DRAWN_MAP_STYLE, HAND_DRAWN_MAP_STYLE_DARK, HAND_DRAWN_DARK_COLORS } from './handDrawnMapStyle'

// 淺色版出現的每個顏色。
function colorsOf(style: google.maps.MapTypeStyle[]): string[] {
  const out: string[] = []
  for (const rule of style) {
    for (const s of rule.stylers ?? []) {
      const color = (s as { color?: unknown }).color
      if (typeof color === 'string') out.push(color)
    }
  }
  return out
}

describe('手繪地圖暗色版', () => {
  it('淺色版的每個顏色都在對映表裡(新增顏色卻忘了補暗色版會失敗)', () => {
    const missing = [...new Set(colorsOf(HAND_DRAWN_MAP_STYLE))].filter((c) => !(c in HAND_DRAWN_DARK_COLORS))
    expect(missing).toEqual([])
  })

  it('暗色版的結構與淺色版完全一致,只有顏色不同', () => {
    expect(HAND_DRAWN_MAP_STYLE_DARK).toHaveLength(HAND_DRAWN_MAP_STYLE.length)
    const strip = (style: google.maps.MapTypeStyle[]) =>
      JSON.stringify(style, (k, v) => (k === 'color' ? '*' : v))
    expect(strip(HAND_DRAWN_MAP_STYLE_DARK)).toBe(strip(HAND_DRAWN_MAP_STYLE))
  })

  it('暗色版的所有顏色都換掉了(沒有殘留淺色版的顏色)', () => {
    const light = new Set(colorsOf(HAND_DRAWN_MAP_STYLE))
    const stillLight = colorsOf(HAND_DRAWN_MAP_STYLE_DARK).filter((c) => light.has(c))
    expect(stillLight).toEqual([])
  })

  it('底色確實變暗', () => {
    const base = (style: google.maps.MapTypeStyle[]) =>
      (style.find((r) => r.elementType === 'geometry' && !r.featureType)?.stylers?.[0] as { color: string }).color
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16)
      return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114
    }
    expect(lum(base(HAND_DRAWN_MAP_STYLE_DARK))).toBeLessThan(lum(base(HAND_DRAWN_MAP_STYLE)) / 3)
  })
})
