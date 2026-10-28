import { describe, expect, it, vi } from 'vitest'
import { snapToNearestChild } from './snapScroll'

const rectOf = (left: number, width: number) => ({ left, width, right: left + width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) }) as DOMRect

function item(left: number, width: number): Element {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => rectOf(left, width)
  return el
}

describe('snapToNearestChild', () => {
  it('捲到離中心最近的項目,並在延遲後恢復 scroll-snap', () => {
    vi.useFakeTimers()
    const scroller = document.createElement('div')
    scroller.getBoundingClientRect = () => rectOf(0, 300) // 中心 150
    scroller.scrollLeft = 100
    scroller.style.scrollSnapType = 'none'
    const scrollTo = vi.fn()
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo
    // 項目中心:20、210、400 → 最近的是 210(差 60)
    snapToNearestChild(scroller, [item(-30, 100), item(160, 100), item(350, 100)])
    expect(scrollTo).toHaveBeenCalledWith({ left: 160, behavior: 'smooth' })
    expect(scroller.style.scrollSnapType).toBe('none')
    vi.advanceTimersByTime(400)
    expect(scroller.style.scrollSnapType).toBe('')
    vi.useRealTimers()
  })

  it('沒有項目:不捲動,只恢復 scroll-snap', () => {
    vi.useFakeTimers()
    const scroller = document.createElement('div')
    const scrollTo = vi.fn()
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo
    scroller.style.scrollSnapType = 'none'
    snapToNearestChild(scroller, [])
    expect(scrollTo).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)
    expect(scroller.style.scrollSnapType).toBe('')
    vi.useRealTimers()
  })
})
