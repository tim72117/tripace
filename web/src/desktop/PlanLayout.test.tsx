// PlanLayout(登入後桌面版)——最外層容器:data-slot="container",底下依序是 nav、主顯示區(children)、debugPanel。
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PlanLayout } from './PlanLayout'

describe('PlanLayout(登入後桌面版)', () => {
  it('渲染 data-slot="container" 的容器,底下依序是 nav、主顯示區、debugPanel', () => {
    const { container, getByTestId } = render(
      <PlanLayout nav={<nav data-testid="nav" />} debugPanel={<aside data-testid="debug" />}>
        <div data-testid="child" />
      </PlanLayout>,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('data-slot')).toBe('container')
    const kids = Array.from(root.children).map((c) => c.getAttribute('data-testid') ?? 'main')
    expect(kids).toEqual(['nav', 'main', 'debug'])
    expect(getByTestId('child').closest('main')).not.toBeNull()
  })

  it('沒有 debugPanel:只有 nav 與主顯示區', () => {
    const { container } = render(
      <PlanLayout nav={<nav />}>
        <div />
      </PlanLayout>,
    )
    expect((container.firstElementChild as HTMLElement).children).toHaveLength(2)
  })
})
