// 圖卡上滑露出操作列(useSwipeReveal):垂直拖曳展開、點操作列動作會收合並呼叫 callback、水平拖曳不展開。
import { describe, it, expect, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { renderWithPlanData as render } from '../../data/fixtures'
import { HorizontalPlanTimeline } from './HorizontalPlanTimeline'
import type { PlanNode } from '../model'
import { timelineOf } from '../fixtures'
import styles from './HorizontalPlanTimeline.module.css'

const noop = () => {}
const node = (over: Partial<PlanNode> = {}): PlanNode => ({ id: 's1', type: 'stop', name: '赤崁樓', desc: '描述', time: '09:00', day: 1, lat: 1, lng: 2, ...over })

function setup(extra: Partial<React.ComponentProps<typeof HorizontalPlanTimeline>> = {}) {
  const utils = render(
    <HorizontalPlanTimeline timeline={timelineOf([node()])} selectedStopId={null} onSelectStop={noop} onOpenPhotos={noop} {...extra} />,
  )
  const card = utils.container.querySelector<HTMLElement>(`.${styles.swipeCard}`)!
  const slide = card.querySelector<HTMLElement>('[data-swipe-slide]')!
  const bar = card.querySelector<HTMLElement>('[data-swipe-bar]')
  return { ...utils, card, slide, bar }
}

// jsdom 的 PointerEvent 不帶座標,改用 MouseEvent 建立同名事件。
const pointer = (target: Element | Window, type: string, x: number, y: number, t = 0, pointerType = 'touch') => {
  const ev = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })
  Object.defineProperty(ev, 'pointerId', { value: 1 })
  Object.defineProperty(ev, 'timeStamp', { value: t })
  Object.defineProperty(ev, 'pointerType', { value: pointerType })
  fireEvent(target, ev)
}

