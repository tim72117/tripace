import type { Theme } from '../theme'
import styles from './ThemeToggle.module.css'

// 登入後 App 的深色/淺色模式切換——三段式分段按鈕(跟隨系統／日間／夜間),
// 不是像 home/HomePage.tsx/LegalPage.tsx 那樣的二態循環切換鈕(那套只有
// 「目前是深色還是淺色」兩種狀態,没有「跟隨系統」這個選項可以明確選回)。
// props 介面比照 LangSelect.tsx 的 value/onChange 模式;樣式比照
// LangSelect.module.css 的 token 用法(var(--ios-card)/var(--ios-sep)/
// var(--color-dark)),選中項用 var(--color-accent) 底色。
//
// 不需要 matchMedia/systemPrefersDark JS 邏輯——「跟隨系統」就是
// theme === null(不掛 data-theme 屬性),交給 base-ui.css 的
// prefers-color-scheme media query 處理,這裡只負責顯示/切換使用者的
// 選擇,不需要知道系統目前實際是深是淺。
const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: null, label: '跟隨系統' },
  { value: 'light', label: '日間模式' },
  { value: 'dark', label: '夜間模式' },
]

export function ThemeToggle({
  value,
  onChange,
}: {
  value: Theme
  onChange: (v: Theme) => void
}) {
  return (
    <div className={styles.segmented} role="group" aria-label="外觀模式">
      {THEME_OPTIONS.map((o) => (
        <button
          type="button"
          key={o.label}
          className={o.value === value ? `${styles.option} ${styles.optionActive}` : styles.option}
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
