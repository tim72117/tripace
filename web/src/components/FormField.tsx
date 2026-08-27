import type { ReactNode } from 'react'
import styles from './FormField.module.css'

// FormField:「一個設定項/輸入框外面該包一層 padding+底線分隔的卡片式
// 容器,裡面若有標籤文字要用哪種字級/顏色」這組 DOM 結構+樣式的唯一共用
// 實作——重構前,base-ui.css 的全域字串 class .field 被 12+ 處呼叫端用
// className="field" 重複引用,固定寫法都是「一個 div.field 包一個可選的
// <label> 加上真正的輸入內容」,型別系統完全無法檢查有沒有漏包某一層。
//
// API 設計:children 插槽讓呼叫端自己放 input/select/自訂元件,不是這個
// 元件直接內建 input props——實際盤點下來的呼叫端有兩種完全不同的插槽
// 內容,不是單純「一個 input」能涵蓋:
//   1. 直接放原生 <input>(LoginForm.tsx/DeviceAuthPage.tsx/
//      TripManageModal.tsx 的 email 邀請框,大多不帶 label,只是輸入框
//      外面套一層卡片背景+底線)。
//   2. 放自訂元件(SettingsScreen.tsx/SettingsDialog.tsx 的 LangSelect/
//      ThemeToggle——這兩個是按鈕組成的自訂下拉/切換器,不是原生
//      input/select),此時只吃得到 .field 對 <label> 的樣式,對
//      input/select 的樣式規則不會命中(本來就不該命中)。
// 若把 API 設計成「內建 input props、元件自己渲染 <input>」,上述第 2 類
// 呼叫端就完全套不上,還是得繞回自己包一層 div——不如讓 children 保持
// 開放,呼叫端要放什麼就放什麼,這個元件只負責外層容器與可選的 label。
//
// label 開放為 ReactNode 而非純字串——SettingsDialog.tsx 的「Base URL」
// 欄位標籤含一段括號附註,雖然目前都是純文字,但用 ReactNode 保留彈性,
// 不需要為了某個呼叫端未來想在標籤裡塞一個 icon 又要回頭改介面。
export interface FormFieldProps {
  // label:可選——大多數呼叫端(LoginForm/DeviceAuthPage/邀請成員輸入框)
  // 沒有可見標籤文字,只需要卡片式外框,不傳這個 prop 即可(對齊原本
  // 這些呼叫端的 <div className="field"><input .../></div>,沒有
  // <label> 子元素)。
  label?: ReactNode
  children: ReactNode
  // className:疊加呼叫端自己的樣式,理由同 ScrollArea.tsx——目前沒有
  // 呼叫端需要,保留逃生口。
  className?: string
}

export function FormField({ label, children, className }: FormFieldProps) {
  return (
    <div className={className ? `${styles.field} ${className}` : styles.field}>
      {label !== undefined && <label>{label}</label>}
      {children}
    </div>
  )
}
