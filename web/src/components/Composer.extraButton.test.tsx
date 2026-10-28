import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Composer } from './Composer'

describe('Composer extraButton', () => {
  it('顯示在送出鈕旁,點擊呼叫 onClick 且不觸發送出', () => {
    const onClick = vi.fn()
    const onSubmit = vi.fn()
    render(<Composer value="" onSubmit={onSubmit} extraButton={{ label: '選擇景點', icon: <span>i</span>, onClick }} />)
    fireEvent.click(screen.getByRole('button', { name: '選擇景點' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '送出' })).toBeTruthy()
  })

  it('disabled 時不可點;沒傳 extraButton 就不渲染', () => {
    const onClick = vi.fn()
    const { rerender } = render(<Composer value="" extraButton={{ label: '選擇景點', icon: null, onClick, disabled: true }} />)
    expect((screen.getByRole('button', { name: '選擇景點' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<Composer value="" />)
    expect(screen.queryByRole('button', { name: '選擇景點' })).toBeNull()
  })

  it('statusIcon:active 狀態以 data-active 表達;沒傳就不渲染', () => {
    const { container, rerender } = render(<Composer value="" statusIcon={{ active: false }} />)
    const icon = () => container.querySelector('[data-active]')
    expect(icon()?.getAttribute('data-active')).toBe('false')
    expect(icon()?.getAttribute('aria-hidden')).toBe('true')
    rerender(<Composer value="" statusIcon={{ active: true }} />)
    expect(icon()?.getAttribute('data-active')).toBe('true')
    rerender(<Composer value="" />)
    expect(icon()).toBeNull()
  })

  it('extraButton 可傳陣列:依序渲染、各自獨立點擊', () => {
    const a = vi.fn()
    const b = vi.fn()
    render(
      <Composer
        value=""
        extraButton={[
          { label: '新行程', icon: <span>+</span>, onClick: a },
          { label: '選擇景點', icon: <span>p</span>, onClick: b },
        ]}
      />,
    )
    const names = screen.getAllByRole('button').map((x) => x.getAttribute('aria-label'))
    expect(names).toEqual(['新行程', '選擇景點', '送出'])
    fireEvent.click(screen.getByRole('button', { name: '新行程' }))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
  })
})
