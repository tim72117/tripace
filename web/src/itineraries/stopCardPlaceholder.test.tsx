// 站點卡/美食卡縮圖的「先站位」行為:不論查詢中、沒有照片、有照片、照片載入失敗,縮圖外框都是同一個
// 元素與同一組 class;圖片交給共用 FramedImage(外框 data-status 標 idle/loading/loaded/error),
// 查詢中掃光、沒照片顯示主題佔位、照片載入完成淡入、失敗顯示同尺寸失敗佔位。
// 另外:漸層 thumbBg 不塞進 --skeleton-base(掃光層只吃單色);照片失敗後隱藏放大按鈕;按鈕名稱帶站名;
// 溫泉卡照片載入完成後不再渲染蒸氣動畫。
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import type { StopCardRenderContext } from '../planning/timeline/PlanTimelineView'
import { createRenderItineraryStopCard } from './renderItineraryStopCard'
import { createRenderOnsenAutumnStopCard } from './renderOnsenAutumnStopCard'
import { FoodSpotPanel } from './FoodSpotPanel'
import { stop } from './testUtils'

const frameOf = (root: Element) => root.querySelector('[data-status]') as HTMLElement

function ctxOf(over: Partial<StopCardRenderContext> = {}): StopCardRenderContext {
  return {
    isSelected: false,
    isHovered: false,
    loading: false,
    usablePhotos: [],
    onClick: vi.fn(),
    onMouseEnter: vi.fn(),
    onMouseLeave: vi.fn(),
    onFocus: vi.fn(),
    onBlur: vi.fn(),
    onOpenPhotos: vi.fn(),
    ...over,
  }
}

const STATES: Array<[string, Partial<StopCardRenderContext>]> = [
  ['查詢中', { loading: true }],
  ['沒有照片', {}],
  ['有照片', { usablePhotos: ['https://example.com/a.jpg'] }],
]

describe.each([
  ['renderItineraryStopCard', () => createRenderItineraryStopCard(false), 'stopThumb'],
  ['renderItineraryStopCard(手繪)', () => createRenderItineraryStopCard(true), 'stopThumb'],
  ['renderOnsenAutumnStopCard', () => createRenderOnsenAutumnStopCard(), 'thumb'],
])('%s 縮圖站位', (_name, make, thumbClass) => {
  const step = stop({ name: '測試站', thumbIcon: '⛩️', thumbBg: '#eee' })

  function thumbOf(container: HTMLElement) {
    // 卡片根節點的第一個子元素就是縮圖外框
    return container.firstElementChild!.firstElementChild as HTMLElement
  }

  it('三種狀態的縮圖外框與圖片外框 class 都相同', () => {
    const results = STATES.map(([, over]) => {
      const { container, unmount } = render(<>{make()(step, ctxOf(over))}</>)
      const thumb = thumbOf(container)
      expect(thumb.className).toMatch(new RegExp(`_${thumbClass}_`))
      const frame = frameOf(thumb)
      expect(frame).not.toBeNull()
      const cls = `${thumb.className}|${frame.className}`
      unmount()
      return cls
    })
    expect(new Set(results).size).toBe(1)
  })

  it('沒有照片時不渲染 img,只有靜態佔位(idle)', () => {
    const { container } = render(<>{make()(step, ctxOf())}</>)
    expect(container.querySelector('img')).toBeNull()
    expect(frameOf(thumbOf(container)).dataset.status).toBe('idle')
  })

  it('查詢中:外框帶查詢中的狀態標籤、顯示掃光(pending),不渲染照片', () => {
    const { container, getByRole } = render(<>{make()(step, ctxOf({ loading: true, usablePhotos: ['https://example.com/a.jpg'] }))}</>)
    const status = getByRole('status', { name: '查詢地點資料中' })
    expect(status.dataset.status).toBe('loading')
    expect(container.querySelector('img')).toBeNull()
  })

  it('有照片:照片按鈕疊層(名稱帶站名),載入完成 loaded;失敗 error 且按鈕隱藏(沒有照片可放大)', () => {
    const photo = ctxOf({ usablePhotos: ['https://example.com/a.jpg'] })
    const ok = render(<>{make()(step, photo)}</>)
    expect(ok.getByRole('button', { name: '放大檢視「測試站」的照片' })).toBeTruthy()
    const frame = frameOf(thumbOf(ok.container))
    expect(frame.dataset.status).toBe('loading')
    fireEvent.load(ok.container.querySelector('img')!)
    expect(frame.dataset.status).toBe('loaded')
    expect(frameOf(thumbOf(ok.container))).toBe(frame)
    expect(ok.getByRole('button', { name: '放大檢視「測試站」的照片' })).toBeTruthy()
    ok.unmount()

    const bad = render(<>{make()(step, photo)}</>)
    const badFrame = frameOf(thumbOf(bad.container))
    fireEvent.error(bad.container.querySelector('img')!)
    expect(badFrame.dataset.status).toBe('error')
    expect(bad.container.querySelector('img')).toBeNull()
    expect(bad.queryByRole('button', { name: /照片/ })).toBeNull()
  })

  it('多張照片:按鈕名稱帶站名與張數', () => {
    const { getByRole } = render(<>{make()(step, ctxOf({ usablePhotos: ['https://example.com/a.jpg', 'https://example.com/b.jpg'] }))}</>)
    expect(getByRole('button', { name: '瀏覽「測試站」的 2 張照片' })).toBeTruthy()
  })

  it('照片失敗後換成另一張照片:按鈕重新出現', () => {
    const r = render(<>{make()(step, ctxOf({ usablePhotos: ['https://example.com/a.jpg'] }))}</>)
    fireEvent.error(r.container.querySelector('img')!)
    expect(r.queryByRole('button', { name: /照片/ })).toBeNull()
    r.rerender(<>{make()(step, ctxOf({ usablePhotos: ['https://example.com/b.jpg'] }))}</>)
    expect(r.getByRole('button', { name: '放大檢視「測試站」的照片' })).toBeTruthy()
  })
})

