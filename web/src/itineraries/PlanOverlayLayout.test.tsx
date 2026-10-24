// PlanOverlayLayout(itineraries)——行程詳情頁的地圖加疊加 UI 外殼,與其他入口同一套 data-slot 骨架。
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { PlanOverlayLayout } from './PlanOverlayLayout'
import { describeSlotTree } from '../planning/shared/overlayDom'

function renderLayout(safeAreaRef: React.Ref<HTMLDivElement> = () => {}) {
  return render(
    <PlanOverlayLayout mapBackground={<div data-testid="map" />} safeAreaRef={safeAreaRef}>
      <div data-testid="content" />
    </PlanOverlayLayout>,
  )
}

describe('itineraries PlanOverlayLayout', () => {
  it('骨架:map-layer、overlay > (safe-area、panel > composer-slot),沒有 controls-slot', () => {
    const { container } = renderLayout()
    expect(describeSlotTree(container)).toBe('map-layer,overlay(safe-area,panel(composer-slot))')
  })

  it('地圖放進 map-layer、內容放進 panel', () => {
    const { getByTestId } = renderLayout()
    expect(getByTestId('map').closest('[data-slot="map-layer"]')).not.toBeNull()
    expect(getByTestId('content').closest('[data-slot="panel"]')).not.toBeNull()
  })

  it('safeAreaRef 接在 safe-area 節點上', () => {
    const ref = vi.fn()
    const { container } = renderLayout(ref)
    expect(ref).toHaveBeenCalledWith(container.querySelector('[data-slot="safe-area"]'))
  })
})

describe('itineraries PlanOverlayLayout passThrough', () => {
  it('passThrough 只在指定時才讓 overlay 加上 class', () => {
    const a = render(<PlanOverlayLayout safeAreaRef={() => {}}><div /></PlanOverlayLayout>)
    expect(a.container.querySelector('[data-slot="overlay"]')!.className).not.toMatch(/passThrough/)
    a.unmount()
    const b = render(<PlanOverlayLayout safeAreaRef={() => {}} passThrough><div /></PlanOverlayLayout>)
    expect(b.container.querySelector('[data-slot="overlay"]')!.className).toMatch(/passThrough/)
  })
})
