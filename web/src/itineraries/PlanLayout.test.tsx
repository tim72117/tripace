// PlanLayout(itineraries)——行程詳情頁的最外層容器,渲染 data-slot="container",children 放在容器裡。
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PlanLayout } from './PlanLayout'

describe('itineraries PlanLayout', () => {
  it('渲染 data-slot="container" 的容器,內容放在裡面', () => {
    const { container, getByTestId } = render(
      <PlanLayout>
        <div data-testid="child" />
      </PlanLayout>,
    )
    const root = container.querySelector('[data-slot="container"]')
    expect(root).not.toBeNull()
    expect(root?.contains(getByTestId('child'))).toBe(true)
  })
})
