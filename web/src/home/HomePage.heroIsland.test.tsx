import { act, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./ScrollPlanDemo', () => ({ ScrollPlanDemo: () => null }))
vi.mock('../island/mini/loadMini', () => ({
  createMini: () => ({ setTheme: vi.fn(), setRunning: vi.fn(), dispose: vi.fn() }),
}))
let webglOk = true
vi.mock('./heroIsland/mode', async (orig) => ({ ...(await orig<typeof import('./heroIsland/mode')>()), probeWebgl: () => webglOk }))

import { HomePage } from './HomePage'

function setSize(px: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => px })
}
async function flushLoad() {
  await act(async () => { vi.advanceTimersByTime(1300) })
  await act(async () => { await Promise.resolve() })
}

beforeEach(() => { webglOk = true; vi.useFakeTimers(); setSize(400); vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 1 }) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('首頁 hero 的縮小島', () => {
  it('結構:文字組在前、島在後(閱讀與 Tab 順序),文字四個元素都在 hero-copy 內', () => {
    const { container } = render(<MemoryRouter><HomePage /></MemoryRouter>)
    const hero = container.querySelector('section.hero')!
    expect(hero.classList.contains('is-island-off')).toBe(false)
    const kids = [...hero.children].map((c) => c.className.toString())
    expect(kids.indexOf('hero-copy')).toBeGreaterThanOrEqual(0)
    expect(kids.indexOf('hero-stage')).toBeGreaterThan(kids.indexOf('hero-copy'))
    const copy = hero.querySelector('.hero-copy')!
    for (const c of ['.hero-eyebrow', '.hero-title', '.hero-sub', '.hero-actions']) expect(copy.querySelector(c), c).not.toBeNull()
    expect(copy.querySelector('a.hero-cta')!.getAttribute('href')).toBe('#destinations')
  })

  it('島是連結、帶 aria-label;主標題文字沒有被改動', () => {
    const { container } = render(<MemoryRouter><HomePage /></MemoryRouter>)
    const a = container.querySelector('.hero-stage a.hero-island')!
    expect(a.getAttribute('href')).toBe('/island')
    expect(a.getAttribute('aria-label')).toContain('夜遊九份')
    expect(container.querySelector('.hero-title')!.textContent).toBe('走進一個地方而不只是到過')
  })

  it('載入完成後 hero 仍是開啟狀態、島加上 is-ready', async () => {
    const { container } = render(<MemoryRouter><HomePage /></MemoryRouter>)
    await flushLoad()
    expect(container.querySelector('section.hero.is-island-off')).toBeNull()
    expect(container.querySelector('a.hero-island.is-ready')).not.toBeNull()
  })

  it('島不可用(版位太小)→ hero 加 is-island-off、整個島收起,文字組仍在', async () => {
    setSize(0)
    const { container } = render(<MemoryRouter><HomePage /></MemoryRouter>)
    await flushLoad()
    expect(container.querySelector('section.hero.is-island-off')).not.toBeNull()
    expect(container.querySelector('.hero-stage')).toBeNull()
    expect(container.querySelector('.hero-copy .hero-cta')).not.toBeNull()
  })

  it('省流量模式:第一次 render 就收起(不等 load),沒有任何計時器推進——不會有「先靠上再跳回置中」的位移', () => {
    vi.stubGlobal('navigator', { ...navigator, connection: { saveData: true } })
    const { container } = render(<MemoryRouter><HomePage /></MemoryRouter>)
    expect(container.querySelector('section.hero.is-island-off')).not.toBeNull()
    expect(container.querySelector('.hero-stage')).toBeNull()
  })

  it('沒有 WebGL:第一次 render 就收起', () => {
    webglOk = false
    const { container } = render(<MemoryRouter><HomePage /></MemoryRouter>)
    expect(container.querySelector('section.hero.is-island-off')).not.toBeNull()
    expect(container.querySelector('.hero-stage')).toBeNull()
  })

  it('版位太小(邊長 0):在繪製之前(layout effect)就收起,不必等載入', () => {
    setSize(0)
    const { container } = render(<MemoryRouter><HomePage /></MemoryRouter>)
    expect(container.querySelector('section.hero.is-island-off')).not.toBeNull()
  })
})
