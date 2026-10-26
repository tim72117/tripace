import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 橋接檔換成假的:不載入 three/WebGL。createMini 的選項會被記下來,測試用它觸發 context lost/restored。
const handles: Array<{ setTheme: ReturnType<typeof vi.fn>; setRunning: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = []
const created: Array<Record<string, unknown>> = []
const defaultCreate = (o: Record<string, unknown>) => {
  created.push(o)
  const h = { setTheme: vi.fn(), setRunning: vi.fn(), dispose: vi.fn() }
  handles.push(h)
  return h
}
let createImpl: (o: Record<string, unknown>) => unknown = defaultCreate
vi.mock('../../island/mini/loadMini', () => ({ createMini: (o: Record<string, unknown>) => createImpl(o) }))
let webglOk = true
vi.mock('./mode', async (orig) => ({ ...(await orig<typeof import('./mode')>()), probeWebgl: () => webglOk }))

import { FALLBACK_DELAY_MS } from './schedule'
import { HeroIsland, ISLAND_HREF } from './HeroIsland'

function setSize(px: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => px })
}
function mockReducedMotion(on: boolean) {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
}
async function flushLoad() {
  await act(async () => { vi.advanceTimersByTime(FALLBACK_DELAY_MS + 50) }) // jsdom 沒有 requestIdleCallback → setTimeout 退路
  await act(async () => { await Promise.resolve() }) // 動態 import 的 microtask
}

beforeEach(() => {
  vi.useFakeTimers()
  handles.length = 0
  created.length = 0
  webglOk = true
  createImpl = defaultCreate // 失敗情境的測試會換掉它,每個測試前還原,避免互相污染
  setSize(400)
  mockReducedMotion(false)
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 1 })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('HeroIsland', () => {
  it('結構:整個島是連結(指向原文)、有 aria-label、裝飾元素都 aria-hidden', () => {
    const { container } = render(<HeroIsland dark={false} onUnavailable={() => {}} />)
    const a = container.querySelector('a.hero-island')!
    expect(a.getAttribute('href')).toBe('/island')
    expect(ISLAND_HREF).toBe('/island')
    expect(a.getAttribute('aria-label')).toContain('夜遊九份')
    for (const c of ['.hero-island-halo', '.hero-island-shadow', '.hero-island-canvas']) {
      expect(container.querySelector(c)!.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('島裡沒有任何可見文字(說明文字已移除);意義只由 aria-label 承載', () => {
    const { container } = render(<HeroIsland dark={false} onUnavailable={() => {}} />)
    expect(container.querySelector('a.hero-island')!.textContent).toBe('')
    expect(container.querySelector('.hero-island-caption')).toBeNull()
    expect(container.querySelector('a.hero-island')!.getAttribute('aria-label')).toBeTruthy()
  })

  it('載入排程之前不建立島;到時間才建立一次,主題用當下的值', async () => {
    render(<HeroIsland dark={true} onUnavailable={() => {}} />)
    expect(created).toHaveLength(0)
    await flushLoad()
    expect(created).toHaveLength(1)
    expect(created[0].theme).toBe('dark')
    expect(created[0].reducedMotion).toBe(false)
  })

  it('第一幀之後才加 is-ready;主題改變時呼叫 setTheme', async () => {
    const { container, rerender } = render(<HeroIsland dark={false} onUnavailable={() => {}} />)
    expect(container.querySelector('a.hero-island.is-ready')).toBeNull()
    await flushLoad()
    expect(container.querySelector('a.hero-island.is-ready')).not.toBeNull()
    rerender(<HeroIsland dark={true} onUnavailable={() => {}} />)
    expect(handles[0].setTheme).toHaveBeenLastCalledWith('dark')
  })

  it('卸載時釋放島;載入前就卸載則永遠不建立', async () => {
    const a = render(<HeroIsland dark={false} onUnavailable={() => {}} />)
    await flushLoad()
    a.unmount()
    expect(handles[0].dispose).toHaveBeenCalledTimes(1)
    const b = render(<HeroIsland dark={false} onUnavailable={() => {}} />)
    b.unmount()
    await flushLoad()
    expect(created).toHaveLength(1) // 只有第一次建立過
  })

  it('版位太小(容器被 CSS 隱藏、邊長 0)→ 在畫面繪製之前就通知收起(不必等載入),且只通知一次、不載入', async () => {
    setSize(0)
    const onUnavailable = vi.fn()
    render(<HeroIsland dark={false} onUnavailable={onUnavailable} />)
    expect(onUnavailable).toHaveBeenCalledTimes(1) // 還沒推進任何計時器:layout effect 已經量過
    await flushLoad()
    expect(onUnavailable).toHaveBeenCalledTimes(1) // 載入時的判斷不會重複通知
    expect(created).toHaveLength(0)
  })

  it('沒有 WebGL → 不載入、通知收起', async () => {
    webglOk = false
    const onUnavailable = vi.fn()
    render(<HeroIsland dark={false} onUnavailable={onUnavailable} />)
    await flushLoad()
    expect(onUnavailable).toHaveBeenCalledTimes(1)
    expect(created).toHaveLength(0)
  })

  it('省流量模式 → 不載入、通知收起', async () => {
    vi.stubGlobal('navigator', { ...navigator, connection: { saveData: true } })
    const onUnavailable = vi.fn()
    render(<HeroIsland dark={false} onUnavailable={onUnavailable} />)
    await flushLoad()
    expect(onUnavailable).toHaveBeenCalledTimes(1)
    expect(created).toHaveLength(0)
  })

  it('建立失敗(例如 WebGL context 建不起來)→ 通知收起,不丟錯', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    createImpl = () => { throw new Error('webgl boom') }
    const onUnavailable = vi.fn()
    render(<HeroIsland dark={false} onUnavailable={onUnavailable} />)
    await flushLoad()
    expect(onUnavailable).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('減少動態 → 仍建立,但以 reducedMotion: true(只畫靜止一幀)', async () => {
    mockReducedMotion(true)
    render(<HeroIsland dark={false} onUnavailable={() => {}} />)
    await flushLoad()
    expect(created[0].reducedMotion).toBe(true)
  })

  it('context lost → 停止繪製;restored → 釋放舊的並重建一個新的', async () => {
    render(<HeroIsland dark={false} onUnavailable={() => {}} />)
    await flushLoad()
    const opts = created[0] as { onContextLost: () => void; onContextRestored: () => void }
    await act(async () => { opts.onContextLost() })
    expect(handles[0].setRunning).toHaveBeenLastCalledWith(false)
    await act(async () => { opts.onContextRestored() })
    await act(async () => { await Promise.resolve() })
    expect(handles[0].dispose).toHaveBeenCalledTimes(1)
    expect(created).toHaveLength(2)
  })

  it('點擊會送出追蹤事件', async () => {
    const w = window as unknown as { dataLayer?: unknown[] }
    w.dataLayer = []
    const { container } = render(<HeroIsland dark={false} onUnavailable={() => {}} />)
    ;(container.querySelector('a.hero-island') as HTMLAnchorElement).addEventListener('click', (e) => e.preventDefault())
    ;(container.querySelector('a.hero-island') as HTMLAnchorElement).click()
    expect(JSON.stringify(w.dataLayer)).toContain('landing_island_click')
  })
})