describe('HorizontalPlanTimeline 上滑露出操作列', () => {
  it('沒有提供更換/刪除 callback 時不渲染操作列', () => {
    const { bar } = setup()
    expect(bar).toBeNull()
  })

  it('往上拖過半後放手:展開,操作列可聚焦', () => {
    const { card, slide, bar } = setup({ onRemoveStop: noop })
    expect(bar!.getAttribute('aria-hidden')).toBe('true')
    pointer(card, 'pointerdown', 100, 200, 0)
    pointer(window, 'pointermove', 100, 180, 100)
    pointer(window, 'pointermove', 100, 150, 400)
    expect(slide.style.getPropertyValue('--swipe-r')).toBe('50px')
    pointer(window, 'pointerup', 100, 150, 800)
    expect(slide.style.getPropertyValue('--swipe-r')).toBe('68px')
    expect(bar!.getAttribute('aria-hidden')).toBe('false')
  })

  it('水平拖曳不展開', () => {
    const { card, slide } = setup({ onRemoveStop: noop })
    pointer(card, 'pointerdown', 100, 200, 0)
    pointer(window, 'pointermove', 60, 198, 50)
    pointer(window, 'pointerup', 60, 198, 100)
    expect(slide.style.getPropertyValue('--swipe-r')).toBe('')
  })

  it('點操作列的刪除:呼叫 onRemoveStop 並收合', () => {
    const onRemoveStop = vi.fn()
    const { card, slide, getByText } = setup({ onRemoveStop })
    pointer(card, 'pointerdown', 100, 200, 0)
    pointer(window, 'pointermove', 100, 120, 100)
    pointer(window, 'pointerup', 100, 120, 120)
    // 手勢結束後補發的 click 會被吞掉;接著真正點按鈕(pointerdown 會重設 flag)才算數。
    fireEvent.click(card)
    pointer(getByText('刪除'), 'pointerdown', 100, 120, 200)
    pointer(window, 'pointerup', 100, 120, 220)
    fireEvent.click(getByText('刪除'))
    expect(onRemoveStop).toHaveBeenCalledWith('s1')
    expect(slide.style.getPropertyValue('--swipe-r')).toBe('0px')
  })

  it('滑鼠水平拖曳:手動捲動卡片列;觸控水平拖曳交給瀏覽器不動 scrollLeft', () => {
    const { card, container } = setup({ onRemoveStop: noop })
    const scroller = container.querySelector<HTMLElement>(`.${styles.scroller}`)!
    scroller.scrollLeft = 100
    pointer(card, 'pointerdown', 100, 200, 0, 'mouse')
    pointer(window, 'pointermove', 60, 199, 50, 'mouse')
    pointer(window, 'pointermove', 40, 199, 100, 'mouse')
    expect(scroller.scrollLeft).toBe(160)
    expect(scroller.style.scrollSnapType).toBe('none')
    pointer(window, 'pointerup', 40, 199, 150, 'mouse')

    scroller.scrollLeft = 100
    pointer(card, 'pointerdown', 100, 200, 300, 'touch')
    pointer(window, 'pointermove', 40, 199, 350, 'touch')
    expect(scroller.scrollLeft).toBe(100)
  })

  it('提供 onReplaceStop 時操作列有「更換地點」,點了呼叫並收合', () => {
    const onReplaceStop = vi.fn()
    const { card, slide, getByText } = setup({ onReplaceStop })
    pointer(card, 'pointerdown', 100, 200, 0)
    pointer(window, 'pointermove', 100, 120, 100)
    pointer(window, 'pointerup', 100, 120, 120)
    fireEvent.click(card)
    pointer(getByText('更換地點'), 'pointerdown', 100, 120, 200)
    pointer(window, 'pointerup', 100, 120, 220)
    fireEvent.click(getByText('更換地點'))
    expect(onReplaceStop).toHaveBeenCalledWith('s1')
    expect(slide.style.getPropertyValue('--swipe-r')).toBe('0px')
  })

  it('只提供 onPanToStop 時不啟用上滑操作列(「移動到此」不在操作列裡)', () => {
    const { bar } = setup({ onPanToStop: noop })
    expect(bar).toBeNull()
  })

  it('垂直手勢中途被中斷(pointercancel):回到手勢開始前的狀態,不留在半開', () => {
    const { card, slide } = setup({ onRemoveStop: noop })
    pointer(card, 'pointerdown', 100, 200, 0)
    pointer(window, 'pointermove', 100, 160, 100)
    expect(slide.style.getPropertyValue('--swipe-r')).toBe('40px')
    expect(slide.hasAttribute('data-swiping')).toBe(true)
    pointer(window, 'pointercancel', 100, 160, 120)
    expect(slide.style.getPropertyValue('--swipe-r')).toBe('0px')
    expect(slide.hasAttribute('data-swiping')).toBe(false)
  })

  it('已展開的卡再被拖動後中斷:回到展開位(不是收合)', () => {
    const { card, slide } = setup({ onRemoveStop: noop })
    pointer(card, 'pointerdown', 100, 200, 0)
    pointer(window, 'pointermove', 100, 120, 100)
    pointer(window, 'pointerup', 100, 120, 120)
    expect(slide.style.getPropertyValue('--swipe-r')).toBe('68px')
    fireEvent.click(card) // 吞掉補發的 click
    pointer(card, 'pointerdown', 100, 200, 300)
    pointer(window, 'pointermove', 100, 230, 400) // 往下拉
    pointer(window, 'pointercancel', 100, 230, 420)
    expect(slide.style.getPropertyValue('--swipe-r')).toBe('68px')
  })

  it('觸控的水平拖曳被瀏覽器接手(pointercancel):不展開、不留下手勢狀態,下一次手勢照常運作', () => {
    const { card, slide } = setup({ onRemoveStop: noop })
    pointer(card, 'pointerdown', 100, 200, 0, 'touch')
    pointer(window, 'pointermove', 40, 198, 50, 'touch')
    pointer(window, 'pointercancel', 40, 198, 60, 'touch')
    expect(slide.style.getPropertyValue('--swipe-r')).toBe('')
    pointer(card, 'pointerdown', 100, 200, 300, 'touch')
    pointer(window, 'pointermove', 100, 120, 400, 'touch')
    pointer(window, 'pointerup', 100, 120, 420, 'touch')
    expect(slide.style.getPropertyValue('--swipe-r')).toBe('68px')
  })

  it('元件卸載時移除進行中手勢的全域監聽(之後的指標事件不報錯、不改狀態)', () => {
    const { card, slide, unmount } = setup({ onRemoveStop: noop })
    pointer(card, 'pointerdown', 100, 200, 0)
    unmount()
    expect(() => {
      pointer(window, 'pointermove', 100, 100, 50)
      pointer(window, 'pointerup', 100, 100, 60)
    }).not.toThrow()
    expect(slide.style.getPropertyValue('--swipe-r')).toBe('')
  })
})
