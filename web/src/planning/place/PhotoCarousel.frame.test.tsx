// PhotoCarousel 的固定尺寸站位——照片「還沒有 / 下載中 / 已載入 / 下載
// 失敗」四種狀態外框都要在、class 不變,佔位元素只在內層切換,避免圖片
// 出現或失敗時卡片高度改變、下方內容跳動(見 PhotoCarousel.tsx 的
// CarouselImg 說明)。jsdom 不做版面計算,這裡只斷言 DOM 結構與 class
// (結構契約);實際像素高度不在本測試範圍,需要時另以瀏覽器量測。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { PhotoCarousel, CarouselImg } from './PhotoCarousel'
import styles from './PhotoCarousel.module.css'

class FakeIntersectionObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}
vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)

function mockMatchMedia(isDesktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isDesktop,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => mockMatchMedia(true))

// 2026-10 CarouselImg 改用共用的 components/FramedImage:外框是同一個元素、
// class 不變,狀態寫在 data-status;掃光是 [data-skeleton="block"],失敗佔位
// 帶 ImageOff 圖示(data-testid="framed-image-error-icon")。高度 160px 以
// inline style 給定。
// 0 張照片時依 photoStatus 決定掃光或靜態佔位(見 PlaceInfoContent.photoStatus):
// 'pending' 才掃光;'none'/'failed'/undefined(已是最終結果,確定沒照片)是靜態
// 佔位,不再「0 張一律 loading」——那會讓確定沒照片的地點永遠掃光。
describe('PhotoCarousel 沒有照片時仍渲染站位外框', () => {
  it('0 張照片 + photoStatus=pending:.wrap 外框內是 160px 高的掃光佔位,沒有 <img>', () => {
    const { container } = render(<PhotoCarousel alt="地點" photoStatus="pending" />)
    const wrap = container.firstElementChild as HTMLElement
    expect(wrap.className).toBe(styles.wrap)
    const frame = wrap.firstElementChild as HTMLElement
    expect(frame.dataset.status).toBe('loading')
    expect(frame.style.height).toBe('160px')
    expect(frame.querySelector('[data-skeleton="block"]')).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it.each([['none'], ['failed'], [undefined]] as const)(
    '0 張照片 + photoStatus=%s:同一個 160px 外框,但是靜態佔位(不掃光)',
    (photoStatus) => {
      const { container } = render(<PhotoCarousel alt="地點" photoStatus={photoStatus} />)
      const wrap = container.firstElementChild as HTMLElement
      expect(wrap.className).toBe(styles.wrap)
      const frame = wrap.firstElementChild as HTMLElement
      expect(frame.dataset.status).toBe('idle')
      expect(frame.style.height).toBe('160px')
      expect(frame.querySelector('[data-skeleton="block"]')).toBeNull()
      expect(container.querySelector('img')).toBeNull()
    },
  )

  it('查詢中 → 確定沒照片:外框節點不變,掃光換成靜態佔位', () => {
    const { container, rerender } = render(<PhotoCarousel alt="地點" photoStatus="pending" />)
    const frame = (container.firstElementChild as HTMLElement).firstElementChild as HTMLElement
    rerender(<PhotoCarousel alt="地點" photoStatus="none" />)
    expect((container.firstElementChild as HTMLElement).firstElementChild).toBe(frame)
    expect(frame.dataset.status).toBe('idle')
  })

  it('照片從無到有:最外層 .wrap 是同一個節點、class 不變', () => {
    const { container, rerender } = render(<PhotoCarousel alt="地點" photoStatus="pending" />)
    const wrapBefore = container.firstElementChild as HTMLElement
    rerender(<PhotoCarousel alt="地點" googlePhotoUrls={['https://example.com/a.jpg']} />)
    const wrapAfter = container.firstElementChild as HTMLElement
    expect(wrapAfter.className).toBe(styles.wrap)
    expect(wrapAfter).toBe(wrapBefore)
    const frame = wrapAfter.firstElementChild as HTMLElement
    expect(frame.dataset.status).toBe('loading')
    expect(frame.querySelector('img')).not.toBeNull()
  })
})

describe('CarouselImg 下載中 / 已載入 / 失敗都佔同一個外框', () => {
  it('下載中:外框 160px 高、有掃光佔位,<img> 尚未淡入', () => {
    const { container } = render(<CarouselImg src="https://example.com/a.jpg" alt="地點" />)
    const frame = container.firstElementChild as HTMLElement
    expect(frame.style.height).toBe('160px')
    expect(frame.dataset.status).toBe('loading')
    expect(frame.querySelector('[data-skeleton="block"]')).not.toBeNull()
  })

  it('載入完成:佔位移除、<img> 淡入,外框節點與 class 不變', () => {
    const { container } = render(<CarouselImg src="https://example.com/a.jpg" alt="地點" />)
    const frame = container.firstElementChild as HTMLElement
    const className = frame.className
    const imgClassBefore = frame.querySelector('img')!.className
    fireEvent.load(frame.querySelector('img')!)
    expect(container.firstElementChild).toBe(frame)
    expect(frame.className).toBe(className)
    expect(frame.dataset.status).toBe('loaded')
    expect(frame.querySelector('[data-skeleton="block"]')).toBeNull()
    expect(frame.querySelector('img')!.className).not.toBe(imgClassBefore)
  })

  it('下載失敗:不顯示破圖 <img>,改顯示同外框內的失敗佔位', () => {
    const { container } = render(<CarouselImg src="https://example.com/broken.jpg" alt="地點" />)
    const frame = container.firstElementChild as HTMLElement
    const className = frame.className
    fireEvent.error(frame.querySelector('img')!)
    expect(container.firstElementChild).toBe(frame)
    expect(frame.className).toBe(className)
    expect(frame.dataset.status).toBe('error')
    expect(frame.querySelector('img')).toBeNull()
    expect(frame.querySelector('[data-testid="framed-image-error-icon"]')).not.toBeNull()
  })

  it('換一張圖(src 改變)時回到下載中狀態', () => {
    const { container, rerender } = render(<CarouselImg src="https://example.com/a.jpg" alt="地點" />)
    const frame = container.firstElementChild as HTMLElement
    fireEvent.error(frame.querySelector('img')!)
    rerender(<CarouselImg src="https://example.com/b.jpg" alt="地點" />)
    expect(frame.dataset.status).toBe('loading')
    expect(frame.querySelector('img')!.getAttribute('src')).toBe('https://example.com/b.jpg')
  })
})
