// PlanOverlayPanel 的版面契約:哪些節點在、誰是誰的手足、插槽能不能被
// 兩種方式(composer prop / context portal)填入。
//
// jsdom 不計算版面,所以驗證的是 DOM 結構與 class 契約,不是像素位置;
// 實際位置由瀏覽器端的量測負責(見 PlanOverlayPanel.module.css 說明)。
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PlanOverlayPanel } from './PlanOverlayPanel'
import { ComposerPortal } from '../../../trip-plan/ComposerPortal'
import { ComposerSlotContext } from '../../../plan-core/overlayDom'
import { useContext } from 'react'

describe('PlanOverlayPanel 結構', () => {
  // 2026-10(第三輪)使用者明確要求「composer 區位要跟 UI 區的元素一起
  // 排列」,並確認「只改手機版,不動桌面版」:手機版插槽從面板的手足
  // 改成面板的子孫(.composerSlotMobile),桌面版維持原本的手足關係
  // 不變(見 PlanOverlayPanel.tsx 依 isDesktop 分流插槽位置處的完整
  // 說明)。這裡原本斷言「三者是同層手足」的行為只對桌面版仍然成立,
  // 手機版改成斷言插槽是面板的子孫。
  // 桌面版維持改動前的既有行為:插槽仍然是面板的手足,不是子孫(見上方
  // PlanOverlayPanel.tsx 的完整說明:桌面 .panel 是固定 560px 的
  // absolute 側欄,插槽放進面板內部會被側欄寬度侷限)。
  it('桌面版:面板 + 輸入框插槽,兩者仍是同層手足(改動前既有行為不變)', () => {
    const { container } = render(
      <PlanOverlayPanel>
        <div data-testid="timeline" />
      </PlanOverlayPanel>,
    )
    expect(container.children).toHaveLength(2)
    const [panel, slot] = Array.from(container.children)
    expect(panel.className).toMatch(/panel/)
    expect(slot.className).toMatch(/composerSlot/)
    expect(slot.className).not.toMatch(/composerSlotMobile/)
    expect(panel.querySelector('[data-testid="timeline"]')).not.toBeNull()
  })

  it('桌面版:沒有導覽列佔位與安全區,只有面板 + 插槽', () => {
    const { container } = render(
      <PlanOverlayPanel>
        <div />
      </PlanOverlayPanel>,
    )
    expect(container.children).toHaveLength(2)
    expect(container.querySelector('[class*="navSpacer"]')).toBeNull()
    expect(container.querySelector('[class*="safeArea"]')).toBeNull()
  })

  it('passThrough 只在指定時才加上讓出事件的 class', () => {
    const a = render(<PlanOverlayPanel><div /></PlanOverlayPanel>)
    expect(a.container.querySelector('[class*="panel"]')!.className).not.toMatch(/passThrough/)
    a.unmount()

    const b = render(<PlanOverlayPanel passThrough><div /></PlanOverlayPanel>)
    expect(b.container.querySelector('[class*="panel"]')!.className).toMatch(/passThrough/)
  })
})

describe('輸入框插槽', () => {
  it('composer prop:內容渲染在插槽裡,不在面板裡', () => {
    const { container } = render(
      <PlanOverlayPanel composer={<input data-testid="sim-input" />}>
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
      <PlanOverlayPanel>
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
