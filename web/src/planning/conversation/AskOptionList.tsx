import type { ReactNode } from 'react'
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
  return <div className={cls.filter(Boolean).join(' ')}>{children}</div>
}
