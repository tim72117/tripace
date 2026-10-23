// useResolvedTheme——三態 Theme 解析成明確的 dark / light:明確值直接用,null(跟隨系統)依 prefers-color-scheme,系統切換時跟著變。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResolvedTheme } from './useResolvedTheme'

let listeners: Array<(e: { matches: boolean }) => void> = []
let systemDark = false

beforeEach(() => {
  listeners = []
  systemDark = false
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return systemDark
    },
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.push(fn),
    removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
      listeners = listeners.filter((l) => l !== fn)
    },
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('useResolvedTheme', () => {
  it('明確的 dark / light 直接用,不管系統偏好', () => {
    systemDark = true
    expect(renderHook(() => useResolvedTheme('light')).result.current).toBe('light')
    systemDark = false
    expect(renderHook(() => useResolvedTheme('dark')).result.current).toBe('dark')
  })

  it('null(跟隨系統)依系統偏好,系統切換時更新', () => {
    systemDark = true
    const { result } = renderHook(() => useResolvedTheme(null))
    expect(result.current).toBe('dark')
    act(() => {
      systemDark = false
      listeners.forEach((l) => l({ matches: false }))
    })
    expect(result.current).toBe('light')
  })
})
