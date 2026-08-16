import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import type { AssistLang } from '../assistLang'
import styles from './LangSelect.module.css'

// LLM 回答語言下拉選單:自訂觸發列 + 選項清單,取代原生 <select>,樣式與互動
// 比照 iOS 風格(觸發列排版沿用 .field input,選項清單沿用 .desktop-user-popover
// 的浮層視覺——卡片背景、圓角、陰影)。SettingsDialog(桌面版)/
// SettingsScreen(手機版)共用同一份實作,只各自傳入目前值與 onChange;
// 兩處容器寬度不同但元件本身以 width: 100% 撐滿父層 .field,不需要為此
// 分開兩份程式碼。點擊外部關閉的實作模式沿用 DesktopUserMenu:useRef 抓
// 容器 + mousedown 監聽判斷點擊處是否在容器內。
const ASSIST_LANG_OPTIONS: { value: AssistLang; label: string }[] = [
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: '英文' },
]

export function LangSelect({
  value,
  onChange,
}: {
  value: AssistLang
  onChange: (v: AssistLang) => void
}) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const current = ASSIST_LANG_OPTIONS.find((o) => o.value === value)

  return (
    <div className={styles.select} ref={boxRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{current?.label ?? value}</span>
        <ChevronDown size={16} strokeWidth={1.8} color="var(--ios-gray)" />
      </button>
      {open && (
        <div className={styles.popover}>
          {ASSIST_LANG_OPTIONS.map((o) => (
            <button
              type="button"
              key={o.value}
              className={styles.option}
              onClick={() => { onChange(o.value); setOpen(false) }}
            >
              <span>{o.label}</span>
              {o.value === value && <Check size={16} strokeWidth={2} color="var(--ios-blue)" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
