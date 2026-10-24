import { useEffect, useState } from 'react'

// 寬螢幕斷點,服務 /ai-plan 的 PlanLayout wide 模式(見該元件 wide
// prop 的完整說明)。2026-10 新增(使用者明確要求「先新增一個 1024px 的
// layout 元件」)。
const WIDE_BREAKPOINT = 1024

// useIsWide:用 matchMedia 判斷目前寬度是否達到寬螢幕斷點。跟 useIsDesktop
// (768px,見該檔案的完整說明)是獨立的兩個斷點、各自服務不同的判斷:
// isDesktop 決定「要不要用桌面版面」,isWide 決定「桌面版面裡要不要再
// 進一步切換成並排側欄」——不是同一個斷點的兩種取值,也不把 1024px
// 寫進 useIsDesktop 取代 768px,那會讓 768px~1023px 這段寬度的既有桌面
// 使用者(planning/member/desktop/Content.tsx 等跟這次 wide 改動無關的畫面)被誤判成手機版。
//
// 獨立成 hook 而非直接寫在呼叫端:理由同 useIsDesktop 的既有先例,日後
// 若有其他畫面需要同一個斷點判斷,不需要重新發明一次 matchMedia 監聽
// 邏輯。
export function useIsWide(): boolean {
  const [isWide, setIsWide] = useState(
    () => window.matchMedia(`(min-width: ${WIDE_BREAKPOINT}px)`).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${WIDE_BREAKPOINT}px)`)
    const onChange = () => setIsWide(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return isWide
}
