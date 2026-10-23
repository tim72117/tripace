import { useState } from 'react'
import { useSystemPrefersDark } from './useSystemPrefersDark'

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

// setTheme 一併回傳(2026-10 新增)——讓呼叫端(目前是 BlogArticlePage,
// 見 ThemePageContent.preferredTheme 的完整說明)能在資料非同步到達後
// 才套用「建議的預設主題」,不是靠一個建構時的初始值參數:文章內容
// (含 preferredTheme)是 API 回應,在第一次 render 時還不知道,無法
// 當成 useState 的初始值傳入,只能等資料到達後用 useEffect 呼叫
// setTheme——呼叫端要自己判斷「目前 theme 是否仍是 null(代表讀者
// 還沒手動切換過)」才套用,避免蓋掉讀者已經手動選的偏好,這個判斷
// 邏輯留給呼叫端做(這個 hook 只負責暴露 setTheme,不內建「只在
// null 時套用」的保護,保持一般化,未來其他呼叫端可能有不同套用
// 時機的需求)。
export function useThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light' | null>(null)
  const systemPrefersDark = useSystemPrefersDark()

  const dark = isCurrentlyDark(theme, systemPrefersDark)
  const toggleTheme = () => setTheme(dark ? 'light' : 'dark')

  return { theme, dark, toggleTheme, setTheme }
}
