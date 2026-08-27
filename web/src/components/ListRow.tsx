import { forwardRef } from 'react'
import type { ReactNode, HTMLAttributes, ElementType } from 'react'
import styles from './ListRow.module.css'

// ListRow/List:「清單裡一列可點擊項目該長什麼樣子(左側 icon/大頭貼+
// 中間可截斷的標題/副標題+右側可有可無的附加內容、選取態高亮、hover/
// active 底色)」這組視覺規則的唯一共用實作——重構前,base-ui.css 的全域
// 字串 class .list/.row/.grow/.name/.sub 被 SettingsScreen.tsx/
// SettingsDialog.tsx/DesktopUserMenu.tsx/TripManageModal.tsx(成員清單)
// 四處呼叫端用 className="row"/"list" 這種型別系統完全無法檢查的字串
// 引用重複拼出幾乎一樣的 DOM 結構。
//
// 插槽式設計(icon/title/subtitle/trailing 具名 prop,而非固定死的
// avatar+文字兩欄):grep 確認過的四處呼叫端,列的「右側附加內容」差異
// 很大——SettingsScreen/SettingsDialog 的登出/健康檢查列右側可能什麼都
// 沒有或帶一顆 ChevronLeft,TripManageModal 成員清單右側是權限 chip
// 按鈕/文字,固定 props(例如寫死 rightIcon?: ReactNode)無法優雅表達
// 「右側是一顆互動按鈕」這種情況,故 trailing 開放成 ReactNode 插槽而非
// 限定型別。icon 同理(全部呼叫端目前都是 <Avatar/>,但插槽開放成
// ReactNode 而非寫死 Avatar,避免這個共用元件反過來依賴 user 領域的
// Avatar 元件)。
//
// title/subtitle 維持具名 prop(而非也開放成插槽)——這兩個是全部呼叫端
// 都有的固定內容(文字,最多小小的 inline style 顏色覆寫,見
// SettingsDialog.tsx 登出列的紅字),不像 trailing 有結構性差異,具名
// prop 比插槽更能讓呼叫端一眼看出「這裡放標題/副標」的用途,也讓
// ListRow 內部能統一套用 .name/.sub 的字級/截斷規則,不需要呼叫端自己
// import 這兩個 class。
//
// as='div'|'li':原本四處呼叫端的 DOM 結構分兩種——SettingsScreen/
// SettingsDialog/DesktopUserMenu 是單獨的 <div className="row">(不是
// 清單,只有 1~2 列),TripManageModal 成員清單是
// <ul className="list"><li className="row">(HTML 規範要求 <ul> 的
// 直接子節點必須是 <li>,不能是 <div>)。用 as prop 切換最外層標籤,而非
// 拆成 ListRow/ListRowItem 兩個幾乎一模一樣、只有最外層標籤不同的元件——
// 避免內部 JSX(icon/grow/name/sub/trailing 五段結構)重複貼兩份,任何
// 一處未來調整都要同步改兩個檔案。
// Omit<..., 'title'>:HTMLAttributes 內建的 title 是原生 tooltip 屬性
// (string | undefined),跟這裡要表達「列標題內容」的 title prop(ReactNode,
// 可以是文字也可以是 JSX)撞名但語意/型別都不同,用 Omit 排除原生版本。
export interface ListRowProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  // as:最外層標籤,預設 'div'(對齊多數呼叫端的用法)。放進 <List> 底下
  // 時要傳 'li'。
  as?: 'div' | 'li'
  // icon:列最左側的圖示/大頭貼插槽,全部呼叫端目前都是 <Avatar/>。
  icon?: ReactNode
  title: ReactNode
  // titleColor:SettingsScreen.tsx 的「登出」列標題需要紅字(inline
  // style={{ color: 'var(--ios-red)' }}),不值得為了這一種顏色開一個
  // danger variant,直接開放顏色字串比照原本呼叫端已經在用的 inline
  // style 寫法。
  titleColor?: string
  subtitle?: ReactNode
  // trailing:列最右側插槽,見上方元件說明——ChevronLeft 圖示/權限 chip
  // 按鈕等結構差異很大的內容,不限定型別。
  trailing?: ReactNode
  // active:目前選取的項目(原 base-ui.css 的 .row.active),見
  // ListRow.module.css .row.active 的說明。
  active?: boolean
  className?: string
}

// forwardRef——比照 Button.tsx/ScrollArea.tsx 既有慣例保留轉發能力,
// 目前沒有呼叫端需要,但沒有理由讓這個共用元件成為擋住未來需求的瓶頸。
// ref 型別用 HTMLElement(div/li 的共同基底),而非固定其中一種。
export const ListRow = forwardRef<HTMLElement, ListRowProps>(function ListRow(
  { as = 'div', icon, title, titleColor, subtitle, trailing, active, className, ...rest },
  ref,
) {
  const classes = [styles.row]
  if (active) classes.push(styles.active)
  if (className) classes.push(className)
  const Tag = as as ElementType
  return (
    <Tag ref={ref} className={classes.join(' ')} {...rest}>
      {icon}
      <div className={styles.grow}>
        <div className={styles.name} style={titleColor ? { color: titleColor } : undefined}>
          {title}
        </div>
        {subtitle != null && <div className={styles.sub}>{subtitle}</div>}
      </div>
      {trailing}
    </Tag>
  )
})

// List:.row 的外層卡片容器(原 base-ui.css 的 .list)——獨立成另一個
// 元件而非 ListRow 內建的 wrapper prop,因為只有 TripManageModal.tsx
// 的成員清單需要它(SettingsScreen/SettingsDialog/DesktopUserMenu 的
// .row 都是單獨 1~2 列,不是清單,套上 .list 的卡片背景/圓角/陰影只會
// 多一層不必要的視覺框)。原本 DOM 是 <ul className="list">,這裡沿用
// ul 語意(呼叫端渲染的是「成員清單」,搭配底下 <ListRow as="li">)。
export interface ListProps extends HTMLAttributes<HTMLUListElement> {
  children: ReactNode
  className?: string
}

export const List = forwardRef<HTMLUListElement, ListProps>(function List(
  { children, className, ...rest },
  ref,
) {
  return (
    <ul ref={ref} className={className ? `${styles.list} ${className}` : styles.list} {...rest}>
      {children}
    </ul>
  )
})
