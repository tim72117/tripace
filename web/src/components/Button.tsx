import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

// Button:「行動按鈕該長什麼樣子/disabled 時該怎麼變灰/focus-visible 該
// 套哪個顏色的外框」這組視覺+狀態規則的唯一共用實作——重構前,base-ui.css
// 的全域字串 class .btn-primary/.btn-secondary/.btn-danger 被 15+ 處呼叫端
// 用 className="btn-primary" 這種型別系統完全無法檢查的字串引用,任何一處
// 忘記帶某個修飾字(例如漏打 disabled、或以為還要自己補 opacity 邏輯)都
// 不會被 tsc/lint 抓到,只能等使用者實際點到才發現。收斂成這個元件後,
// variant 之間的差異(primary 撐滿版面/danger 置中三顆內容並排/
// secondary.success 這種一次性反饋狀態)全部收在 Button.module.css 一份
// 實作裡,呼叫端只需要選對 variant,不用自己記得每種按鈕的細節。
//
// 單一元件 + variant prop,不拆成 PrimaryButton/SecondaryButton/
// DangerButton 三個元件——比照 components/PhoneBottomSheet.tsx 的
// SheetHead 用單一元件+具名 prop 組合表達「同一類事物的不同外觀」的既有
// 慣例(而非拆成多個各自獨立的元件),三個 variant 本來就是「同一個行動
// 按鈕家族」(base-ui.css 原本的註解就是這樣描述它們的),用 prop 切換比
// 三個幾乎一樣、只是 class 名稱不同的元件更能表達這層關係,呼叫端也不用
// 為了換一種按鈕外觀而改 import 語句。
export type ButtonVariant = 'primary' | 'secondary' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: ButtonVariant
  // success:目前僅 secondary 用到(TokenDisplay.tsx「複製 Token」按鈕
  // 複製成功後短暫變綠字,對應原本 base-ui.css 的 .btn-secondary.success
  // 修飾類)——不開放給 primary/danger,因為 base-ui.css 從未定義過
  // .btn-primary.success/.btn-danger.success,沒有現成視覺規格可套用,
  // 硬是開放這個 prop 給其他 variant 只會讓型別允許一個實際上沒有樣式
  // 效果的組合。
  success?: boolean
  // compact:取代原本 base-ui.css 的 `.new-trip-composer .btn-primary`
  // 父層選擇器覆寫(見 Button.module.css .primary.compact 的說明)——
  // 目前僅 primary 用到(DesktopTripList.tsx/PhoneTripsDrawer.tsx 的
  // 「新增旅程」輸入列按鈕),同理不開放給其他 variant(base-ui.css 沒有
  // 定義過 secondary/danger 的緊湊版本)。
  compact?: boolean
  // className:疊加呼叫端自己的樣式(比照 ScrollArea.tsx 的疊加慣例)——
  // 目前沒有呼叫端需要,但保留這個逃生口避免往後每次有新的一次性覆寫
  // 需求就要回頭改這個共用元件本身。
  className?: string
}

// forwardRef——目前沒有呼叫端需要抓 DOM ref,但比照 ScrollArea.tsx 的
// 慣例保留轉發能力(button 常見的 ref 用途:programmatic focus、量測尺寸),
// 沒有理由讓這個共用元件成為擋住未來需求的瓶頸。
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, success, compact, className, type = 'button', ...rest },
  ref,
) {
  const variantClass = styles[variant]
  const classes = [variantClass]
  if (success) classes.push(styles.success)
  if (compact) classes.push(styles.compact)
  if (className) classes.push(className)
  return <button ref={ref} type={type} className={classes.join(' ')} {...rest} />
})
