// PlanOverlayLayout——/ai-plan 的「地圖加疊加 UI」外殼元件,對應登入後的 PlanOverlayLayout。
// 負責容器底下的 map-layer、controls-slot 與疊加面板(overlay > panel);容器本身與 nav 在 PlanLayout。
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { PlanOverlayLayout } from './PlanOverlayLayout'
import { describeSlotTree } from '../../plan-core/overlayDom'

const noopRef = () => {}

function renderLayout(props: Partial<React.ComponentProps<typeof PlanOverlayLayout>> = {}) {
  return render(
    <PlanOverlayLayout mapBackground={<div data-testid="map" />} isDesktop={false} safeAreaRef={noopRef} {...props}>
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

describe('PlanOverlayLayout 桌面與 wide', () => {
  it('桌面(非 wide):沒有 controls-slot 與 overlay,面板與輸入列插槽是同層手足(維持原結構)', () => {
    const { container } = renderLayout({ isDesktop: true })
    expect(describeSlotTree(container)).toBe('map-layer,panel,composer-slot')
  })

  it('wide:沒有 controls-slot,仍有 map-layer,內容照常渲染', () => {
    const { container, getByTestId } = renderLayout({ wide: true, isDesktop: true })
    expect(container.querySelector('[data-slot="controls-slot"]')).toBeNull()
    expect(container.querySelector('[data-slot="map-layer"]')).not.toBeNull()
    expect(getByTestId('content')).toBeTruthy()
  })

  it('wide:有帶 data-slot="safe-area" 的節點,safeAreaRef 接在它身上(與其他入口同一種標示);非 wide 沒有', () => {
    const ref = vi.fn()
    const wide = renderLayout({ wide: true, isDesktop: true, safeAreaRef: ref })
    const el = wide.container.querySelector('[data-slot="safe-area"]')!
    expect(el).not.toBeNull()
    expect(ref).toHaveBeenCalledWith(el)
    expect(el.getAttribute('aria-hidden')).toBe('true')
    const desktop = renderLayout({ isDesktop: true })
    expect(desktop.container.querySelector('[data-slot="safe-area"]')).toBeNull()
  })
})
