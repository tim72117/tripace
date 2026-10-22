// desktop/PlanLayoutDebugOverlay:用 DOM 實際量到的範圍標示 overlay、panel、composer 與安全區(safe-area 節點)。
// jsdom 不計算版面,這裡用 getBoundingClientRect 的假值驗證「有量到才畫、安全區量的是 safe-area 節點」。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { PlanLayoutDebugOverlay } from './PlanLayoutDebugOverlay'

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

function stubRect(el: Element, r: DOMRect) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(r)
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function build() {
  const overlay = document.createElement('div')
  const safe = document.createElement('div')
  safe.setAttribute('data-slot', 'safe-area')
  const panel = document.createElement('div')
  const composer = document.createElement('div')
  overlay.append(safe, panel)
  panel.append(composer)
  document.body.append(overlay)
  stubRect(overlay, rect(48, 0, 1352, 850))
  stubRect(safe, rect(48, 72, 792, 778))
  stubRect(panel, rect(840, 72, 560, 778))
  stubRect(composer, rect(840, 764, 560, 86))
  return { overlay, panel, composer }
}

describe('desktop/PlanLayoutDebugOverlay', () => {
  it('overlay 有尺寸:畫出 overlay、panel、composer 框與安全區中心點', () => {
    const { overlay, panel, composer } = build()
    const { container } = render(<PlanLayoutDebugOverlay overlayEl={overlay} panelEl={panel} composerEl={composer} />)
    const text = container.textContent ?? ''
    for (const label of ['overlay', 'panel', 'composer', 'safeCenter']) expect(text).toContain(label)
  })

  it('overlay 隱藏(量到全 0):什麼都不畫', () => {
    const { overlay, panel, composer } = build()
    stubRect(overlay, rect(0, 0, 0, 0))
    const { container } = render(<PlanLayoutDebugOverlay overlayEl={overlay} panelEl={panel} composerEl={composer} />)
    expect(container.textContent).toBe('')
  })
})
