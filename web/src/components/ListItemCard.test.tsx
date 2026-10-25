// ListItemCard 的 PhotoLeading——改用 FramedImage 之後:沒有照片仍渲染同 class 外框佔位、
// 照片載入完成/失敗外框 class 與元素不變、失敗退回佔位(不露破圖)、
// IntersectionObserver 延遲載入行為(掛在外框上、進入視窗才呼叫 onLoadPhoto 一次、
// 已知 photoUrl 時不啟動)、呼叫後到照片到之前顯示掃光(pending)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, fireEvent } from '@testing-library/react'
import { PhotoLeading } from './ListItemCard'

type IOCallback = (entries: { isIntersecting: boolean }[]) => void
const observers: { cb: IOCallback; targets: Element[]; disconnected: boolean }[] = []

class FakeIntersectionObserver {
  rec: { cb: IOCallback; targets: Element[]; disconnected: boolean }
  constructor(cb: IOCallback) {
    this.rec = { cb, targets: [], disconnected: false }
    observers.push(this.rec)
  }
  observe(el: Element) { this.rec.targets.push(el) }
  unobserve() {}
  disconnect() { this.rec.disconnected = true }
  takeRecords() { return [] }
}

beforeEach(() => {
  observers.length = 0
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const cls = { photoClassName: 'itemPhoto', placeholderClassName: 'itemPhotoPlaceholder' }
const frameOf = (c: HTMLElement) => c.firstElementChild as HTMLElement

describe('PhotoLeading', () => {
  it('沒有照片(null)也渲染外框佔位,外框帶呼叫端 class、沒有 img、不掃光', () => {
    const { container } = render(<PhotoLeading name="九份" photoUrl={null} {...cls} />)
    const frame = frameOf(container)
    expect(frame.classList.contains('itemPhoto')).toBe(true)
    expect(frame.classList.contains('itemPhotoPlaceholder')).toBe(true)
    expect(frame.dataset.status).toBe('idle')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[data-skeleton="block"]')).toBeNull()
  })

  it('不覆寫呼叫端 class 決定的寬度與圓角(外框沒有 inline width/border-radius)', () => {
    const { container } = render(<PhotoLeading name="九份" photoUrl="/a.jpg" {...cls} />)
    const frame = frameOf(container)
    expect(frame.style.width).toBe('')
    expect(frame.style.borderRadius).toBe('')
  })

  it('照片載入完成:外框元素與 class 不變,img 帶 alt 與 lazy', () => {
    const { container } = render(<PhotoLeading name="九份" photoUrl="/a.jpg" {...cls} />)
    const frame = frameOf(container)
    const className = frame.className
    expect(frame.dataset.status).toBe('loading')
    const img = container.querySelector('img')!
    expect(img.getAttribute('alt')).toBe('九份')
    expect(img.getAttribute('loading')).toBe('lazy')
    fireEvent.load(img)
    expect(frameOf(container)).toBe(frame)
    expect(frame.className).toBe(className)
    expect(frame.dataset.status).toBe('loaded')
  })

  it('照片載入失敗:退回同外框佔位(錯誤圖示)、img 移除,外框 class 不變', () => {
    const { container, getByTestId } = render(<PhotoLeading name="九份" photoUrl="/broken.jpg" {...cls} />)
    const frame = frameOf(container)
    const className = frame.className
    fireEvent.error(container.querySelector('img')!)
    expect(frameOf(container)).toBe(frame)
    expect(frame.className).toBe(className)
    expect(frame.dataset.status).toBe('error')
    expect(container.querySelector('img')).toBeNull()
    expect(getByTestId('framed-image-error-icon')).toBeInTheDocument()
  })

  it('延遲載入:observer 掛在外框上,進入視窗才呼叫 onLoadPhoto 一次並斷開;呼叫後到照片到之前掃光', () => {
    const onLoadPhoto = vi.fn()
    const { container, rerender } = render(
      <PhotoLeading name="九份" photoUrl={undefined} loadKey="p1" onLoadPhoto={onLoadPhoto} {...cls} />,
    )
    const frame = frameOf(container)
    expect(observers).toHaveLength(1)
    expect(observers[0].targets).toEqual([frame])
    // 還沒進入視窗:靜態佔位,不掃光
    expect(frame.dataset.status).toBe('idle')
    act(() => observers[0].cb([{ isIntersecting: false }]))
    expect(onLoadPhoto).not.toHaveBeenCalled()
    act(() => observers[0].cb([{ isIntersecting: true }]))
    expect(onLoadPhoto).toHaveBeenCalledTimes(1)
    expect(onLoadPhoto).toHaveBeenCalledWith('p1')
    expect(observers[0].disconnected).toBe(true)
    // 查詢中:掃光
    expect(frame.dataset.status).toBe('loading')
    expect(container.querySelector('[data-skeleton="block"]')).not.toBeNull()
    // 查到沒有照片:回到靜態佔位,同一個外框
    rerender(<PhotoLeading name="九份" photoUrl={null} loadKey="p1" onLoadPhoto={onLoadPhoto} {...cls} />)
    expect(frameOf(container)).toBe(frame)
    expect(frame.dataset.status).toBe('idle')
  })

  it('photoUrl 已知時不啟動 IntersectionObserver', () => {
    render(<PhotoLeading name="九份" photoUrl="/a.jpg" loadKey="p1" onLoadPhoto={vi.fn()} {...cls} />)
    render(<PhotoLeading name="九份" photoUrl={null} loadKey="p2" onLoadPhoto={vi.fn()} {...cls} />)
    expect(observers).toHaveLength(0)
  })

  it('卸載時 observer 斷開', () => {
    const { unmount } = render(<PhotoLeading name="九份" loadKey="p1" onLoadPhoto={vi.fn()} {...cls} />)
    expect(observers).toHaveLength(1)
    expect(observers[0].disconnected).toBe(false)
    unmount()
    expect(observers[0].disconnected).toBe(true)
  })

  it('同一實例換 loadKey:requested 重置(回到 idle 不掃光),並對新外框建立新的 observer', () => {
    const onLoadPhoto = vi.fn()
    const { container, rerender } = render(
      <PhotoLeading name="九份" loadKey="p1" onLoadPhoto={onLoadPhoto} {...cls} />,
    )
    act(() => observers[0].cb([{ isIntersecting: true }]))
    expect(frameOf(container).dataset.status).toBe('loading')
    rerender(<PhotoLeading name="金瓜石" loadKey="p2" onLoadPhoto={onLoadPhoto} {...cls} />)
    expect(frameOf(container).dataset.status).toBe('idle')
    expect(observers).toHaveLength(2)
    expect(observers[1].targets).toEqual([frameOf(container)])
    act(() => observers[1].cb([{ isIntersecting: true }]))
    expect(onLoadPhoto).toHaveBeenLastCalledWith('p2')
    expect(frameOf(container).dataset.status).toBe('loading')
  })

  it('photoUrl 從已知值被重設回 undefined:requested 重置,還沒進視窗前不掃光', () => {
    const onLoadPhoto = vi.fn()
    const { container, rerender } = render(
      <PhotoLeading name="九份" loadKey="p1" onLoadPhoto={onLoadPhoto} {...cls} />,
    )
    act(() => observers[0].cb([{ isIntersecting: true }]))
    rerender(<PhotoLeading name="九份" photoUrl={null} loadKey="p1" onLoadPhoto={onLoadPhoto} {...cls} />)
    rerender(<PhotoLeading name="九份" photoUrl={undefined} loadKey="p1" onLoadPhoto={onLoadPhoto} {...cls} />)
    expect(frameOf(container).dataset.status).toBe('idle')
    expect(observers).toHaveLength(2)
  })

  it('外框用 FramedImage 的 unstyled(不靠 style 傳 undefined)', () => {
    const { container } = render(<PhotoLeading name="九份" photoUrl={null} {...cls} />)
    expect(frameOf(container).getAttribute('style') ?? '').toBe('')
  })
})
