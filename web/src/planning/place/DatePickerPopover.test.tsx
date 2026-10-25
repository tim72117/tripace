// DatePickerPopover 的補位日期:fixedWeeks 讓每個月一律畫 6 週(切換月份時外框
// 高度不跳),showOutsideDays 讓補位格顯示前後月份的日期——這些補位日期只是
// 站位,不能點,否則在 4~5 週的月份一次點選就可能選到下個月(或上個月)。
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { DatePickerPopover } from './DatePickerPopover'

describe('DatePickerPopover 補位日期', () => {
  it('仍固定畫 6 週;前後月份的補位日期按鈕 disabled,點了不回報', () => {
    const onSelect = vi.fn()
    // 2026-10 只跨 5 週,第 6 週整列都是 11 月補位。
    const { container } = render(<DatePickerPopover value="2026-10-15" onSelect={onSelect} />)
    expect(container.querySelectorAll('.rdp-week').length).toBe(6)

    const outsideCells = container.querySelectorAll('td[data-outside]')
    expect(outsideCells.length).toBeGreaterThan(0)
    outsideCells.forEach((cell) => {
      const btn = cell.querySelector('button')
      expect(btn).not.toBeNull()
      expect((btn as HTMLButtonElement).disabled).toBe(true)
    })

    const nov1 = container.querySelector('td[data-day="2026-11-01"] button') as HTMLButtonElement
    fireEvent.click(nov1)
    expect(onSelect).not.toHaveBeenCalled()

    const oct20 = container.querySelector('td[data-day="2026-10-20"] button') as HTMLButtonElement
    expect(oct20.disabled).toBe(false)
    fireEvent.click(oct20)
    expect(onSelect).toHaveBeenCalledWith('2026-10-20')
  })

  it('換月後,新月份的日期可點、舊月份變成補位不可點', () => {
    const onSelect = vi.fn()
    const { container, getByRole } = render(<DatePickerPopover value="2026-10-15" onSelect={onSelect} />)
    fireEvent.click(getByRole('button', { name: /下個月|next/i }))
    const nov1 = container.querySelector('td[data-day="2026-11-01"]:not([data-outside]) button') as HTMLButtonElement
    expect(nov1.disabled).toBe(false)
    const oct31 = container.querySelector('td[data-day="2026-10-31"] button') as HTMLButtonElement | null
    if (oct31) expect(oct31.disabled).toBe(true)
  })
})
