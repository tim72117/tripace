import styles from './ThemeChildChips.module.css'

// ThemeChildChips——主題點(一張卡代表一小片範圍、底下有好幾個鄰近景點)的子景點 chip 列:
// 每個子景點一顆圓角小標籤(可選 icon 加名稱),自然換行,點擊回報被點的項目。
// 時間軸共用元件(桌面 PlanTimelineView 與手機 phone/ 都在 planning/timeline/):手機橫向時間軸、桌面時間軸的預設景點卡
// (行程詳情頁經由桌面預設卡也會用到)都用這一個,不認識規劃領域的型別(只要求項目有 id,名稱與 icon 選填),也不碰資料解析——呼叫端把已解析好的項目傳進來。
//
// 名稱缺少時退回顯示 id(解析還沒完成時的最小項目只有 id)。沒有項目時什麼都不畫。
// 點擊不冒泡:chip 位在整張卡片的點擊範圍內,冒泡會變成「選中主題卡本身」而不是這個子景點。
// onSelect 沒傳時 chip 仍會顯示,只是點了沒有反應。
// className:放在外層容器,給呼叫端調整與上下內容的間距(元件本身不留外距)。
export interface ThemeChildChipItem {
  id: string
  name?: string
  thumbIcon?: string
}

export function ThemeChildChips<T extends ThemeChildChipItem>({
  items,
  ariaLabel,
  onSelect,
  className,
}: {
  items: readonly T[]
  ariaLabel: string
  onSelect?: (item: T) => void
  className?: string
}) {
  if (items.length === 0) return null
  return (
    <div className={[styles.chips, className].filter(Boolean).join(' ')} role="list" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="listitem"
          className={styles.chip}
          onClick={(e) => {
            e.stopPropagation()
            onSelect?.(item)
          }}
        >
          {item.thumbIcon && <span aria-hidden="true">{item.thumbIcon}</span>}
          <span>{item.name ?? item.id}</span>
        </button>
      ))}
    </div>
  )
}
