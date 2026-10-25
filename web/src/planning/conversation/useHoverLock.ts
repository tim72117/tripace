import { useEffect, useState } from 'react'

// useHoverLock——換畫面後,在「指標真的動過」之前先鎖住 :hover 樣式。
//
// 問題:詢問頁點了國家進到城市頁(或城市→交通方式),新畫面的卡片排版和上一頁幾乎一樣,
// 手指或滑鼠還停在原本被點的位置,新卡片會立刻套上 :hover(藍框加上浮),看起來像「還選著」,
// 使用者會誤以為還停在前一個畫面。觸控裝置上 :hover 還會黏住不放。
// 做法:元件掛載時 locked = true,第一次 pointermove 才解鎖(之後 hover 回饋照舊)。
// 搭配 CSS 只在 (hover: hover) 的裝置、且 :not(.hoverLocked) 時才畫 hover(見 AskPage.module.css)。
// 獨立成 hook 是為了能單獨測試這個「只鎖到第一次移動」的行為,不必渲染整個詢問頁。
export function useHoverLock(): boolean {
  const [locked, setLocked] = useState(true)
  useEffect(() => {
    if (!locked) return
    const unlock = () => setLocked(false)
    window.addEventListener('pointermove', unlock, { once: true, passive: true })
    return () => window.removeEventListener('pointermove', unlock)
  }, [locked])
  return locked
}
