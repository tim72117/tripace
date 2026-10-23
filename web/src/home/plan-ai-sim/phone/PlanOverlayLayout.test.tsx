// PlanOverlayLayout(/ai-plan 手機版,phone/)——「地圖加疊加 UI」外殼元件,對應登入後的 PlanOverlayLayout。
// 負責容器底下的 map-layer、controls-slot 與疊加面板(overlay > panel);容器本身與 nav 在 PlanLayout。
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { PlanOverlayLayout } from './PlanOverlayLayout'
import { describeSlotTree } from '../../../plan-core/overlayDom'

const noopRef = () => {}

function renderLayout(props: Partial<React.ComponentProps<typeof PlanOverlayLayout>> = {}) {
  return render(
    <PlanOverlayLayout mapBackground={<div data-testid="map" />} safeAreaRef={noopRef} {...props}>
      <div data-testid="content" />
    </PlanOverlayLayout>,
  )
}

describe('PlanOverlayLayout 手機版', () => {
  it('長出共同骨架:map-layer、controls-slot、overlay > (safe-area、panel > composer-slot)', () => {
    const { container } = renderLayout()
    expect(describeSlotTree(container)).toBe('map-layer,controls-slot,overlay(safe-area,panel(composer-slot))')
  })

  it('地圖放進 map-layer、內容放進 panel', () => {
    const { getByTestId } = renderLayout()
    expect(getByTestId('map').closest('[data-slot="map-layer"]')).not.toBeNull()
    expect(getByTestId('content').closest('[data-slot="panel"]')).not.toBeNull()
  })

  it('composer prop 放進 composer-slot', () => {
    const { getByTestId } = renderLayout({ composer: <div data-testid="composer" /> })
    expect(getByTestId('composer').closest('[data-slot="composer-slot"]')).not.toBeNull()
  })

  it('controls-slot 把元素交給 onControlsSlotChange(同登入後的外殼),卸載時回報 null', () => {
    const onChange = vi.fn()
    const { unmount } = renderLayout({ onControlsSlotChange: onChange })
    expect(onChange).toHaveBeenCalledWith(expect.any(HTMLDivElement))
    unmount()
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('沒有 mapBackground:不渲染 map-layer', () => {
    const { container } = renderLayout({ mapBackground: undefined })
    expect(describeSlotTree(container)).toBe('controls-slot,overlay(safe-area,panel(composer-slot))')
  })
})
