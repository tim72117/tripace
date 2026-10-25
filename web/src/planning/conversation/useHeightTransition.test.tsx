// useHeightTransition——詢問頁換步驟時,把 .bubble 的高度從舊值平滑過渡到新值(FLIP)。
// jsdom 沒有版面也沒有 WAAPI:這裡用 data-h 假裝每個步驟的高度、攔截 element.animate,驗證的是「何時要動、從多少動到多少、
// 動畫期間與結束後的 overflow」,實際視覺在瀏覽器實測。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { useHeightTransition } from './useHeightTransition'

const HEIGHTS: Record<string, number> = { country: 160, city: 160, candidates: 240, transport: 120 }

function Probe({ step, disabled }: { step: string; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useHeightTransition(ref, step, { selector: '.bubble', disabled })
  return (
    <div ref={ref}>
      <div className="bubble" data-h={HEIGHTS[step]} />
    </div>
  )
}

interface FakeAnimation {
  keyframes: Keyframe[]
  options: KeyframeAnimationOptions
  cancel: () => void
  finish: () => void
  onfinish: (() => void) | null
  oncancel: (() => void) | null
  overflowAtStart: string
}

let animations: FakeAnimation[] = []
let reducedMotion = false

beforeEach(() => {
  animations = []
  reducedMotion = false
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const h = Number(this.dataset.h ?? 0)
    return { height: h, width: 300, top: 0, left: 0, right: 300, bottom: h, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
  ;(HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    const anim: FakeAnimation = {
      keyframes,
      options,
      overflowAtStart: this.style.overflow,
      onfinish: null,
      oncancel: null,
      // 與瀏覽器一致:cancel()/finish() 的 cancel/finish 事件是非同步派送(這裡用 microtask),不是在呼叫當下同步觸發。
      // 先前假動畫同步觸發 oncancel,會掩蓋「以為 cancel() 已同步還原 overflow」的 bug。
      cancel: () => {
        queueMicrotask(() => anim.oncancel?.())
      },
      finish: () => {
        queueMicrotask(() => anim.onfinish?.())
      },
    }
    animations.push(anim)
    return anim
  }
  // vi.stubGlobal + afterEach unstubAllGlobals:不把覆寫過的 matchMedia 留給同一個 worker 的其他測試檔。
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate
})

// 讓 microtask 佇列裡的 cancel/finish 事件派送完。
const flush = () => act(async () => {
  await Promise.resolve()
  await Promise.resolve()
})

function bubble(container: HTMLElement): HTMLElement {
  return container.querySelector('.bubble') as HTMLElement
}

describe('useHeightTransition', () => {
  it('第一次掛載不做動畫', () => {
    render(<Probe step="country" />)
    expect(animations).toHaveLength(0)
  })

  it('換步驟且高度不同:從舊高度動到新高度(約 220ms),動畫期間 overflow: hidden,結束後還原', async () => {
    const { container, rerender } = render(<Probe step="city" />)
    rerender(<Probe step="candidates" />)
    expect(animations).toHaveLength(1)
    expect(animations[0].keyframes).toEqual([{ height: '160px' }, { height: '240px' }])
    expect(animations[0].options.duration).toBe(220)
    expect(animations[0].overflowAtStart).toBe('hidden')
    expect(bubble(container).style.overflow).toBe('hidden')
    animations[0].finish()
    await flush()
    expect(bubble(container).style.overflow).toBe('')
  })

  it('換步驟但高度相同:不動', () => {
    const { rerender } = render(<Probe step="country" />)
    rerender(<Probe step="city" />)
    expect(animations).toHaveLength(0)
  })

  it('同一步驟內重繪:不動', () => {
    const { rerender } = render(<Probe step="city" />)
    rerender(<Probe step="city" />)
    expect(animations).toHaveLength(0)
  })

  it('disabled(寬螢幕側欄固定高度):整個跳過', () => {
    const { rerender } = render(<Probe step="city" disabled />)
    rerender(<Probe step="candidates" disabled />)
    expect(animations).toHaveLength(0)
  })

  it('prefers-reduced-motion:跳過', () => {
    reducedMotion = true
    const { rerender } = render(<Probe step="city" />)
    rerender(<Probe step="candidates" />)
    expect(animations).toHaveLength(0)
  })

  it('動畫進行中又換步驟:先取消前一個,再從目前高度動到新高度;cancel 事件非同步到達後 overflow 最終仍還原成進入前的值', async () => {
    const { container, rerender } = render(<Probe step="city" />)
    rerender(<Probe step="candidates" />)
    const first = animations[0]
    const cancel = vi.spyOn(first, 'cancel')
    rerender(<Probe step="transport" />)
    expect(cancel).toHaveBeenCalled()
    expect(animations).toHaveLength(2)
    expect(animations[1].keyframes).toEqual([{ height: '240px' }, { height: '120px' }])
    expect(bubble(container).style.overflow).toBe('hidden')
    await flush() // 前一個動畫的 cancel 事件此時才到
    expect(bubble(container).style.overflow).toBe('hidden') // 新動畫仍在進行
    animations[1].finish()
    await flush()
    expect(bubble(container).style.overflow).toBe('')
  })

  it('進入前本來就有 inline overflow:連續換步驟後還原成原本的值(不是 hidden 也不是空字串)', async () => {
    const { container, rerender } = render(<Probe step="city" />)
    bubble(container).style.overflow = 'auto'
    rerender(<Probe step="candidates" />)
    rerender(<Probe step="transport" />)
    await flush()
    animations[1].finish()
    await flush()
    expect(bubble(container).style.overflow).toBe('auto')
  })

  it('動畫中卸載:取消動畫並還原 overflow', async () => {
    const { container, rerender, unmount } = render(<Probe step="city" />)
    rerender(<Probe step="candidates" />)
    const el = bubble(container)
    const cancel = vi.spyOn(animations[0], 'cancel')
    expect(el.style.overflow).toBe('hidden')
    unmount()
    expect(cancel).toHaveBeenCalled()
    expect(el.style.overflow).toBe('')
    await flush()
    expect(el.style.overflow).toBe('')
  })

  it('瀏覽器不支援 element.animate:不出錯、不動,overflow 不會卡在 hidden', () => {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate
    const { container, rerender } = render(<Probe step="city" />)
    expect(() => rerender(<Probe step="candidates" />)).not.toThrow()
    expect(bubble(container).style.overflow).toBe('')
    rerender(<Probe step="transport" />)
    expect(bubble(container).style.overflow).toBe('')
  })
})
