// useAccentColor 測試。
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAccentColor, DEFAULT_ACCENT_COLOR } from './useAccentColor'

function mapWithAccent(value: string | null) {
  const div = document.createElement('div')
  document.body.appendChild(div)
  if (value != null) div.style.setProperty('--color-accent', value)
  return { getDiv: () => div } as unknown as google.maps.Map
}

describe('useAccentColor', () => {
  it('地圖還沒好:先給預設色', () => {
    const { result } = renderHook(() => useAccentColor({ mapRef: { current: mapWithAccent('#123456') }, mapReady: false }))
    expect(result.current).toBe(DEFAULT_ACCENT_COLOR)
  })

  it('地圖好了:讀地圖容器上的 --color-accent', () => {
    const { result } = renderHook(() => useAccentColor({ mapRef: { current: mapWithAccent('#123456') }, mapReady: true }))
    expect(result.current).toBe('#123456')
  })

  it('讀不到(沒有這個 CSS 變數)時退回預設色', () => {
    const { result } = renderHook(() => useAccentColor({ mapRef: { current: mapWithAccent(null) }, mapReady: true }))
    expect(result.current).toBe(DEFAULT_ACCENT_COLOR)
  })

  it('theme 或 mapVersion 改變時重新讀(強調色會隨明暗主題不同)', () => {
    const map = mapWithAccent('#111111')
    const ref = { current: map as google.maps.Map | null }
    const { result, rerender } = renderHook(
      (p: { theme: string; mapVersion: number }) => useAccentColor({ mapRef: ref, mapReady: true, theme: p.theme, mapVersion: p.mapVersion }),
      { initialProps: { theme: 'light', mapVersion: 0 } },
    )
    expect(result.current).toBe('#111111')
    map.getDiv().style.setProperty('--color-accent', '#222222')
    rerender({ theme: 'dark', mapVersion: 0 })
    expect(result.current).toBe('#222222')
    map.getDiv().style.setProperty('--color-accent', '#333333')
    rerender({ theme: 'dark', mapVersion: 1 })
    expect(result.current).toBe('#333333')
  })
})
