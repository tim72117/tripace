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
// 從 DesktopLayout.module.css 的 .panel/.left/.right/.close 抽成獨立元件
// ——原本 panelMode 浮動卡片(trips/timeline/pace/geo-outline)與
// 對話小匡(chat-popover)各自在 DesktopLayout.tsx 內聯組出「外層 div +
// 絕對定位疊加的關閉按鈕」,現在收斂成單一元件,呼叫端只需要決定
// side/width 與要不要顯示 title/onClose。
//
// title/onClose 是選填的——GeoCandidateSidebar/DesktopTripList 目前自己
// 在內容裡渲染標題列(見 PanelHead),不需要外殼再重複一份;chat-popover
// 沒有標題文字,只需要關閉按鈕。三種組合(有 title+onClose、只有
// onClose、都沒有)都支援。
export function FloatingPanel({
  side,
  width,
  height = 'default',
  title,
  onClose,
  className,
  style,
  children,
}: {
  side: 'left' | 'right'
  width: number
  // height:'default' 對齊原本 .panel 的 top:12px/bottom:12px(trips/
  // timeline/pace/geo-outline 等 panelMode 浮動卡片);'info' 對齊
  // GeoInfoPanel/AttractionInfoPanel 的高度(top:64px/bottom:16px,原
  // .infoPanelHeight),目前只有 DesktopLayout.tsx 包 GeoHotelSidebar 的
  // 那個 FloatingPanel 用到。
  height?: 'default' | 'info'
  title?: string
  onClose?: () => void
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  const sideClass = side === 'left' ? styles.left : styles.right
  const heightClass = height === 'info' ? styles.infoHeight : ''
  return (
    <div
      className={`${styles.panel} ${sideClass} ${heightClass}${className ? ` ${className}` : ''}`}
      style={{ width, ...style }}
    >
      {title != null ? (
        <PanelHead title={title} onClose={onClose} />
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
}
