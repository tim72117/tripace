// planning/member/desktop/PlanOverlayLayout:登入後桌面版的疊加層——長出共同的 data-slot 骨架(沒有 controls-slot),
// 地圖在 map-layer、內容在 panel、open 只隱藏 overlay(map-layer 與 children 保持掛載)、
// shifted 讓 panel 往左讓開、actions 在 panel 最前面。
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { PlanOverlayLayout } from './PlanOverlayLayout'
import { describeSlotTree } from '../../shared/overlayDom'

function setup(props: Partial<React.ComponentProps<typeof PlanOverlayLayout>> = {}) {
  return render(
    <PlanOverlayLayout open shifted={false} safeAreaRef={() => {}} mapBackground={<div data-testid="map" />} actions={<button>act</button>} {...props}>
      <div data-testid="content" />
    </PlanOverlayLayout>,
  )
}

describe('planning/member/desktop/PlanOverlayLayout', () => {
  it('骨架:map-layer、overlay(safe-area、panel(composer-slot)),沒有 controls-slot', () => {
    const { container } = setup()
    expect(describeSlotTree(container)).toBe('map-layer,overlay(safe-area,panel(composer-slot))')
  })

  it('地圖在 map-layer、內容在 panel,actions 排在 panel 內 children 之前', () => {
    const { getByTestId, container } = setup()
    expect(getByTestId('map').closest('[data-slot="map-layer"]')).not.toBeNull()
    expect(getByTestId('content').closest('[data-slot="panel"]')).not.toBeNull()
    const panel = container.querySelector('[data-slot="panel"]')!
    const kids = Array.from(panel.children)
    expect(kids[0].textContent).toBe('act')
    expect(kids.indexOf(getByTestId('content'))).toBeGreaterThan(0)
  })

  it('沒有 mapBackground 時不渲染 map-layer', () => {
    const { container } = setup({ mapBackground: undefined })
    expect(container.querySelector('[data-slot="map-layer"]')).toBeNull()
  })

  it('open=false:只隱藏 overlay,map-layer 與 children 仍掛載', () => {
    const { container, getByTestId } = setup({ open: false })
    expect((container.querySelector('[data-slot="overlay"]') as HTMLElement).hidden).toBe(true)
    expect((container.querySelector('[data-slot="map-layer"]') as HTMLElement).hidden).toBe(false)
    expect(getByTestId('content')).not.toBeNull()
  })

  it('shifted:panel 多一個讓開 class', () => {
    const a = setup({ shifted: false }).container.querySelector('[data-slot="panel"]')!
    const b = setup({ shifted: true }).container.querySelector('[data-slot="panel"]')!
    expect(b.className.length).toBeGreaterThan(a.className.length)
  })

  it('safe-area 是 overlay 的直接子節點;shifted 時多一個讓開側欄的 class', () => {
    const a = setup({ shifted: false }).container.querySelector('[data-slot="safe-area"]')!
    const b = setup({ shifted: true }).container.querySelector('[data-slot="safe-area"]')!
    expect(a.parentElement?.getAttribute('data-slot')).toBe('overlay')
    expect(b.className.length).toBeGreaterThan(a.className.length)
  })
})

describe('planning/member/desktop/PlanOverlayLayout 安全區', () => {
  it('safeAreaRef(必填)接在 safe-area 節點上', () => {
    const ref = vi.fn()
    const { container } = setup({ safeAreaRef: ref })
    expect(ref).toHaveBeenCalledWith(container.querySelector('[data-slot="safe-area"]'))
  })
})

describe('planning/member/desktop/PlanOverlayLayout passThrough', () => {
  it('passThrough 只在指定時才讓 overlay 加上 class,且與 shifted 各自獨立', () => {
    expect(setup().container.querySelector('[data-slot="overlay"]')!.className).not.toMatch(/passThrough/)
    const p = setup({ passThrough: true }).container.querySelector('[data-slot="overlay"]')!
    expect(p.className).toMatch(/passThrough/)
    const both = setup({ passThrough: true, shifted: true }).container
    expect(both.querySelector('[data-slot="overlay"]')!.className).toMatch(/passThrough/)
    expect(both.querySelector('[data-slot="panel"]')!.className).toMatch(/shifted/)
  })
})
