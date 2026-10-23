// PlanOverlayLayout(/ai-plan wide 側欄版面,wide/)——≥1024px:map-layer、安全區節點、側欄面板與 composer 帶。
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { PlanOverlayLayout } from './PlanOverlayLayout'

function renderLayout(props: Partial<React.ComponentProps<typeof PlanOverlayLayout>> = {}) {
  return render(
    <PlanOverlayLayout mapBackground={<div data-testid="map" />} safeAreaRef={() => {}} {...props}>
      <div data-testid="content" />
    </PlanOverlayLayout>,
  )
}

describe('PlanOverlayLayout wide 側欄版面', () => {
  it('沒有 controls-slot,仍有 map-layer,內容照常渲染', () => {
    const { container, getByTestId } = renderLayout()
    expect(container.querySelector('[data-slot="controls-slot"]')).toBeNull()
    expect(container.querySelector('[data-slot="map-layer"]')).not.toBeNull()
    expect(getByTestId('map').closest('[data-slot="map-layer"]')).not.toBeNull()
    expect(getByTestId('content')).toBeTruthy()
  })

  it('有帶 data-slot="safe-area" 的節點,safeAreaRef 接在它身上(與其他入口同一種標示)', () => {
    const ref = vi.fn()
    const { container } = renderLayout({ safeAreaRef: ref })
    const el = container.querySelector('[data-slot="safe-area"]')!
    expect(el).not.toBeNull()
    expect(ref).toHaveBeenCalledWith(el)
    expect(el.getAttribute('aria-hidden')).toBe('true')
  })

  it('composer prop 放進插槽,不在面板裡', () => {
    const { container } = renderLayout({ composer: <span data-testid="c" /> })
    const slot = container.querySelector('[class*="composerSlot"]')!
    expect(slot.querySelector('[data-testid="c"]')).not.toBeNull()
  })
})
