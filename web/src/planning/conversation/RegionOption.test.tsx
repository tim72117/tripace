import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import styles from './AskPage.module.css'
import userEvent from '@testing-library/user-event'
import { RegionOption } from './RegionOption'

describe('RegionOption', () => {
  it('button type=button、顯示名稱與 MapPin 圖示', () => {
    render(<RegionOption name="日本" onSelect={() => {}} />)
    const btn = screen.getByRole('button', { name: '日本' })
    expect(btn.getAttribute('type')).toBe('button')
    // 精確比對 classList(正規式 /regionCard/ 會誤中 regionCardStacked)
    expect(Array.from(btn.classList)).toEqual([styles.regionCard])
    const svg = btn.querySelector('svg')!
    expect(svg.classList.contains(styles.regionIcon)).toBe(true)
    expect(svg.classList.contains('lucide-map-pin')).toBe(true)
    expect(Array.from(btn.querySelector('span')!.classList)).toEqual([styles.regionName])
  })
  it('stacked 變體', () => {
    render(<RegionOption name="台北" stacked onSelect={() => {}} />)
    const btn = screen.getByRole('button')
    expect(Array.from(btn.classList)).toEqual([styles.regionCard, styles.regionCardStacked])
    expect(Array.from(btn.querySelector('span')!.classList)).toEqual([styles.regionName, styles.regionNameStacked])
  })
  it('點擊呼叫 onSelect', () => {
    const fn = vi.fn()
    render(<RegionOption name="日本" onSelect={fn} />)
    fireEvent.click(screen.getByRole('button'))
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('鍵盤 Enter/Space 可觸發', async () => {
    const fn = vi.fn()
    const user = userEvent.setup()
    render(<RegionOption name="日本" onSelect={fn} />)
    await user.tab()
    expect(screen.getByRole('button')).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
