import { useEffect, useState } from 'react'

// useSystemPrefersDark——系統(瀏覽器/OS)目前是不是深色偏好(prefers-color-scheme: dark),並隨系統切換更新。
// useThemeToggle(城市介紹頁、/ai-plan 的日夜切換)與 useResolvedTheme(登入後把「跟隨系統」解析成明確值)共用。
export function useSystemPrefersDark(): boolean {
  const [systemPrefersDark, setSystemPrefersDark] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemPrefersDark(mql.matches)
    const handleChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches)
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [])
  return systemPrefersDark
}
