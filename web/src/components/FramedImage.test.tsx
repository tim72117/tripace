// FramedImage——pending(還不知道 src)各組合、轉傳外框 ref、rest 屬性轉傳規則;五種狀態(無 src、載入中、完成、失敗、換 src)外框 class 不變、img 出現與否、淡入 class、
// 失敗圖示、onLoad/onError 呼叫,以及快取命中(img.complete)由 callback ref 補判。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { StrictMode, createRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { FramedImage } from './FramedImage'
import styles from './FramedImage.module.css'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function frameOf(container: HTMLElement) {
  return container.firstElementChild as HTMLElement
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FramedImage', () => {
  it('無 src:靜態佔位、沒有 img、外框尺寸照 props', () => {
    const { container } = render(<FramedImage alt="清水寺" width={120} aspectRatio="4 / 3" radius="md" />)
    const frame = frameOf(container)
    expect(frame.dataset.status).toBe('idle')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[data-skeleton="block"]')).toBeNull()
    expect(frame.style.width).toBe('120px')
    expect(frame.style.aspectRatio).toBe('4 / 3')
    expect(frame.style.borderRadius).toBe('8px')
  })

  it('自訂 placeholder 取代預設圖示', () => {
    render(<FramedImage alt="x" height={40} placeholder={<span data-testid="glyph">楓</span>} />)
    expect(screen.getByTestId('glyph')).toBeInTheDocument()
  })

  it('載入中 → 完成:掃光佔位、img 透明;load 後加淡入 class、拿掉佔位、呼叫 onLoad 一次', () => {
    const onLoad = vi.fn()
    const { container } = render(<FramedImage src="/a.jpg" alt="A" height={100} onLoad={onLoad} className="ext" />)
    const frame = frameOf(container)
    const frameClass = frame.className
    expect(frame.dataset.status).toBe('loading')
    expect(container.querySelector('[data-skeleton="block"]')).not.toBeNull()
    const img = screen.getByAltText('A')
    const baseImgClass = img.className
    fireEvent.load(img)
    expect(frame.dataset.status).toBe('loaded')
    expect(frame.className).toBe(frameClass)
    expect(frame).toHaveClass('ext')
    expect(container.querySelector('[data-skeleton="block"]')).toBeNull()
    expect(baseImgClass).toBe(styles.img)
    expect(img.className).toBe(`${styles.img} ${styles.imgLoaded}`)
    expect(frame.className).toBe(`${styles.frame} ext`)
    fireEvent.load(img)
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('失敗:拿掉 img、顯示 ImageOff 圖示、不掃光、外框 class 不變、呼叫 onError', () => {
    const onError = vi.fn()
    const { container } = render(<FramedImage src="/bad.jpg" alt="壞圖" height={100} onError={onError} />)
    const frame = frameOf(container)
    const frameClass = frame.className
    fireEvent.error(screen.getByAltText('壞圖'))
    expect(frame.dataset.status).toBe('error')
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByTestId('framed-image-error-icon')).toBeInTheDocument()
    expect(container.querySelector('[data-skeleton="block"]')).toBeNull()
    expect(frame.className).toBe(frameClass)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('換 src:重新進入載入中(新 img、沒有淡入 class);換回舊 src 也會重新判定', () => {
    const onLoad = vi.fn()
    const { container, rerender } = render(<FramedImage src="/a.jpg" alt="P" height={80} onLoad={onLoad} />)
    const frame = frameOf(container)
    const frameClass = frame.className
    const firstImg = screen.getByAltText('P')
    const baseImgClass = firstImg.className
    fireEvent.load(firstImg)
    expect(frame.dataset.status).toBe('loaded')

    rerender(<FramedImage src="/b.jpg" alt="P" height={80} onLoad={onLoad} />)
    expect(frame.dataset.status).toBe('loading')
    const secondImg = screen.getByAltText('P')
    expect(secondImg).not.toBe(firstImg)
    expect(secondImg.className).toBe(baseImgClass)
    expect(secondImg.className).toBe(styles.img)
    expect(frame.className).toBe(frameClass)
    fireEvent.load(secondImg)

    rerender(<FramedImage src="/a.jpg" alt="P" height={80} onLoad={onLoad} />)
    expect(frame.dataset.status).toBe('loading')
    fireEvent.load(screen.getByAltText('P'))
    expect(frame.dataset.status).toBe('loaded')
    expect(onLoad).toHaveBeenCalledTimes(3)

    rerender(<FramedImage src={null} alt="P" height={80} />)
    expect(frame.dataset.status).toBe('idle')
    expect(container.querySelector('img')).toBeNull()
  })

  it('快取命中:img 掛上時已 complete 且有尺寸 → 直接 loaded,onLoad 只呼叫一次', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(640)
    const onLoad = vi.fn()
    const { container } = render(<FramedImage src="/cached.jpg" alt="C" height={80} onLoad={onLoad} />)
    expect(frameOf(container).dataset.status).toBe('loaded')
    fireEvent.load(screen.getByAltText('C'))
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('快取命中但已失敗(complete 且 naturalWidth 為 0)→ error', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0)
    const onError = vi.fn()
    const { container } = render(<FramedImage src="/gone.jpg" alt="G" height={80} onError={onError} />)
    expect(frameOf(container).dataset.status).toBe('error')
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('轉傳 loading/decoding/fetchpriority 與 fit', () => {
    render(<FramedImage src="/a.jpg" alt="F" height={80} loading="lazy" decoding="async" fetchPriority="high" fit="contain" imgClassName="mine" />)
    const img = screen.getByAltText('F')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveAttribute('decoding', 'async')
    expect(img).toHaveAttribute('fetchpriority', 'high')
    expect(img).toHaveClass('mine')
    expect(img.style.objectFit).toBe('contain')
  })
  describe('pending', () => {
    it('無 src + pending:loading、掃光佔位、沒有靜態佔位圖示與 img', () => {
      const { container } = render(<FramedImage alt="x" height={80} pending />)
      expect(frameOf(container).dataset.status).toBe('loading')
      expect(container.querySelector('[data-skeleton="block"]')).not.toBeNull()
      expect(container.querySelector('svg')).toBeNull()
      expect(container.querySelector('img')).toBeNull()
    })

    it('pending 轉 false 且仍無 src:轉 idle 靜態佔位;外框 class 全程不變', () => {
      const { container, rerender } = render(<FramedImage alt="x" height={80} className="ext" pending />)
      const frame = frameOf(container)
      const frameClass = frame.className
      rerender(<FramedImage alt="x" height={80} className="ext" pending={false} />)
      expect(frame.dataset.status).toBe('idle')
      expect(container.querySelector('[data-skeleton="block"]')).toBeNull()
      expect(container.querySelector('svg')).not.toBeNull()
      expect(frame.className).toBe(frameClass)
      expect(frame.style.height).toBe('80px')
    })

    it('pending 為 true 時 src 到手:以 src 載入狀態為準(loading → loaded)', () => {
      const { container, rerender } = render(<FramedImage alt="P" height={80} pending />)
      const frame = frameOf(container)
      rerender(<FramedImage src="/a.jpg" alt="P" height={80} pending />)
      expect(frame.dataset.status).toBe('loading')
      fireEvent.load(screen.getByAltText('P'))
      expect(frame.dataset.status).toBe('loaded')
    })

    it('有 src 時忽略 pending:載入失敗仍是 error', () => {
      const { container } = render(<FramedImage src="/bad.jpg" alt="B" height={80} pending />)
      fireEvent.error(screen.getByAltText('B'))
      expect(frameOf(container).dataset.status).toBe('error')
    })

    it('src 被清掉且 pending:回到 loading(掃光)', () => {
      const { container, rerender } = render(<FramedImage src="/a.jpg" alt="P" height={80} />)
      rerender(<FramedImage src={null} alt="P" height={80} pending />)
      expect(frameOf(container).dataset.status).toBe('loading')
      expect(container.querySelector('img')).toBeNull()
    })
  })

  describe('ref 與 rest', () => {
    it('ref 取得外框元素(不是 img)', () => {
      const ref = createRef<HTMLSpanElement>()
      const { container } = render(<FramedImage ref={ref} src="/a.jpg" alt="R" height={80} />)
      expect(ref.current).toBe(frameOf(container))
      expect(ref.current?.tagName).toBe('SPAN')
    })

    it('callback ref 也可用,且不影響快取命中補判', () => {
      vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
      vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(100)
      const cb = vi.fn()
      const { container } = render(<FramedImage ref={cb} src="/c.jpg" alt="C" height={80} />)
      expect(cb).toHaveBeenCalledWith(frameOf(container))
      expect(frameOf(container).dataset.status).toBe('loaded')
    })

    it('rest 的 data-*/aria-*/onClick 轉到外框', () => {
      const onClick = vi.fn()
      const { container } = render(
        <FramedImage alt="x" height={80} data-testid="fi" data-foo="1" aria-label="封面" onClick={onClick} />,
      )
      const frame = frameOf(container)
      expect(screen.getByTestId('fi')).toBe(frame)
      expect(frame.dataset.foo).toBe('1')
      expect(frame).toHaveAttribute('aria-label', '封面')
      fireEvent.click(frame)
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('rest 不覆蓋內部屬性:data-status、class 與尺寸 style 以內部為準', () => {
      const props = { 'data-status': 'hacked' } as Record<string, string>
      const { container } = render(<FramedImage alt="x" width={50} height={80} className="ext" {...props} />)
      const frame = frameOf(container)
      expect(frame.dataset.status).toBe('idle')
      expect(frame).toHaveClass('ext')
      expect(frame.style.width).toBe('50px')
    })
  })

  describe('無障礙:img 不在時外框代替 img 提供替代文字', () => {
    it('idle 與 error:外框 role=img + aria-label=alt;loading/loaded 不加(img 自己有 alt)', () => {
      const idle = render(<FramedImage alt="清水寺" height={80} />)
      expect(idle.getByRole('img', { name: '清水寺' })).toBe(frameOf(idle.container))
      idle.unmount()

      const { container } = render(<FramedImage src="/a.jpg" alt="清水寺" height={80} />)
      const frame = frameOf(container)
      expect(frame).not.toHaveAttribute('role')
      expect(frame).not.toHaveAttribute('aria-label')
      fireEvent.load(screen.getByAltText('清水寺'))
      expect(frame).not.toHaveAttribute('role')
      expect(screen.getAllByRole('img', { name: '清水寺' })).toHaveLength(1)
      cleanupAndError()

      function cleanupAndError() {
        const bad = render(<FramedImage src="/bad.jpg" alt="壞圖" height={80} />)
        fireEvent.error(bad.getByAltText('壞圖'))
        const badFrame = frameOf(bad.container)
        expect(badFrame).toHaveAttribute('role', 'img')
        expect(badFrame).toHaveAttribute('aria-label', '壞圖')
      }
    })

    it('alt 為空字串(裝飾性):任何狀態都不加 role=img', () => {
      const { container } = render(<FramedImage alt="" height={80} />)
      expect(frameOf(container)).not.toHaveAttribute('role')
      expect(frameOf(container)).not.toHaveAttribute('aria-label')
    })

    it('使用端在 rest 給的 role/aria-label 優先', () => {
      const { container } = render(<FramedImage alt="x" height={80} role="status" aria-label="查詢中" />)
      expect(frameOf(container)).toHaveAttribute('role', 'status')
      expect(frameOf(container)).toHaveAttribute('aria-label', '查詢中')
    })
  })

  describe('unstyled', () => {
    it('不輸出預設的 inline width/border-radius;明確給的尺寸仍輸出', () => {
      const { container } = render(<FramedImage alt="x" unstyled className="c" />)
      const frame = frameOf(container)
      expect(frame.style.width).toBe('')
      expect(frame.style.borderRadius).toBe('')
      const b = render(<FramedImage alt="x" unstyled width={30} radius="md" />)
      expect(frameOf(b.container).style.width).toBe('30px')
      expect(frameOf(b.container).style.borderRadius).toBe('8px')
    })
  })

  describe('事件時序', () => {
    it('StrictMode 下快取命中,onLoad 只呼叫 1 次', () => {
      vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
      vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(10)
      const onLoad = vi.fn()
      render(
        <StrictMode>
          <FramedImage src="/s.jpg" alt="S" height={80} onLoad={onLoad} />
        </StrictMode>,
      )
      fireEvent.load(screen.getByAltText('S'))
      expect(onLoad).toHaveBeenCalledTimes(1)
    })

    it('StrictMode 下一般載入,onLoad 只呼叫 1 次', () => {
      const onLoad = vi.fn()
      render(
        <StrictMode>
          <FramedImage src="/s.jpg" alt="S" height={80} onLoad={onLoad} />
        </StrictMode>,
      )
      fireEvent.load(screen.getByAltText('S'))
      fireEvent.load(screen.getByAltText('S'))
      expect(onLoad).toHaveBeenCalledTimes(1)
    })

    it('載入中卸載,之後原 img 才觸發 load:不報錯、不呼叫 onLoad', () => {
      const onLoad = vi.fn()
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { unmount } = render(<FramedImage src="/a.jpg" alt="U" height={80} onLoad={onLoad} />)
      const img = screen.getByAltText('U')
      unmount()
      expect(() => fireEvent.load(img)).not.toThrow()
      expect(onLoad).not.toHaveBeenCalled()
      expect(errSpy).not.toHaveBeenCalled()
    })

    it('換 src 後,舊 img 晚到的 load 不影響新 src 的狀態', () => {
      const onLoad = vi.fn()
      const { container, rerender } = render(<FramedImage src="/old.jpg" alt="P" height={80} onLoad={onLoad} />)
      const oldImg = screen.getByAltText('P')
      rerender(<FramedImage src="/new.jpg" alt="P" height={80} onLoad={onLoad} />)
      fireEvent.load(oldImg)
      expect(frameOf(container).dataset.status).toBe('loading')
      expect(onLoad).not.toHaveBeenCalled()
      fireEvent.load(screen.getByAltText('P'))
      expect(frameOf(container).dataset.status).toBe('loaded')
      expect(onLoad).toHaveBeenCalledTimes(1)
    })

    it('同一個 img 先 load 再 error:只認第一個(onLoad 1 次、onError 0 次、維持 loaded)', () => {
      const onLoad = vi.fn()
      const onError = vi.fn()
      const { container } = render(<FramedImage src="/a.jpg" alt="E" height={80} onLoad={onLoad} onError={onError} />)
      const img = screen.getByAltText('E')
      fireEvent.load(img)
      fireEvent.error(img)
      expect(onLoad).toHaveBeenCalledTimes(1)
      expect(onError).not.toHaveBeenCalled()
      expect(frameOf(container).dataset.status).toBe('loaded')
    })

    it('同一個 img 先 error 再 load:onError 1 次、onLoad 0 次、維持 error', () => {
      const onLoad = vi.fn()
      const onError = vi.fn()
      const { container } = render(<FramedImage src="/a.jpg" alt="E" height={80} onLoad={onLoad} onError={onError} />)
      const img = screen.getByAltText('E')
      fireEvent.error(img)
      fireEvent.load(img)
      expect(onError).toHaveBeenCalledTimes(1)
      expect(onLoad).not.toHaveBeenCalled()
      expect(frameOf(container).dataset.status).toBe('error')
    })
  })

  it('佔位底色走 --framed-image-placeholder-bg(可放漸層),退回 --skeleton-base', () => {
    const css = readFileSync(resolve(__dirname, 'FramedImage.module.css'), 'utf-8')
    expect(css).toMatch(/\.placeholder\s*\{[^}]*background:\s*var\(--framed-image-placeholder-bg,\s*var\(--skeleton-base,\s*var\(--ios-sep\)\)\)/)
  })
})
