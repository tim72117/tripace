// SimComposer——模擬層的輸入列:展示用假輸入膠囊,排完後變「讓我試看看」按鈕,交接後恢復成真的輸入框。
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { SimComposer, type SimComposerProps } from './SimComposer'

function setup(over: Partial<SimComposerProps> = {}) {
  const props: SimComposerProps = {
    composerCollapsed: false,
    handedOver: false,
    typedPrompt: '台南兩日遊',
    userPrompt: '使用者輸入',
    setUserPrompt: vi.fn(),
    handover: vi.fn(),
    ...over,
  }
  return { ...render(<SimComposer {...props} />), props }
}

describe('SimComposer', () => {
  it('模擬中:輸入框唯讀,顯示打字動畫的文字,不接受輸入也不送出', () => {
    const { getByLabelText, props } = setup()
    const input = getByLabelText('輸入指令(僅供展示)') as HTMLInputElement
    expect(input.value).toBe('台南兩日遊')
    expect(input.readOnly).toBe(true)
    fireEvent.click(document.querySelector('button[aria-label="送出"]')!)
    expect(props.handover).not.toHaveBeenCalled()
  })

  it('排完行程(composerCollapsed):輸入框移除,只剩「讓我試看看」按鈕,點了交接', () => {
    const { queryByLabelText, getByLabelText, props } = setup({ composerCollapsed: true })
    expect(queryByLabelText('輸入指令(僅供展示)')).toBeNull()
    fireEvent.click(getByLabelText('讓我試看看'))
    expect(props.handover).toHaveBeenCalledTimes(1)
  })

  it('交接後(handedOver):輸入框是真的,顯示並回報使用者輸入', () => {
    const { getByLabelText, props } = setup({ handedOver: true })
    const input = getByLabelText('描述你想要的行程') as HTMLInputElement
    expect(input.value).toBe('使用者輸入')
    expect(input.readOnly).toBe(false)
    fireEvent.change(input, { target: { value: '台北' } })
    expect(props.setUserPrompt).toHaveBeenCalledWith('台北')
  })
})
