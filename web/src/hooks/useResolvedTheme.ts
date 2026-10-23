import type { ResolvedTheme, Theme } from '../theme'
import { useSystemPrefersDark } from './useSystemPrefersDark'

// useResolvedTheme——把三態的 Theme(dark / light / null = 跟隨系統)解析成明確的 'dark' | 'light'。
// 明確值直接用;null 依系統偏好決定,系統切換時跟著變(地圖會因此重建一次,與手動切換日夜一致)。
export function useResolvedTheme(theme: Theme): ResolvedTheme {
  const systemPrefersDark = useSystemPrefersDark()
  if (theme === 'dark' || theme === 'light') return theme
  return systemPrefersDark ? 'dark' : 'light'
}