describe('renderItineraryStopCard 縮圖底色與掃光變數', () => {
  const GRADIENT = 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)'

  it('漸層 thumbBg:查詢中佔位層的 --skeleton-base 不是漸層(讓共用掃光生效),仍有掃光層', () => {
    const step = stop({ name: '漸層站', thumbIcon: '⛩️', thumbBg: GRADIENT })
    const { getByRole } = render(<>{createRenderItineraryStopCard(false)(step, ctxOf({ loading: true }))}</>)
    const frame = getByRole('status', { name: '查詢地點資料中' })
    expect(frame.style.getPropertyValue('--skeleton-base')).not.toMatch(/gradient/)
    expect(frame.querySelector('[data-skeleton="block"]')).not.toBeNull()
  })

  it('單色 thumbBg:沿用為 --skeleton-base', () => {
    const step = stop({ name: '單色站', thumbBg: '#eee' })
    const { getByRole } = render(<>{createRenderItineraryStopCard(false)(step, ctxOf({ loading: true }))}</>)
    expect(getByRole('status', { name: '查詢地點資料中' }).style.getPropertyValue('--skeleton-base')).toBe('#eee')
  })

  it('沒照片(idle):佔位底色透明,透出外層 .stopThumb 的 thumbBg(漸層也可以)', () => {
    const step = stop({ name: '漸層站', thumbIcon: '⛩️', thumbBg: GRADIENT })
    const { container } = render(<>{createRenderItineraryStopCard(false)(step, ctxOf())}</>)
    const frame = frameOf(container)
    expect(frame.dataset.status).toBe('idle')
    expect(frame.style.getPropertyValue('--framed-image-placeholder-bg')).toBe('transparent')
  })
})

describe('renderOnsenAutumnStopCard 蒸氣動畫', () => {
  const step = stop({ name: '溫泉站', kind: '景點' })
  const steamOf = (c: HTMLElement) => c.querySelector('svg[class*="_steam_"]')

  it('沒有照片:蒸氣在;有照片下載中:蒸氣仍在;載入完成:不再渲染蒸氣', () => {
    const none = render(<>{createRenderOnsenAutumnStopCard()(step, ctxOf())}</>)
    expect(steamOf(none.container)).not.toBeNull()
    none.unmount()

    const r = render(<>{createRenderOnsenAutumnStopCard()(step, ctxOf({ usablePhotos: ['https://example.com/a.jpg'] }))}</>)
    expect(steamOf(r.container)).not.toBeNull()
    fireEvent.load(r.container.querySelector('img')!)
    expect(steamOf(r.container)).toBeNull()
  })

  it('照片失敗:蒸氣與主題圖樣回來(失敗佔位透出蒸氣)', () => {
    const r = render(<>{createRenderOnsenAutumnStopCard()(step, ctxOf({ usablePhotos: ['https://example.com/a.jpg'] }))}</>)
    fireEvent.error(r.container.querySelector('img')!)
    expect(steamOf(r.container)).not.toBeNull()
  })

  it('佔位與掃光變數:--skeleton-base 是 transparent(有效的單色)', () => {
    const { getByRole } = render(<>{createRenderOnsenAutumnStopCard()(step, ctxOf({ loading: true }))}</>)
    expect(getByRole('status', { name: '查詢地點資料中' }).style.getPropertyValue('--skeleton-base')).toBe('transparent')
  })
})

describe('FoodSpotPanel 縮圖站位', () => {
  const spots = [{ id: 'f1', name: '拉麵店', category: '拉麵', desc: '好吃' }]
  const noop = () => {}

  it('照片還沒查到:有佔位、沒有 img;查到後外框 class 不變、佔位仍在', () => {
    const { container, rerender } = render(
      <FoodSpotPanel spots={spots as never} detailsById={{}} selectedSpotId={null} onSelectSpot={noop} onHoverSpot={noop} />,
    )
    const thumbBefore = container.querySelector('[class*="_thumb_"]') as HTMLElement
    expect(thumbBefore.textContent).toContain('🍽️')
    expect(container.querySelector('img')).toBeNull()
    const classBefore = thumbBefore.className

    rerender(
      <FoodSpotPanel
        spots={spots as never}
        detailsById={{ f1: { photoUrl: 'https://example.com/r.jpg', lat: 1, lng: 2 } }}
        selectedSpotId={null}
        onSelectSpot={noop}
        onHoverSpot={noop}
      />,
    )
    const thumbAfter = container.querySelector('[class*="_thumb_"]') as HTMLElement
    expect(thumbAfter.className).toBe(classBefore)
    const frame = frameOf(thumbAfter)
    expect(frame.dataset.status).toBe('loading')
    fireEvent.error(thumbAfter.querySelector('img')!)
    expect(frame.dataset.status).toBe('error')
    expect(thumbAfter.querySelector('img')).toBeNull()
  })

  it('佔位與掃光變數:--skeleton-base 是 var(--ios-active)(有效的單色)', () => {
    const { container } = render(
      <FoodSpotPanel spots={spots as never} detailsById={{}} selectedSpotId={null} onSelectSpot={noop} onHoverSpot={noop} />,
    )
    expect(frameOf(container).style.getPropertyValue('--skeleton-base')).toBe('var(--ios-active)')
  })
})
