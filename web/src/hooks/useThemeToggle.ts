import { useEffect, useState } from 'react'

// useThemeToggle:城市介紹頁(KyotoPage/JiufenPage/TainanPage)共用的日夜
// 切換邏輯——原本三份檔案各自貼了一份逐字相同的 theme/systemPrefersDark
// state、matchMedia 監聽 effect、isCurrentlyDark 判斷式,抽成這個 hook
// 統一維護。theme 初始值 null(尚未手動切換)時,dark 由系統偏好決定;
// 使用者按下切換鈕後,theme 明確值優先於系統偏好。
function isCurrentlyDark(t: 'dark' | 'light' | null, systemPrefersDark: boolean) {
  if (t === 'dark') return true
  if (t === 'light') return false
  return systemPrefersDark
}

export function useThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light' | null>(null)
  const [systemPrefersDark, setSystemPrefersDark] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemPrefersDark(mql.matches)
    const handleChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches)
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [])

  const dark = isCurrentlyDark(theme, systemPrefersDark)
  const toggleTheme = () => setTheme(dark ? 'light' : 'dark')

  return { theme, dark, toggleTheme }
}
