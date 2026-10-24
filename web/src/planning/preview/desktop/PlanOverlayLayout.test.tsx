// PlanOverlayLayout(/ai-plan 桌面疊加版面,desktop/)——768–1023px:map-layer 加疊加面板,沒有 controls-slot、overlay、安全區。
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { PlanOverlayLayout } from './PlanOverlayLayout'
import { describeSlotTree } from '../../shared/overlayDom'

function renderLayout(props: Partial<React.ComponentProps<typeof PlanOverlayLayout>> = {}) {
  return render(
    <PlanOverlayLayout mapBackground={<div data-testid="map" />} safeAreaRef={() => {}} {...props}>
      <div data-testid="content" />
    </PlanOverlayLayout>,
  )
}

describe('PlanOverlayLayout 桌面疊加版面', () => {
  it('沒有 controls-slot 與 overlay,面板與輸入列插槽是同層手足', () => {
    const { container } = renderLayout()
    expect(describeSlotTree(container)).toBe('map-layer,panel,composer-slot')
  })

  it('地圖放進 map-layer、內容放進 panel;沒有 mapBackground 就不渲染 map-layer', () => {
    const { getByTestId, container } = renderLayout()
    expect(getByTestId('map').closest('[data-slot="map-layer"]')).not.toBeNull()
    expect(getByTestId('content').closest('[data-slot="panel"]')).not.toBeNull()
    expect(describeSlotTree(renderLayout({ mapBackground: undefined }).container)).toBe('panel,composer-slot')
    expect(container).toBeTruthy()
  })

  it('沒有安全區節點:safeAreaRef 收下但不會被呼叫', () => {
    const ref = vi.fn()
    const { container } = renderLayout({ safeAreaRef: ref })
    expect(container.querySelector('[data-slot="safe-area"]')).toBeNull()
    expect(ref).not.toHaveBeenCalled()
  })

  it('composer prop 放進 composer-slot', () => {
    const { getByTestId } = renderLayout({ composer: <div data-testid="composer" /> })
    expect(getByTestId('composer').closest('[data-slot="composer-slot"]')).not.toBeNull()
  })
})
