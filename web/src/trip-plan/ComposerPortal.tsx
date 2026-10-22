import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

// ComposerPortal——把輸入框傳送進版面外殼提供的插槽(見
// plan-core/overlayDom.ts 的三種 slot 值語意)。
//
// 抽成獨立元件是為了讓這個分支可以單獨測試,而不是埋在 TripPlanPage
// 一千多行的 render 裡。slot 為 undefined(不在外殼裡)時是完全透明的
// 直通,所以 /app 的浮動面板、手機 sheet、/trip-plan 全頁都不受影響。
interface ComposerPortalProps {
  slot: HTMLElement | null | undefined
  // wrapperClassName——傳送後輸入框不再是 .compact 的後代,原本寫成
  // 「.compact .xxx」這類後代選擇器的樣式(例如手機版放大的輸入框文字)
  // 會失效,所以包一層帶同樣 class 的容器讓選擇器照常命中。
  wrapperClassName?: string
  children: ReactNode
}

export function ComposerPortal({ slot, wrapperClassName, children }: ComposerPortalProps) {
  if (slot === undefined) return <>{children}</>
  if (slot === null) return null
  return createPortal(<div className={wrapperClassName}>{children}</div>, slot)
}
