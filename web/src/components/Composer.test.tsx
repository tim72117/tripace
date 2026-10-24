// Composer——推論中(busy)的「停止」鈕:有 onStop 時送出鈕換成停止、可點、不送出表單;沒有 onStop 時維持不能點。
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Composer } from './Composer'

describe('Composer busy/onStop', () => {
  it('一般狀態:送出鈕是「送出」,按下呼叫 onSubmit', () => {
    const onSubmit = vi.fn()
    render(<Composer value="hi" onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: '送出' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('busy 且有 onStop:輸入框鎖住,按鈕變「停止」,點了呼叫 onStop、不呼叫 onSubmit', () => {
    const onSubmit = vi.fn()
    const onStop = vi.fn()
    render(<Composer value="hi" busy onStop={onStop} onSubmit={onSubmit} />)
    expect(screen.getByRole('textbox')).toBeDisabled()
    const stop = screen.getByRole('button', { name: '停止' })
    expect(stop).toBeEnabled()
    expect(stop).toHaveAttribute('type', 'button')
    fireEvent.click(stop)
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('busy 但沒有 onStop:送出鈕不能點(維持舊行為)', () => {
    render(<Composer value="hi" busy />)
    expect(screen.getByRole('button', { name: '送出' })).toBeDisabled()
  })

  it('disabled 時即使 busy 且有 onStop 也不能點(整顆停用)', () => {
    render(<Composer value="hi" disabled busy onStop={() => {}} />)
    expect(screen.getByRole('button', { name: '送出' })).toBeDisabled()
  })
})
