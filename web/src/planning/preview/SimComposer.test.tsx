// SimComposer——模擬層的輸入列:展示用假輸入膠囊,排完後變「讓我試看看」按鈕。只在模擬態渲染(交接後的輸入框由 TripPlanPage 提供)。
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { SimComposer, type SimComposerProps } from './SimComposer'

function setup(over: Partial<SimComposerProps> = {}) {
  const props: SimComposerProps = {
    composerCollapsed: false,
    typedPrompt: '台南兩日遊',
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

})
