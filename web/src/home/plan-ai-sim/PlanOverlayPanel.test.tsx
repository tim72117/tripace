// PlanOverlayPanel 的版面契約:哪些節點在、誰是誰的手足、插槽能不能被
// 兩種方式(composer prop / context portal)填入。
//
// jsdom 不計算版面,所以驗證的是 DOM 結構與 class 契約,不是像素位置;
// 實際位置由瀏覽器端的量測負責(見 PlanOverlayPanel.module.css 說明)。
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PlanOverlayPanel } from './PlanOverlayPanel'
import { ComposerPortal } from '../../trip-plan/ComposerPortal'
import { ComposerSlotContext } from '../../plan-core/composerSlot'
import { useContext } from 'react'

const noopRef = () => {}

describe('PlanOverlayPanel 結構', () => {
  it('手機版:導覽列佔位 + 面板 + 輸入框插槽,三者是同層手足', () => {
    const { container } = render(
      <PlanOverlayPanel isDesktop={false} safeAreaRef={noopRef}>
        <div data-testid="timeline" />
      </PlanOverlayPanel>,
    )
    expect(container.children).toHaveLength(3)
    const [spacer, panel, slot] = Array.from(container.children)
    expect(spacer.className).toMatch(/navSpacer/)
    expect(panel.className).toMatch(/panel/)
    expect(slot.className).toMatch(/composerSlot/)
    expect(panel.querySelector('[data-testid="timeline"]')).not.toBeNull()
  })

  it('桌面版:沒有導覽列佔位與安全區,只有面板 + 插槽', () => {
    const { container } = render(
      <PlanOverlayPanel isDesktop safeAreaRef={noopRef}>
        <div />
      </PlanOverlayPanel>,
    )
    expect(container.children).toHaveLength(2)
    expect(container.querySelector('[class*="navSpacer"]')).toBeNull()
    expect(container.querySelector('[class*="safeArea"]')).toBeNull()
  })

  it('安全區元素只在手機版交給 safeAreaRef', () => {
    const seen: Array<HTMLElement | null> = []
    const ref = (el: HTMLDivElement | null) => { seen.push(el) }

    render(<PlanOverlayPanel isDesktop={false} safeAreaRef={ref}><div /></PlanOverlayPanel>)
    expect(seen.some((el) => el !== null)).toBe(true)

    seen.length = 0
    render(<PlanOverlayPanel isDesktop safeAreaRef={ref}><div /></PlanOverlayPanel>)
    expect(seen.some((el) => el !== null)).toBe(false)
  })

  it('passThrough 只在指定時才加上讓出事件的 class', () => {
    const a = render(<PlanOverlayPanel isDesktop safeAreaRef={noopRef}><div /></PlanOverlayPanel>)
    expect(a.container.querySelector('[class*="panel"]')!.className).not.toMatch(/passThrough/)
    a.unmount()

    const b = render(<PlanOverlayPanel isDesktop safeAreaRef={noopRef} passThrough><div /></PlanOverlayPanel>)
    expect(b.container.querySelector('[class*="panel"]')!.className).toMatch(/passThrough/)
  })
})

describe('輸入框插槽', () => {
  it('composer prop:內容渲染在插槽裡,不在面板裡', () => {
    const { container } = render(
      <PlanOverlayPanel isDesktop safeAreaRef={noopRef} composer={<input data-testid="sim-input" />}>
        <div />
      </PlanOverlayPanel>,
    )
    const panel = container.querySelector('[class*="panel"]')!
    const slot = container.querySelector('[class*="composerSlot"]')!
    expect(slot.querySelector('[data-testid="sim-input"]')).not.toBeNull()
    expect(panel.querySelector('[data-testid="sim-input"]')).toBeNull()
  })

  it('ComposerPortal 在外殼內:輸入框被傳送進插槽,而不是留在面板裡', () => {
    const Content = () => {
      const slot = useContext(ComposerSlotContext)
      return (
        <div data-testid="content">
          <ComposerPortal slot={slot}>
            <input data-testid="live-input" />
          </ComposerPortal>
        </div>
      )
    }
    const { container } = render(
      <PlanOverlayPanel isDesktop safeAreaRef={noopRef}>
        <Content />
      </PlanOverlayPanel>,
    )
    const slot = container.querySelector('[class*="composerSlot"]')!
    const content = container.querySelector('[data-testid="content"]')!
    expect(slot.querySelector('[data-testid="live-input"]')).not.toBeNull()
    expect(content.querySelector('[data-testid="live-input"]')).toBeNull()
  })

  it('ComposerPortal 不在外殼內(slot 為 undefined):原位渲染,行為不變', () => {
    const { container } = render(
      <ComposerPortal slot={undefined}>
        <input data-testid="inline-input" />
      </ComposerPortal>,
    )
    expect(container.querySelector('[data-testid="inline-input"]')).not.toBeNull()
  })

  it('插槽尚未就緒(slot 為 null):先不渲染,避免在錯誤位置閃一下', () => {
    const { container } = render(
      <ComposerPortal slot={null}>
        <input data-testid="pending-input" />
      </ComposerPortal>,
    )
    expect(container.querySelector('[data-testid="pending-input"]')).toBeNull()
  })
})
