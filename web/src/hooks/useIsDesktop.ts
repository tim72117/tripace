import { useEffect, useState } from 'react'

// 桌面版斷點,需與 styles.css 的 @media (min-width: 768px) 一致。
const DESKTOP_BREAKPOINT = 768

// useIsDesktop:用 matchMedia 判斷目前寬度是否達到桌面斷點。
// 用 JS 判斷、只渲染其中一種佈局(而非兩份 DOM 都渲染、用 CSS 切換顯示),
// 是因為 ChatScreen 掛載時會建立 WebSocket 連線並各自 fetch 資料——
// 若手機版與桌面版兩棵 DOM 同時存在,選中行程時會同時掛載兩個 ChatScreen,
// 造成重複連線與重複請求。供 App.tsx 的 PhoneContent/pace/PacePage.tsx
// 共用,故獨立成 hook 而非放在任一個消費端自己的檔案。
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`)
    const onChange = () => setIsDesktop(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}
