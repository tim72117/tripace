import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeChildChips } from './ThemeChildChips'

const items = [
  { id: 'a', name: '赤崁樓', thumbIcon: '🏯' },
  { id: 'b' }, // 解析未完成:只有 id
]

describe('ThemeChildChips', () => {
  it('沒有項目時什麼都不畫', () => {
    const { container } = render(<ThemeChildChips items={[]} ariaLabel="x" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('每個項目一顆 chip:顯示名稱與 icon,沒有名稱退回 id;列表帶 aria-label', () => {
    render(<ThemeChildChips items={items} ariaLabel="赤崁一帶包含的景點" />)
    expect(screen.getByRole('list', { name: '赤崁一帶包含的景點' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((e) => e.textContent)).toEqual(['🏯赤崁樓', 'b'])
    expect(screen.getByText('🏯')).toHaveAttribute('aria-hidden', 'true')
  })

  it('點擊回報被點的項目(原樣物件),且不冒泡到外層', () => {
    const onSelect = vi.fn()
    const onOuterClick = vi.fn()
    render(
      <div onClick={onOuterClick}>
        <ThemeChildChips items={items} ariaLabel="x" onSelect={onSelect} />
      </div>,
    )
    fireEvent.click(screen.getByText('赤崁樓'))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(items[0])
    expect(onOuterClick).not.toHaveBeenCalled()
  })

  it('沒傳 onSelect 時點擊不報錯、仍不冒泡', () => {
    const onOuterClick = vi.fn()
    render(
      <div onClick={onOuterClick}>
        <ThemeChildChips items={items} ariaLabel="x" />
      </div>,
    )
    fireEvent.click(screen.getByText('b'))
    expect(onOuterClick).not.toHaveBeenCalled()
  })

  it('className 加在外層容器上', () => {
    render(<ThemeChildChips items={items} ariaLabel="x" className="gap-x" />)
    expect(screen.getByRole('list')).toHaveClass('gap-x')
  })
})
