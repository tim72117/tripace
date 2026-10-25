import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import styles from './AskPage.module.css'
import { AskOptionList } from './AskOptionList'

describe('AskOptionList', () => {
  it('預設為 directionScroller 並渲染 children', () => {
    const { container } = render(<AskOptionList><i data-testid="c" /></AskOptionList>)
    const el = container.firstElementChild as HTMLElement
    expect(Array.from(el.classList)).toEqual([styles.directionScroller])
    expect(el.querySelector('[data-testid="c"]')).not.toBeNull()
  })
  it('stacked 加上變體 class', () => {
    const { container } = render(<AskOptionList stacked><i /></AskOptionList>)
    expect(Array.from((container.firstElementChild as HTMLElement).classList)).toEqual([styles.directionScroller, styles.directionScrollerStacked])
  })
  it('transport variant 使用 transportRow', () => {
    const { container } = render(<AskOptionList variant="transport" stacked><i /></AskOptionList>)
    expect(Array.from((container.firstElementChild as HTMLElement).classList)).toEqual([styles.transportRow, styles.transportRowStacked])
  })
})
