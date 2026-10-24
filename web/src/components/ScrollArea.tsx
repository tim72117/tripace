import { forwardRef, useEffect } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useIsInsideSheetBody } from './PhoneBottomSheet'
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
//   2) 候選籃抽屜(現 planning/place/phone/CandidateList.tsx)的 .list。
//   3) base-ui.css 的全域 .screen-body(至少 8 處呼叫端直接用字串
//      className="screen-body" 或樣板字串組合引用,不是透過 CSS Modules
//      import,型別系統完全無法檢查這些字串有沒有打錯字或忘記加)。
// 這個元件把「這個 DOM 節點的 touch-action/overflow 該怎麼設」收斂成
// 唯一真理來源——往後同一類 bug(某處還能雙指縮放)只需要改這一個檔案,
// 不用再排查是哪一套捲動容器實作漏改。呼叫端不應該再自己宣告
// touch-action/overflow-y 相關的 CSS(除非有明確、記錄在案的特殊理由,
// 例如 planning/place/phone/CandidateList.tsx 的 .list 有自己的 padding
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
  // insideSheetBody——2026-10 新增(使用者明確要求「業界會在元件內規範
  // 上層元件要有什麼規範才能正確運作的這種規範模式嗎」,對齊 Radix UI
  // 等函式庫「元件掛載時主動檢查自己期待的環境條件是否成立,不成立就
  // 警告」的做法):ScrollArea 跟 components/PhoneBottomSheet.tsx 都各自
  // 是「這個 DOM 節點 overflow/touch-action 該怎麼設」的唯一真理來源
  // (見上方檔頭的完整說明),若 ScrollArea 被渲染在任何
  // PhoneBottomSheet/StandaloneSheet/StackedSheet/PersistentSheet 的
  // children 範圍內(不限於有沒有額外用 <SheetBody> 標籤包——
  // SheetBodyContext.Provider 本來就包住整個 renderedChildren,見
  // PhoneBottomSheet.tsx 980-996 行),都可能跟外層 bottom sheet 的拖曳
  // 手勢互搶觸控事件,出現兩種風險之一:
  //   1) 若呼叫端有用 <SheetBody> 包,會疊出兩層各自宣告
  //      overflow-y/touch-action 的捲動容器——SheetBody 外層的
  //      overscroll-behavior-y: contain(見 PhoneBottomSheet.module.css
  //      .bodyScrollable 的完整說明:專門用來擋掉「捲到頂觸發拖拉交接
  //      時,瀏覽器原生彈性回彈動畫可能已經搶先播放」這個視覺衝突)防護
  //      不到真正承載捲動的內層 ScrollArea,等於防護形同虛設。
  //   2) 若沒有用 <SheetBody> 包,ScrollArea 自己的 touch-action: pan-y
  //      仍然可能讓瀏覽器原生捲動介入,跟外層 head 那組(標頭/拖曳把手)
  //      的拖曳手勢判斷互搶事件。
  // 這不是假設性風險——user/SettingsScreen.tsx 就是目前真實存在的案例
  // (包在 StandaloneSheet 的 SheetBody 裡,內部又自己包一層 ScrollArea,
  // 屬於情境 1)。
  //
  // useIsInsideSheetBody()(PhoneBottomSheet.tsx 匯出的唯一用途就是這個
  // 偵測,不洩漏任何 SheetBodyContext 內部實作細節)偵測到這個情況時,
  // 只在開發模式(import.meta.env.DEV)主動丟出明確警告,指向正確做法
  // ——生產環境不中斷渲染、不影響使用者,只是不會主動被提醒;這點對齊
  // Radix UI/React Aria 的慣例(開發期攔截、生產環境靜默)。
  const insideSheetBody = useIsInsideSheetBody()
  useEffect(() => {
    if (insideSheetBody && import.meta.env.DEV) {
      console.warn(
        '[ScrollArea] 偵測到這個元件被渲染在 bottom sheet(components/PhoneBottomSheet.tsx 的 ' +
          'StandaloneSheet/StackedSheet/PersistentSheet)的內容範圍裡——這個捲動容器可能跟外層 ' +
          'bottom sheet 的拖曳手勢互搶觸控事件,捲到頂觸發拖拉交接時可能出現瀏覽器原生彈性回彈動畫跟 ' +
          '拖曳手勢衝突的視覺問題。正確做法:改用 PhoneBottomSheet.tsx 匯出的 <SheetBody> 元件本身 ' +
          '當捲動容器,它已經處理好捲動/拖拉交接的仲裁邏輯,不需要(也不該)再疊加這個 ScrollArea。',
      )
    }
  }, [insideSheetBody])

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
