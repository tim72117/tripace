import { useRef, type ReactNode } from 'react'
import { useMouseDragScroll } from '../../hooks/useMouseDragScroll'
import styles from './AskPage.module.css'

// AskOptionList——ask 面板選項容器。direction(預設)= 國家/城市面板的
// .directionScroller;transport = 交通方式面板的 .transportRow。
export function AskOptionList({
  stacked,
  variant = 'direction',
  children,
}: {
  stacked?: boolean
  variant?: 'direction' | 'transport'
  children: ReactNode
}) {
  const cls =
    variant === 'transport'
      ? [styles.transportRow, stacked ? styles.transportRowStacked : '']
      : [styles.directionScroller, stacked ? styles.directionScrollerStacked : '']
  // 橫向捲動的選項列(direction、非 stacked)也讓滑鼠能左右拖曳。
  const ref = useRef<HTMLDivElement>(null)
  useMouseDragScroll(ref, variant === 'direction' && !stacked)
  return (
    <div ref={ref} className={cls.filter(Boolean).join(' ')}>
      {children}
    </div>
  )
}
