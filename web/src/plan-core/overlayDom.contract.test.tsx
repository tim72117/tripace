// 手機版外殼的 DOM 契約測試:/ai-plan(PlanLayout)與登入後手機版(PlanOverlayLayout)
// 是各自實作的版面元件,但必須長出同一套 data-slot 骨架(見 overlayDom.ts)。
import { describe, it, expect } from 'vitest'
import { render, within } from '@testing-library/react'
import { PlanLayout } from '../home/plan-ai-sim/PlanLayout'
import { PlanOverlayLayout } from '../phone/PlanOverlayLayout'
import { PlanOverlayLayout as DesktopPlanOverlayLayout } from '../desktop/PlanOverlayLayout'
import { PlanLayout as DesktopPlanLayout } from '../desktop/PlanLayout'
import { describeSlotTree } from './overlayDom'

// 容器底下(不含容器本身)的骨架。容器自己的 data-slot=container 另測。
const EXPECTED = 'map-layer,controls-slot,overlay(safe-area,panel(composer-slot))'

function renderAiPlanPhone() {
  return render(
    <PlanLayout
      theme="light"
      mapBackground={<div data-testid="map" />}
      isDesktop={false}
      safeAreaRef={() => {}}
      composer={<div data-testid="composer" />}
    >
      <div data-testid="content" />
    </PlanLayout>,
  )
}

function renderLoginPhone() {
  return render(
    <div data-testid="container">
      <PlanOverlayLayout open mapBackground={<div data-testid="map" />}>
        <div data-testid="content" />
      </PlanOverlayLayout>
    </div>,
  )
}

describe('手機版外殼 DOM 契約', () => {
  it('/ai-plan 手機版:容器底下是共同骨架', () => {
    const { container } = renderAiPlanPhone()
    expect(describeSlotTree(container)).toBe(`container(${EXPECTED})`)
  })

  it('登入後手機版:容器底下是共同骨架', () => {
    const { container } = renderLoginPhone()
    expect(describeSlotTree(container)).toBe(EXPECTED)
  })

  it('兩邊的骨架完全相同', () => {
    const a = describeSlotTree(renderAiPlanPhone().container.firstElementChild!)
    const b = describeSlotTree(renderLoginPhone().container.firstElementChild!)
    expect(a).toBe(b)
  })

  it('地圖放在 map-layer 裡、內容放在 panel 裡(兩邊相同)', () => {
    for (const { container } of [renderAiPlanPhone(), renderLoginPhone()]) {
      const { getByTestId } = within(container)
      expect(getByTestId('map').closest('[data-slot="map-layer"]')).not.toBeNull()
      expect(getByTestId('content').closest('[data-slot="panel"]')).not.toBeNull()
      expect(container.querySelector('[data-slot="controls-slot"]')!.children).toHaveLength(0)
    }
  })

  it('/ai-plan 手機版的最外層容器標示為 container,骨架在它底下', () => {
    const { container } = renderAiPlanPhone()
    const root = container.firstElementChild!
    expect(root.getAttribute('data-slot')).toBe('container')
    expect(describeSlotTree(root)).toBe(EXPECTED)
  })

  it('輸入列內容(/ai-plan 的 composer prop)放進 composer-slot', () => {
    const { getByTestId } = renderAiPlanPhone()
    expect(getByTestId('composer').closest('[data-slot="composer-slot"]')).not.toBeNull()
  })
})

// 登入後桌面版是同一套骨架,只少一個 controls-slot(搜尋框等原地渲染在地圖上,不經 portal)。
describe('登入後桌面版外殼 DOM 契約', () => {
  it('骨架與手機版相同,只是沒有 controls-slot', () => {
    const { container } = render(
      <DesktopPlanOverlayLayout open shifted={false} mapBackground={<div data-testid="map" />}>
        <div data-testid="content" />
      </DesktopPlanOverlayLayout>,
    )
    const phone = describeSlotTree(renderLoginPhone().container.firstElementChild!)
    expect(describeSlotTree(container)).toBe(phone.replace('controls-slot,', ''))
  })

  it('桌面版容器(desktop/PlanLayout)是 data-slot="container",疊加層骨架在它底下', () => {
    const { container } = render(
      <DesktopPlanLayout nav={<nav />}>
        <DesktopPlanOverlayLayout open shifted={false} mapBackground={<div />}>
          <div />
        </DesktopPlanOverlayLayout>
      </DesktopPlanLayout>,
    )
    expect(describeSlotTree(container)).toBe('container(map-layer,overlay(safe-area,panel(composer-slot)))')
  })
})
