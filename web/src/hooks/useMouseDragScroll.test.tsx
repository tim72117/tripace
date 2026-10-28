import { describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { useMouseDragScroll } from './useMouseDragScroll'

function Row({ enabled = true, onItemClick }: { enabled?: boolean; onItemClick?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useMouseDragScroll(ref, enabled)
  return (
    <div ref={ref} data-testid="row">
      <button type="button" onClick={onItemClick}>卡片</button>
    </div>
  )
}

const pointer = (target: Element | Window, type: string, x: number, pointerType = 'mouse') => {
  const ev = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 0, button: 0 })
  Object.defineProperty(ev, 'pointerId', { value: 1 })
  Object.defineProperty(ev, 'pointerType', { value: pointerType })
  fireEvent(target, ev)
}

describe('useMouseDragScroll', () => {
  it('滑鼠水平拖曳:跟著捲動、暫停 snap,放手後吞掉補發的 click', () => {
    let clicks = 0
    const { getByTestId, getByText } = render(<Row onItemClick={() => clicks++} />)
    const row = getByTestId('row')
    row.scrollLeft = 100
    pointer(row, 'pointerdown', 200)
    pointer(window, 'pointermove', 150)
    expect(row.scrollLeft).toBe(150)
    expect(row.style.scrollSnapType).toBe('none')
    pointer(window, 'pointerup', 150)
    fireEvent.click(getByText('卡片'))
    expect(clicks).toBe(0)
  })

  it('單純點擊(沒超過門檻)不受影響', () => {
    let clicks = 0
    const { getByTestId, getByText } = render(<Row onItemClick={() => clicks++} />)
    const row = getByTestId('row')
    pointer(row, 'pointerdown', 200)
    pointer(window, 'pointermove', 198)
    pointer(window, 'pointerup', 198)
    fireEvent.click(getByText('卡片'))
    expect(clicks).toBe(1)
  })

  it('觸控與 enabled=false 都不處理', () => {
    const { getByTestId, rerender } = render(<Row />)
    const row = getByTestId('row')
    row.scrollLeft = 100
    pointer(row, 'pointerdown', 200, 'touch')
    pointer(window, 'pointermove', 100, 'touch')
    expect(row.scrollLeft).toBe(100)
    rerender(<Row enabled={false} />)
    pointer(row, 'pointerdown', 200)
    pointer(window, 'pointermove', 100)
    expect(row.scrollLeft).toBe(100)
  })
})
