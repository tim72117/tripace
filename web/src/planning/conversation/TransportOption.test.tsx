import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import styles from './AskPage.module.css'
import userEvent from '@testing-library/user-event'
import { TransportOption, TRANSPORT_META } from './TransportOption'
import { ALL_TRANSPORT_MODES } from './asktools'

describe('TransportOption', () => {
  it('每種模式顯示對應標籤與圖示', () => {
    const labels = { walk: '步行', scooter: '機車', car: '開車', transit: '大眾運輸', bike: '腳踏車' }
    for (const mode of ALL_TRANSPORT_MODES) {
      const { unmount } = render(<TransportOption mode={mode} onSelect={() => {}} />)
      const btn = screen.getByRole('button', { name: labels[mode] })
      expect(btn.getAttribute('type')).toBe('button')
      expect(Array.from(btn.classList)).toEqual([styles.transportCard])
      expect(btn.querySelector('svg')).not.toBeNull()
      expect(Array.from(btn.querySelector('span')!.classList)).toEqual([styles.transportLabel])
      expect(TRANSPORT_META[mode].label).toBe(labels[mode])
      unmount()
    }
  })
  it('各模式圖示不同(機車/腳踏車同為 Bike 除外)', () => {
    const cls = (m: 'walk' | 'car' | 'transit') => {
      const { container, unmount } = render(<TransportOption mode={m} onSelect={() => {}} />)
      const c = container.querySelector('svg')!.getAttribute('class')
      unmount()
      return c
    }
    expect(new Set([cls('walk'), cls('car'), cls('transit')]).size).toBe(3)
  })
  it('stacked 變體', () => {
    render(<TransportOption mode="car" stacked onSelect={() => {}} />)
    expect(Array.from(screen.getByRole('button').classList)).toEqual([styles.transportCard, styles.transportCardStacked])
  })
  it('點擊與鍵盤觸發 onSelect', async () => {
    const fn = vi.fn()
    render(<TransportOption mode="walk" onSelect={fn} />)
    fireEvent.click(screen.getByRole('button'))
    const user = userEvent.setup()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
