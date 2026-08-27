import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import styles from './IconButton.module.css'

// IconButton:「小巧的圖示型按鈕該長什麼樣子/disabled 時該怎麼變灰/
// focus-visible 該套哪個顏色的外框」這組視覺+狀態規則的唯一共用實作——
// 重構前,base-ui.css 的全域字串 class .btn/.icon-btn 被 SettingsDialog.tsx/
// TripManageModal.tsx/Timeline.tsx 三處呼叫端(關閉鈕)用
// className="btn icon-btn" 這種型別系統完全無法檢查的字串引用,跟已經
// 遷移完成的 components/Button.tsx(.btn-primary/.btn-secondary/
// .btn-danger,滿版行動按鈕)是完全不同的兩組東西——不要混淆或誤改
// Button.tsx。
//
// 命名刻意叫 IconButton 而非沿用 .btn 這個過於籠統的舊名——這個元件從頭
// 到尾只服務「小巧的圖示按鈕」這一種用途(grep 全部呼叫端確認過,沒有
// 任何一處只用 .btn 而不疊加 .icon-btn,見 IconButton.module.css 開頭
// 的說明),取新名字避免跟 Button.tsx 的 Button 元件混淆。
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  // active:選中狀態(原 base-ui.css 的 .icon-btn.active),例如主顯示區
  // 上方列的時間軸/路徑切換圖示。
  active?: boolean
  // square:40x40px 固定方形框(原 base-ui.css 的巢狀選擇器
  // `.navbar .icon-btn`,.navbar 本身已遷移成 components/Navbar.tsx)——
  // 見 IconButton.module.css .square 的完整說明,用具名 prop 取代父層
  // 選擇器覆寫,不依賴呼叫端把這個元件放進特定 class 名稱的父層容器。
  square?: boolean
  className?: string
}

// forwardRef——比照 Button.tsx/ScrollArea.tsx 的既有慣例保留轉發能力,
// 目前沒有呼叫端需要,但沒有理由讓這個共用元件成為擋住未來需求的瓶頸。
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { active, square, className, type = 'button', ...rest },
  ref,
) {
  const classes = [styles.iconButton]
  if (active) classes.push(styles.active)
  if (square) classes.push(styles.square)
  if (className) classes.push(className)
  return <button ref={ref} type={type} className={classes.join(' ')} {...rest} />
})
