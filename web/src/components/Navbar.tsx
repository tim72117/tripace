import { forwardRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import styles from './Navbar.module.css'

// Navbar:「頂部導覽列骨架該長什麼樣子」這組視覺規則的唯一共用實作——
// 重構前,base-ui.css 的全域字串 class .navbar 被 OnagentBridgeDemo.tsx/
// PublicViewScreen.tsx 兩處呼叫端用 className="navbar" 這種型別系統完全
// 無法檢查的字串引用,巢狀選擇器 .navbar .title 也一樣只能靠字串
// className="title" 命中,拼錯字或忘記包一層都不會被 tsc/lint 抓到。
//
// grep 全部呼叫端後確認:現存只有這兩處直接渲染 .navbar,兩處的 JSX
// 結構完全一致——左右各放一個 `<span style={{ width: 36 }} />` 佔位
// (目前都是空的,不放任何按鈕),中間是置中標題文字。沒有任何呼叫端
// 用過 .navbar .icon-btn(IconButton 的 square prop 是為這個情境保留的
// 尺寸規格,見該檔案的說明,但目前沒有人用),也沒有任何呼叫端用過
// navbar-hidden 這個 modifier——ChatScreen.tsx 的註解「navbar 移除後」
// 指的是它自己不再渲染任何一種 navbar(改用 PhoneContent.tsx 的
// MainNavBar/PhoneBottomSheet 的 SheetHead),不是「navbar 曾經用
// hidden 狀態」,grep 全專案(含 .tsx/.css)找不到 navbar-hidden 除了
// base-ui.css 自己的定義之外的任何引用。
//
// title 設計成具名 prop 而非 children 插槽——原本的巢狀選擇器
// `.navbar .title` 明確是「置中標題文字」這一種語意角色,不是任意內容
// (跟 Button 的 variant、IconButton 的 active/square 一樣是具名語意
// 而非開放樣式覆寫的既有慣例一致)。
//
// left/right 用具名 slot prop(而非 children 或更彈性的 render prop)——
// justify-content: space-between 暗示三段式佈局,兩個實際呼叫端目前都是
// 固定寬度的空白佔位 span(用來讓中間標題視覺置中,即使左右都還沒有真的
// 按鈕),用具名 prop 明確表達「這裡未來可能放一顆返回鍵/關閉鍵」的語意
// 角色,不開放呼叫端塞任意巢狀結構破壞三段式版面假設。left/right 預設
// 不帶內容時,仍然渲染一個佔位 span(見下方實作),確保沒有傳這兩個 prop
// 的呼叫端也能維持原本兩處呼叫端目前的「標題置中」視覺效果，不需要每個
// 呼叫端自己重複寫 `<span style={{ width: 36 }} />` 佔位。
export interface NavbarProps {
  title: ReactNode
  left?: ReactNode
  right?: ReactNode
  // hidden:原 base-ui.css 的 navbar-hidden modifier——grep 確認目前沒有
  // 任何呼叫端在用(見上方說明),但這是原本全域樣式明確定義過、有實測
  // 過的行為(對齊抽屜欄 .tabs 的高度公式,margin-bottom: -60px 這個數值
  // 不是隨便猜的),不是從未存在過的死代碼,只是暫時沒有呼叫端需要「導覽
  // 列可以收合隱藏」這個能力。保留這個 prop 供未來需要(例如捲動時自動
  // 隱藏上方列)的呼叫端使用,不因為目前沒人用就砍掉這個已經設計好的行為。
  hidden?: boolean
  // className/style:比照 ScrollArea/Button 等其餘共用元件的既有慣例,
  // 保留一次性覆寫的逃生口——目前沒有呼叫端需要,但沒有理由讓這個共用
  // 元件成為擋住未來需求的瓶頸。
  className?: string
  style?: CSSProperties
}

// forwardRef——比照 ScrollArea.tsx 等既有慣例保留轉發能力,目前沒有
// 呼叫端需要,但沒有理由讓這個共用元件成為擋住未來需求的瓶頸。
export const Navbar = forwardRef<HTMLDivElement, NavbarProps>(function Navbar(
  { title, left, right, hidden, className, style },
  ref,
) {
  return (
    <div
      ref={ref}
      className={[styles.navbar, hidden && styles.navbarHidden, className].filter(Boolean).join(' ')}
      style={style}
    >
      <span className={styles.side}>{left}</span>
      <span className={styles.title}>{title}</span>
      <span className={styles.side}>{right}</span>
    </div>
  )
})
