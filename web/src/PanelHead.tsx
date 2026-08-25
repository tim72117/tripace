import { X } from 'lucide-react'
import styles from './PanelHead.module.css'

// PanelHead:側欄/浮動卡片內容頂部的標題列——標題文字+可選的靠右圓形
// 關閉按鈕。原本 GeoHotelSidebar.tsx/AddFromCandidateSidebar.tsx 各自在
// module.css 定義幾乎一模一樣的 .head/.title/.closeBtn(這兩個檔案的
// 註解本來就互相承認是同一套視覺語言,只是複製貼上),GeoCandidateSidebar.tsx/
// DesktopTripList.tsx 則各自用全域 class(.desktop-sidebar-head/
// .desktop-sidebar-title)——四處收斂成這一個元件,不再各自重複。
//
// onClose 是選填的——GeoCandidateSidebar/DesktopTripList 不需要自己的
// 關閉按鈕(它們外層由 DesktopLayout.tsx 的 FloatingPanel 統一提供關閉
// 入口,見該元件),只用這個元件的標題列部分。
export function PanelHead({ title, onClose }: { title: string; onClose?: () => void }) {
  return (
    <div className={styles.head}>
      <span className={styles.title}>{title}</span>
      {onClose && (
        <button type="button" className={styles.closeBtn} onClick={onClose} title="關閉">
          <X size={16} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
