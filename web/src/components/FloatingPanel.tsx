import { forwardRef } from 'react'
import { X } from 'lucide-react'
import { PanelHead } from './PanelHead'
import styles from './FloatingPanel.module.css'

// FloatingPanel:疊在 .desktop-main(地圖,已有 position: relative)上方的
// 浮動卡片共用外殼——絕對定位、不佔用 flex 版面空間、不推擠地圖(使用者
// 明確要求不要壓縮主顯示的可用寬度)。四周留出間距、圓角+陰影,而不是
// 直接貼齊 .desktop-main 邊界——使用者明確要求「周圍留間隙,才有漂浮
// 感」,貼齊邊界會讓這塊看起來像版面裡緊鄰的一欄,而非真的浮在主顯示
// 之上的卡片。
//
// 從 planning/member/desktop/Content.module.css 的 .panel/.left/.right/.close 抽成獨立元件
// ——原本 panelMode 浮動卡片(trips/timeline/pace/geo-outline)與
// 規劃面板各自在 planning/member/desktop/Content.tsx 內聯組出「外層 div +
// 絕對定位疊加的關閉按鈕」,現在收斂成單一元件,呼叫端只需要決定
// side/width 與要不要顯示 title/onClose。
//
// title/onClose 是選填的——planning/place/desktop/CandidateList/trip/desktop/TripList 目前自己
// 在內容裡渲染標題列(見 PanelHead),不需要外殼再重複一份;規劃面板
// 沒有標題文字,只需要關閉按鈕。三種組合(有 title+onClose、只有
// onClose、都沒有)都支援。
export interface FloatingPanelProps {
  side: 'left' | 'right'
  width: number
  // height:'default' 對齊原本 .panel 的 top:12px/bottom:12px(trips/
  // timeline/pace/geo-outline 等 panelMode 浮動卡片);'info' 對齊
  // PlacePanel/AttractionInfoPanel 的高度(top:64px/bottom:16px,原
  // .infoPanelHeight),目前只有 planning/member/desktop/Content.tsx 包 planning/place/desktop/ResultList 的
  // 那個 FloatingPanel 用到。
  height?: 'default' | 'info'
  title?: string
  // headerAction——選填,只在有 title 時才有意義(轉發給 PanelHead,見
  // 該元件同名 prop 的完整說明)。只傳 onClose、不傳 title 的呼叫端
  // (規劃面板 等)用不到這個插槽——那種情況下標題列整個不存在,
  // 沒有地方可以放這個 icon。
  headerAction?: React.ReactNode
  onClose?: () => void
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}

// forwardRef——比照 ScrollArea.tsx 等既有慣例保留轉發能力,目前沒有
// 呼叫端需要,但沒有理由讓這個共用元件成為擋住未來需求的瓶頸。
export const FloatingPanel = forwardRef<HTMLDivElement, FloatingPanelProps>(function FloatingPanel(
  { side, width, height = 'default', title, headerAction, onClose, className, style, children },
  ref,
) {
  const sideClass = side === 'left' ? styles.left : styles.right
  const heightClass = height === 'info' ? styles.infoHeight : ''
  return (
    <div
      ref={ref}
      className={`${styles.panel} ${sideClass} ${heightClass}${className ? ` ${className}` : ''}`}
      style={{ width, ...style }}
    >
      {title != null ? (
        <PanelHead title={title} headerAction={headerAction} onClose={onClose} />
      ) : (
        onClose && (
          <button type="button" className={styles.floatingCloseBtn} onClick={onClose} title="關閉">
            <X size={16} strokeWidth={2} />
          </button>
        )
      )}
      {children}
    </div>
  )
})
