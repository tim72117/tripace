// PlanOverlayLayout 的「地圖控制項插槽」(controls slot)測試。
//
// 2026-10:手機版的搜尋框、類別標籤、「搜尋這個區域」鈕原本 portal 進 PlanPhoneView 自己的
// .uiLayer,改成由 PlanOverlayLayout 在版面外殼裡挖一個洞(插槽)讓它們放進去——做法同
// 輸入列的 composerSlot。關鍵行為:插槽不能被規劃面板的 hidden(open=false)一起藏起來,否則面板
// 關閉時搜尋框會消失。
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { useState } from 'react'
import { PlanOverlayLayout } from './PlanOverlayLayout'

const noopRef = () => {}

function Harness({ open }: { open: boolean }) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  return (
    <>
      <PlanOverlayLayout open={open} safeAreaRef={noopRef} onControlsSlotChange={setSlot}>
        <div data-testid="panel-content">面板</div>
      </PlanOverlayLayout>
      {slot && createPortal(<input data-testid="search-box" />, slot)}
    </>
  )
}

describe('PlanOverlayLayout 控制項插槽', () => {
  it('掛載後把插槽元素交給 onControlsSlotChange,卸載時回報 null', () => {
    const onChange = vi.fn()
    const { unmount } = render(
      <PlanOverlayLayout open safeAreaRef={noopRef} onControlsSlotChange={onChange}>
        <div />
      </PlanOverlayLayout>,
    )
    expect(onChange).toHaveBeenCalledWith(expect.any(HTMLDivElement))
    unmount()
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('沒傳 onControlsSlotChange 也能正常渲染', () => {
    const { getByTestId } = render(
      <PlanOverlayLayout open safeAreaRef={noopRef}>
        <div data-testid="panel-content" />
      </PlanOverlayLayout>,
    )
    expect(getByTestId('panel-content')).toBeTruthy()
  })

  it('portal 進插槽的控制項會出現在 DOM 裡', () => {
    const { getByTestId } = render(<Harness open />)
    expect(getByTestId('search-box')).toBeTruthy()
  })

  it('規劃面板關閉(open=false):面板被藏起來,但插槽裡的控制項不在 hidden 範圍內', () => {
    const { getByTestId } = render(<Harness open={false} />)
    expect(getByTestId('panel-content').closest('[hidden]')).not.toBeNull()
    expect(getByTestId('search-box').closest('[hidden]')).toBeNull()
  })

  it('插槽和規劃面板外殼(.overlay)是同一層的兄弟,不在面板裡面', () => {
    const { getByTestId } = render(<Harness open />)
    const slot = getByTestId('search-box').parentElement!
    const overlay = getByTestId('panel-content').parentElement!.parentElement!
    expect(overlay.contains(slot)).toBe(false)
    expect(slot.parentElement).toBe(overlay.parentElement)
  })
})

describe('PlanOverlayLayout 安全區', () => {
  it('safeAreaRef(必填)接在 safe-area 節點上', () => {
    const ref = vi.fn()
    const { container } = render(
      <PlanOverlayLayout open safeAreaRef={ref}>
        <div />
      </PlanOverlayLayout>,
    )
    expect(ref).toHaveBeenCalledWith(container.querySelector('[data-slot="safe-area"]'))
  })
})

describe('PlanOverlayLayout passThrough', () => {
  it('passThrough 只在指定時才讓 overlay 加上不接收指標事件的 class', () => {
    const a = render(<PlanOverlayLayout open safeAreaRef={noopRef}><div /></PlanOverlayLayout>)
    expect(a.container.querySelector('[data-slot="overlay"]')!.className).not.toMatch(/passThrough/)
    a.unmount()
    const b = render(<PlanOverlayLayout open passThrough safeAreaRef={noopRef}><div /></PlanOverlayLayout>)
    expect(b.container.querySelector('[data-slot="overlay"]')!.className).toMatch(/passThrough/)
  })
})
