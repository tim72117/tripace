import { describe, expect, it, vi } from 'vitest'
import { heroIslandMode, MIN_ISLAND_PX } from './mode'
import { FALLBACK_DELAY_MS, IDLE_TIMEOUT_MS, scheduleHeroIslandLoad, type ScheduleWindow } from './schedule'

describe('heroIslandMode', () => {
  const ok = { saveData: false, webgl: true, sizePx: 400, reducedMotion: false }
  it('一般情況 live;減少動態 still', () => {
    expect(heroIslandMode(ok)).toBe('live')
    expect(heroIslandMode({ ...ok, reducedMotion: true })).toBe('still')
  })
  it('省流量、沒有 WebGL、版位太小都不載入(off),且優先於減少動態', () => {
    expect(heroIslandMode({ ...ok, saveData: true })).toBe('off')
    expect(heroIslandMode({ ...ok, webgl: false })).toBe('off')
    expect(heroIslandMode({ ...ok, sizePx: 0 })).toBe('off')
    expect(heroIslandMode({ ...ok, sizePx: MIN_ISLAND_PX - 1 })).toBe('off')
    expect(heroIslandMode({ ...ok, sizePx: MIN_ISLAND_PX })).toBe('live')
    expect(heroIslandMode({ ...ok, saveData: true, reducedMotion: true })).toBe('off')
  })
})

function fakeWindow(readyState: string, withIdle: boolean) {
  const loadCbs: Array<() => void> = []
  const idleCbs: Array<() => void> = []
  const timers: Array<{ cb: () => void; ms: number }> = []
  const win = {
    document: { readyState },
    addEventListener: vi.fn((_t: 'load', cb: () => void) => { loadCbs.push(cb) }),
    removeEventListener: vi.fn((_t: 'load', cb: () => void) => { const i = loadCbs.indexOf(cb); if (i >= 0) loadCbs.splice(i, 1) }),
    setTimeout: vi.fn((cb: () => void, ms: number) => timers.push({ cb, ms })),
    clearTimeout: vi.fn(),
    ...(withIdle ? {
      requestIdleCallback: vi.fn((cb: () => void) => idleCbs.push(cb)),
      cancelIdleCallback: vi.fn(),
    } : {}),
  } as unknown as ScheduleWindow & { addEventListener: ReturnType<typeof vi.fn> }
  return { win, loadCbs, idleCbs, timers }
}

describe('scheduleHeroIslandLoad', () => {
  it('load 之前不觸發;load 後等閒置才觸發,且只觸發一次', () => {
    const { win, loadCbs, idleCbs } = fakeWindow('loading', true)
    const ready = vi.fn()
    scheduleHeroIslandLoad(win, ready)
    expect(ready).not.toHaveBeenCalled()
    loadCbs[0]()
    expect(ready).not.toHaveBeenCalled() // 還在等閒置
    expect(win.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: IDLE_TIMEOUT_MS })
    idleCbs[0](); idleCbs[0]?.()
    expect(ready).toHaveBeenCalledTimes(1)
  })
  it('頁面已經 load 完成:直接排閒置;沒有 requestIdleCallback(Safari)退回 setTimeout', () => {
    const a = fakeWindow('complete', true)
    scheduleHeroIslandLoad(a.win, vi.fn())
    expect(a.win.addEventListener).not.toHaveBeenCalled()
    expect(a.win.requestIdleCallback).toHaveBeenCalled()
    const b = fakeWindow('complete', false)
    const ready = vi.fn()
    scheduleHeroIslandLoad(b.win, ready)
    expect(b.timers[0].ms).toBe(FALLBACK_DELAY_MS)
    b.timers[0].cb()
    expect(ready).toHaveBeenCalledTimes(1)
  })
  it('取消後不再觸發,並移除 load 監聽', () => {
    const { win, loadCbs, idleCbs } = fakeWindow('loading', true)
    const ready = vi.fn()
    const cancel = scheduleHeroIslandLoad(win, ready)
    cancel()
    expect(loadCbs).toHaveLength(0)
    idleCbs[0]?.()
    expect(ready).not.toHaveBeenCalled()
  })
})
