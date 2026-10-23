// PlanOverlayPanel(/ai-plan wide,wide/)——面板加輸入列插槽同層手足,不帶 data-slot 標記。
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PlanOverlayPanel } from './PlanOverlayPanel'

describe('PlanOverlayPanel wide', () => {
  it('面板 + 插槽同層手足、不帶 data-slot 標記,composer prop 渲染在插槽裡', () => {
    const { container } = render(
      <PlanOverlayPanel composer={<span data-testid="c" />}>
        <div />
      </PlanOverlayPanel>,
    )
    expect(container.children).toHaveLength(2)
    const [panel, slot] = Array.from(container.children)
    expect(panel.className).toMatch(/panel/)
    expect(slot.className).toMatch(/composerSlot/)
    expect(panel.hasAttribute('data-slot')).toBe(false)
    expect(slot.querySelector('[data-testid="c"]')).not.toBeNull()
  })
})
