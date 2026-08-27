import { forwardRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import styles from './ScrollArea.module.css'

// ScrollArea:「內容區塊需要垂直捲動、但要禁用縮放/水平手勢」這個行為的
// 唯一共用實作——重構前,同一個行為(pinch-zoom 沒被正確擋住)在三個地方
// 各自維護一份幾乎一樣的 CSS,同一類 bug 要修三次:
//   1) components/PhoneBottomSheet.tsx 的 .body/.bodyScrollable(這組
//      overflow: hidden/auto 開關搭配的邏輯留在原地,不搬進這裡——那是
//      「多段吸附 bottom sheet 是否已展開到最頂段」這個更複雜的狀態機
//      的一部分,.bodyScrollable 疊加時實際套用的 touch-action/
//      overscroll-behavior 數值跟這裡刻意一致,但 overflow 開關本身
//      屬於 PhoneBottomSheet 自己的拖曳手勢交接邏輯,語意上不是單純的
//      「捲動容器」,勉強抽出來只會讓兩邊都變得更難懂)。
//   2) geo-planning/GeoOutlinePhoneCandidateDrawer.tsx 的 .list。
//   3) base-ui.css 的全域 .screen-body(至少 8 處呼叫端直接用字串
//      className="screen-body" 或樣板字串組合引用,不是透過 CSS Modules
//      import,型別系統完全無法檢查這些字串有沒有打錯字或忘記加)。
// 這個元件把「這個 DOM 節點的 touch-action/overflow 該怎麼設」收斂成
// 唯一真理來源——往後同一類 bug(某處還能雙指縮放)只需要改這一個檔案,
// 不用再排查是哪一套捲動容器實作漏改。呼叫端不應該再自己宣告
// touch-action/overflow-y 相關的 CSS(除非有明確、記錄在案的特殊理由,
// 例如 GeoOutlinePhoneCandidateDrawer.tsx 的 .list 有自己的 padding
// 語意,見該檔案的說明,選擇不套用這個元件)。
export interface ScrollAreaProps {
  children: ReactNode
  // className:疊加呼叫端自己的樣式(比照原本 `screen-body ${styles.xxx}`
  // 這種疊加寫法)——直接跟這個元件內部的 CSS Module class 字串拼接,
  // 呼叫端可以在自己的 module 裡定義額外規則(padding-bottom、flex
  // 相關屬性等),但不應該在裡面重新宣告 overflow-y/touch-action(那樣
  // 會蓋掉這裡的設定,失去單一真理來源的意義)。
  className?: string
  // style:inline 樣式(至少 OnagentBridgeDemo.tsx 需要 padding: 16 這種
  // 一次性的內聯覆寫,不值得為它新增一個 CSS Module class)。
  style?: CSSProperties
}

// forwardRef——至少 ChatScreen.tsx(x2)、PublicViewScreen.tsx、
// PhoneTimelineDrawer.tsx 這幾處呼叫端需要抓到這個 DOM 節點的 ref 做
// 捲動位置控制(例如開啟時自動捲到「今天」那一列、新訊息進來捲到底部),
// 沒有 ref 轉發這個元件就無法取代原本直接掛 ref 在 div 上的寫法。
export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
  { children, className, style },
  ref,
) {
  return (
    <div
      ref={ref}
      className={className ? `${styles.scrollArea} ${className}` : styles.scrollArea}
      style={style}
    >
      {children}
    </div>
  )
})
