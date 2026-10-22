// PlanLayout(登入後手機版)——最外層容器,對應 /ai-plan 的 home/plan-ai-sim/PlanLayout:同一個層級、
// 同一個名字,都渲染 data-slot="container" 的容器(見 plan-core/overlayDom.ts)。
// 這個版本只管容器本身:撐滿剩餘高度、當 TabBar 等絕對定位元素的錨點、把量到的 TabBar 高度寫成
// CSS 自訂屬性 --tab-bar-height 往下繼承。
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PlanLayout } from './PlanLayout'

describe('PlanLayout(登入後手機版)', () => {
  it('渲染 data-slot="container" 的容器,children 放在裡面', () => {
    const { container, getByTestId } = render(
      <PlanLayout tabBarHeight={64}>
        <div data-testid="child" />
      </PlanLayout>,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('data-slot')).toBe('container')
    expect(root.contains(getByTestId('child'))).toBe(true)
  })

  it('tabBarHeight 寫成 --tab-bar-height(px),子孫元素可以直接讀', () => {
    const { container } = render(<PlanLayout tabBarHeight={72}>{null}</PlanLayout>)
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--tab-bar-height')).toBe('72px')
  })

  it('tabBarHeight 為 0(第一次量測前):照樣寫 0px', () => {
    const { container } = render(<PlanLayout tabBarHeight={0}>{null}</PlanLayout>)
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--tab-bar-height')).toBe('0px')
  })

  it('其餘 div 屬性(例如手勢處理)轉給容器', () => {
    let touched = false
    const { container } = render(
      <PlanLayout tabBarHeight={1} onTouchStart={() => (touched = true)}>
        {null}
      </PlanLayout>,
    )
    container.firstElementChild!.dispatchEvent(new Event('touchstart', { bubbles: true }))
    expect(touched).toBe(true)
  })
})
