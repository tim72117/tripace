import { forwardRef } from 'react'
import type { CSSProperties } from 'react'
import { X } from 'lucide-react'
import styles from './PanelHead.module.css'

// PanelHead:側欄/浮動卡片內容頂部的標題列——標題文字+可選的靠右圓形
// 關閉按鈕。原本各個側欄各自在 module.css 定義幾乎一模一樣的
// .head/.title/.closeBtn,或各自用全域 class(.desktop-sidebar-head/
// .desktop-sidebar-title)——收斂成這一個元件,不再各自重複。
//
// onClose 是選填的——planning/place/desktop/CandidateList/trip/desktop/TripList 不需要自己的
// 關閉按鈕(它們外層由 planning/member/desktop/Content.tsx 的 FloatingPanel 統一提供關閉
// 入口,見該元件),只用這個元件的標題列部分。
export interface PanelHeadProps {
  title: string
  onClose?: () => void
  // headerAction——選填,2026-10 新增:使用者明確要求「規劃行程標頭列
  // 加上開關路徑的 icon」(地圖右上角「規劃行程」規劃面板,見
  // planning/member/desktop/Content.tsx 的完整說明)。渲染在標題文字之後、關閉按鈕之前
  // (若有的話),只在呼叫端真的傳入時才多佔用這個位置——其餘呼叫端
  // (trips/timeline/geo-outline 等)不傳就完全不受影響,維持
  // 原本只有「標題+關閉按鈕」兩個元素的版面。
  headerAction?: React.ReactNode
  // className/style:比照 ScrollArea/Button 等其餘共用元件的既有慣例,
  // 保留一次性覆寫的逃生口——目前沒有呼叫端需要,但沒有理由讓這個共用
  // 元件成為擋住未來需求的瓶頸。
  className?: string
  style?: CSSProperties
}

// forwardRef——比照 ScrollArea.tsx 等既有慣例保留轉發能力,目前沒有
// 呼叫端需要,但沒有理由讓這個共用元件成為擋住未來需求的瓶頸。
export const PanelHead = forwardRef<HTMLDivElement, PanelHeadProps>(function PanelHead(
  { title, onClose, headerAction, className, style },
  ref,
) {
  return (
    <div ref={ref} className={className ? `${styles.head} ${className}` : styles.head} style={style}>
      <span className={styles.title}>{title}</span>
      {headerAction}
      {onClose && (
        <button type="button" className={styles.closeBtn} onClick={onClose} title="關閉">
          <X size={16} strokeWidth={2} />
        </button>
      )}
    </div>
  )
})
