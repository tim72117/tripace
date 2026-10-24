// OverlayShell——三個入口(/ai-plan、登入後手機、登入後桌面)共用的外殼:同一套 DOM 骨架、輸入列插槽的狀態與
// ComposerSlotContext。樣式(class)、導覽列佔位、除錯疊圖等各邊特有的東西由呼叫端傳進來。
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useContext } from 'react'
import { OverlayShell, type OverlayClassNames } from './OverlayShell'
import { ComposerSlotContext, describeSlotTree } from './overlayDom'
const cn: OverlayClassNames = {
  mapLayer: 'c-map',
  controlsSlot: 'c-controls',
  overlay: 'c-overlay',
  panel: 'c-panel',
  safeArea: 'c-safe',
  composerSlot: 'c-composer',
}

function renderShell(props: Partial<React.ComponentProps<typeof OverlayShell>> = {}) {
  return render(
    <OverlayShell classNames={cn} mapBackground={<div data-testid="map" />} {...props}>
      <div data-testid="content" />
    </OverlayShell>,
  )
}

describe('OverlayShell 骨架', () => {
  it('長出共同骨架:map-layer、controls-slot、overlay > (safe-area、panel > composer-slot)', () => {
    const { container } = renderShell()
    expect(describeSlotTree(container)).toBe('map-layer,controls-slot,overlay(safe-area,panel(composer-slot))')
  })

  it('classNames 套到對應節點(樣式由呼叫端決定)', () => {
    const { container } = renderShell()
    for (const [slot, cls] of [
      ['map-layer', 'c-map'],
      ['controls-slot', 'c-controls'],
      ['overlay', 'c-overlay'],
      ['panel', 'c-panel'],
      ['safe-area', 'c-safe'],
      ['composer-slot', 'c-composer'],
    ]) {
      expect(container.querySelector(`[data-slot="${slot}"]`)!.className).toBe(cls)
    }
  })

  it('地圖放進 map-layer、內容放進 panel、composer prop 放進 composer-slot', () => {
    const { getByTestId } = renderShell({ composer: <i data-testid="composer" /> })
    expect(getByTestId('map').closest('[data-slot="map-layer"]')).not.toBeNull()
    expect(getByTestId('content').closest('[data-slot="panel"]')).not.toBeNull()
    expect(getByTestId('composer').closest('[data-slot="composer-slot"]')).not.toBeNull()
  })

  it('safe-area 是 overlay 的直接子節點、排在 panel 之前;panel 內是內容與 composer-slot', () => {
    const { container } = renderShell()
    const overlay = container.querySelector('[data-slot="overlay"]')!
    const slots = [...overlay.children].map((c) => c.getAttribute('data-slot'))
    expect(slots.indexOf('safe-area')).toBeLessThan(slots.indexOf('panel'))
    const panel = container.querySelector('[data-slot="panel"]')!
    const names = [...panel.children].map((c) => c.getAttribute('data-slot') ?? 'content')
    expect(names).toEqual(['content', 'composer-slot'])
  })

  it('沒有 mapBackground:不渲染 map-layer', () => {
    const { container } = renderShell({ mapBackground: undefined })
    expect(describeSlotTree(container)).toBe('controls-slot,overlay(safe-area,panel(composer-slot))')
  })

  it('showControlsSlot 為 false:不渲染 controls-slot', () => {
    const { container } = renderShell({ showControlsSlot: false })
    expect(container.querySelector('[data-slot="controls-slot"]')).toBeNull()
  })
})

describe('OverlayShell 開關與插槽', () => {
  it('open=false:只有 overlay 被藏起來,controls-slot 與 map-layer 不受影響', () => {
    const { container } = renderShell({ open: false })
    expect(container.querySelector('[data-slot="overlay"]')!.hasAttribute('hidden')).toBe(true)
    expect(container.querySelector('[data-slot="controls-slot"]')!.closest('[hidden]')).toBeNull()
    expect(container.querySelector('[data-slot="map-layer"]')!.closest('[hidden]')).toBeNull()
  })

  it('open 沒傳(預設):overlay 不隱藏', () => {
    const { container } = renderShell()
    expect(container.querySelector('[data-slot="overlay"]')!.hasAttribute('hidden')).toBe(false)
  })

  it('onControlsSlotChange:掛載後拿到元素,卸載回報 null', () => {
    const onChange = vi.fn()
    const { unmount } = renderShell({ onControlsSlotChange: onChange })
    expect(onChange).toHaveBeenCalledWith(expect.any(HTMLDivElement))
    unmount()
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('safeAreaRef 接在 safe-area 節點上,safe-area 是無障礙隱藏的', () => {
    const ref = vi.fn()
    const { container } = renderShell({ safeAreaRef: ref })
    const el = container.querySelector('[data-slot="safe-area"]')!
    expect(ref).toHaveBeenCalledWith(el)
    expect(el.getAttribute('aria-hidden')).toBe('true')
  })

  it('overlayStart 渲染在 overlay 裡、panel 之前', () => {
    const { container } = renderShell({ overlayStart: <b data-testid="spacer" /> })
    const overlay = container.querySelector('[data-slot="overlay"]')!
    expect(overlay.firstElementChild!.getAttribute('data-testid')).toBe('spacer')
    expect(overlay.children[1].getAttribute('data-slot')).toBe('safe-area')
    expect(overlay.children[2].getAttribute('data-slot')).toBe('panel')
  })

  it('overlayEnd 是 render prop,拿到 overlay、panel、composer-slot 三個元素(除錯疊圖用)', () => {
    let got: { overlayEl: HTMLElement | null; panelEl: HTMLElement | null; composerSlotEl: HTMLElement | null } | null = null
    const { container } = renderShell({
      overlayEnd: (els) => {
        got = els
        return <u data-testid="end" />
      },
    })
    expect(got!.overlayEl).toBe(container.querySelector('[data-slot="overlay"]'))
    expect(got!.panelEl).toBe(container.querySelector('[data-slot="panel"]'))
    expect(got!.composerSlotEl).toBe(container.querySelector('[data-slot="composer-slot"]'))
    const overlay = container.querySelector('[data-slot="overlay"]')!
    expect(overlay.lastElementChild!.getAttribute('data-testid')).toBe('end')
  })
})

describe('OverlayShell ComposerSlotContext', () => {
  function Probe() {
    const slot = useContext(ComposerSlotContext)
    return <i data-testid="probe" data-kind={slot === undefined ? 'undefined' : slot === null ? 'null' : 'el'} />
  }

  it('內容元件拿到 composer-slot 元素(掛載後)', () => {
    const { getByTestId, container } = render(
      <OverlayShell classNames={cn}>
        <Probe />
      </OverlayShell>,
    )
    expect(getByTestId('probe').getAttribute('data-kind')).toBe('el')
    expect(container.querySelector('[data-slot="composer-slot"]')).not.toBeNull()
  })
})
