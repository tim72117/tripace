// Skeleton——尺寸/aria 輸出、行寬比例固定可重現、Region 只宣告一次、Mask 不加任何影響尺寸的 inline style;
// 讀屏宣告(live region 先空、延後填入文字)、inert 在第一幀就生效;CSS 結構斷言(讀原始 CSS):遮罩對齊 content-box、
// 掃光變數在子孫才解析、不用 box-decoration-break、不支援 :has() 時的退化規則。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useLayoutEffect, useRef } from 'react'
import styles from './Skeleton.module.css'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  SkeletonBlock,
  SkeletonLines,
  SkeletonRegion,
  SkeletonMask,
  skeletonLineWidths,
  resolveRadius,
  SKELETON_LINE_WIDTHS,
  SKELETON_STATUS_FILL_DELAY_MS,
} from './Skeleton'

afterEach(() => {
  vi.useRealTimers()
})

describe('SkeletonBlock', () => {
  it('數字視為 px、字串原樣輸出,並預設 aria-hidden', () => {
    const { container } = render(<SkeletonBlock width={64} height="1.2em" radius="full" />)
    const el = container.firstElementChild as HTMLElement
    expect(el).toHaveAttribute('aria-hidden', 'true')
    expect(el.style.width).toBe('64px')
    expect(el.style.height).toBe('1.2em')
    expect(el.style.borderRadius).toBe('999px')
  })

  it('支援 %、CSS 變數與 aspectRatio', () => {
    const { container } = render(<SkeletonBlock width="var(--thumb-size)" aspectRatio="16 / 9" radius={10} />)
    const el = container.firstElementChild as HTMLElement
    expect(el.style.width).toBe('var(--thumb-size)')
    expect(el.style.aspectRatio).toBe('16 / 9')
    expect(el.style.borderRadius).toBe('10px')
  })

  it("animation='none' 與預設 sweep 用不同 class", () => {
    const { container } = render(
      <>
        <SkeletonBlock width={10} height={10} />
        <SkeletonBlock width={10} height={10} animation="none" />
      </>,
    )
    const [a, b] = Array.from(container.children)
    expect(a).toHaveClass(styles.block, styles.sweep)
    expect(a).not.toHaveClass(styles.still)
    expect(b).toHaveClass(styles.block, styles.still)
    expect(b).not.toHaveClass(styles.sweep)
  })

  it('resolveRadius 換算具名級距與任意值', () => {
    expect(resolveRadius('none')).toBe('0')
    expect(resolveRadius('sm')).toBe('4px')
    expect(resolveRadius('lg')).toBe('16px')
    expect(resolveRadius('50%')).toBe('50%')
    expect(resolveRadius(undefined)).toBeUndefined()
  })
})

describe('SkeletonLines', () => {
  function barWidths(container: HTMLElement) {
    return Array.from(container.querySelectorAll('[data-skeleton-line] > span')).map(
      (el) => (el as HTMLElement).style.width,
    )
  }

  it('行數正確、最後一行用 lastLineWidth、其餘依固定比例組', () => {
    const { container } = render(<SkeletonLines lines={4} lastLineWidth="45%" />)
    expect(container.querySelectorAll('[data-skeleton-line]')).toHaveLength(4)
    expect(barWidths(container)).toEqual([...SKELETON_LINE_WIDTHS.slice(0, 3), '45%'])
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('多次渲染行寬完全相同(不隨機)', () => {
    const a = render(<SkeletonLines lines={7} />)
    const first = barWidths(a.container)
    a.rerender(<SkeletonLines lines={7} />)
    expect(barWidths(a.container)).toEqual(first)
    const b = render(<SkeletonLines lines={7} />)
    expect(barWidths(b.container)).toEqual(first)
    expect(skeletonLineWidths(7)).toEqual(first)
  })

  it('單行時即 lastLineWidth;lineHeight/gap 轉成 CSS', () => {
    expect(skeletonLineWidths(1)).toEqual(['60%'])
    expect(skeletonLineWidths(0)).toEqual([])
    const { container } = render(<SkeletonLines lines={2} lineHeight={20} gap="4px" />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.getPropertyValue('--skeleton-line-height')).toBe('20px')
    expect(root.style.rowGap).toBe('4px')
  })
})

describe('SkeletonRegion', () => {
  it('輸出 role=status、aria-label(不帶 aria-busy,避免壓住通知),子節點包在 aria-hidden 裡', () => {
    render(
      <SkeletonRegion label="行程清單載入中" className="grid">
        <SkeletonBlock width={10} height={10} />
        <SkeletonLines lines={2} />
      </SkeletonRegion>,
    )
    const region = screen.getByRole('status', { name: '行程清單載入中' })
    expect(region).not.toHaveAttribute('aria-busy')
    expect(region).toHaveClass('grid')
    const inner = region.firstElementChild as HTMLElement
    expect(inner).toHaveAttribute('aria-hidden', 'true')
    expect(inner).toHaveClass(styles.contents)
    expect(inner.querySelectorAll('[data-skeleton]')).toHaveLength(2)
    // 整頁只有一個 status(內部的可讀文字不是另一個 live region)
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('live region 掛載時先空,延後才填入 label 文字(讓讀屏把它當成內容變動唸出)', () => {
    vi.useFakeTimers()
    render(
      <SkeletonRegion label="簡介載入中">
        <SkeletonBlock width={10} height={10} />
      </SkeletonRegion>,
    )
    const region = screen.getByRole('status', { name: '簡介載入中' })
    expect(region.textContent).toBe('')
    act(() => {
      vi.advanceTimersByTime(SKELETON_STATUS_FILL_DELAY_MS)
    })
    expect(region.textContent).toBe('簡介載入中')
    const text = Array.from(region.children).find((el) => el.textContent === '簡介載入中') as HTMLElement
    expect(text).toHaveClass(styles.srOnly)
    expect(text).not.toHaveAttribute('aria-hidden')
  })
})

describe('SkeletonMask', () => {
  function Card() {
    return (
      <article className="card">
        <h3>清水寺</h3>
        <p>京都東山</p>
        <button type="button">加入</button>
        <span className="skeleton-keep">Day 1</span>
      </article>
    )
  }

  it('loading:內容包在 aria-hidden + inert 的遮罩層,另有一個 status 唸 label(先空、延後填入)', () => {
    vi.useFakeTimers()
    const { container } = render(
      <SkeletonMask loading label="地點載入中">
        <Card />
      </SkeletonMask>,
    )
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('')
    act(() => {
      vi.advanceTimersByTime(SKELETON_STATUS_FILL_DELAY_MS)
    })
    expect(status).toHaveTextContent('地點載入中')
    expect(status).toHaveClass(styles.srOnly)
    expect(status).not.toHaveAttribute('aria-busy')
    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveAttribute('data-loading')
    const content = container.querySelector('article')!.parentElement as HTMLElement
    expect(content).toHaveAttribute('aria-hidden', 'true')
    expect(content.hasAttribute('inert')).toBe(true)
    // 隱藏後按鈕不再被輔助科技找到
    expect(screen.queryByRole('button', { name: '加入' })).toBeNull()
  })

  it('非 loading:沒有 status、沒有 aria-hidden/inert,class 與 loading 時不同', () => {
    const { container, rerender } = render(
      <SkeletonMask loading>
        <Card />
      </SkeletonMask>,
    )
    const loadingClass = container.querySelector('article')!.parentElement!.className
    rerender(
      <SkeletonMask loading={false}>
        <Card />
      </SkeletonMask>,
    )
    const content = container.querySelector('article')!.parentElement as HTMLElement
    expect(screen.queryByRole('status')).toBeNull()
    expect(content).not.toHaveAttribute('aria-hidden')
    expect(content.hasAttribute('inert')).toBe(false)
    expect(loadingClass).toBe(`${styles.contents} ${styles.maskLoading}`)
    expect(content.className).toBe(styles.contents)
    expect(container.firstElementChild).not.toHaveAttribute('data-loading')
    expect(screen.getByRole('button', { name: '加入' })).toBeInTheDocument()
  })

  it('兩種狀態都不輸出任何 inline style,真卡片的 DOM 完全一樣', () => {
    const a = render(
      <SkeletonMask loading>
        <Card />
      </SkeletonMask>,
    )
    const b = render(
      <SkeletonMask loading={false}>
        <Card />
      </SkeletonMask>,
    )
    for (const c of [a.container, b.container]) {
      expect(c.querySelectorAll('[style]')).toHaveLength(0)
    }
    expect(a.container.querySelector('article')!.outerHTML).toBe(b.container.querySelector('article')!.outerHTML)
  })

  it('inert 在掛載的同一個 commit 就設好(layout effect),子元件的 layout effect 已看得到', () => {
    let seenInert: boolean | null = null
    function Probe() {
      const ref = useRef<HTMLButtonElement | null>(null)
      useLayoutEffect(() => {
        // 子元件的 layout effect 先跑;用 microtask 等同一輪 commit 的父層 layout effect 跑完再讀。
        queueMicrotask(() => {
          seenInert = ref.current!.closest('[inert]') !== null
        })
      }, [])
      return <button ref={ref} type="button">x</button>
    }
    render(
      <SkeletonMask loading>
        <Probe />
      </SkeletonMask>,
    )
    return Promise.resolve().then(() => {
      expect(seenInert).toBe(true)
    })
  })

  it('label 改變後重新延後填入;loading 結束後 status 移除', () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <SkeletonMask loading label="甲">
        <Card />
      </SkeletonMask>,
    )
    act(() => {
      vi.advanceTimersByTime(SKELETON_STATUS_FILL_DELAY_MS)
    })
    expect(screen.getByRole('status')).toHaveTextContent('甲')
    rerender(
      <SkeletonMask loading={false} label="甲">
        <Card />
      </SkeletonMask>,
    )
    expect(screen.queryByRole('status')).toBeNull()
  })
})

// CSS 結構斷言:jsdom 不算版面也不解析 mask/:has(),這裡直接讀原始 CSS 確認關鍵宣告在對的規則裡。
describe('Skeleton.module.css(結構)', () => {
  // 取出某段 @supports 區塊的內容(以大括號配對)。
  function block(css: string, header: string): string {
    const start = css.indexOf(header)
    if (start < 0) return ''
    let i = css.indexOf('{', start)
    let depth = 0
    const from = i
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    return css.slice(from + 1, i)
  }
  const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
  // ?raw 對 .module.css 在 vitest 會被當成 CSS Modules 處理,直接讀檔。
  const css = stripComments(readFileSync(resolve(__dirname, 'Skeleton.module.css'), 'utf-8'))

  it('遮罩切行對齊 content-box(mask-origin/mask-clip),且只在支援 lh 時才切', () => {
    const lh = block(css, '@supports (height: 1lh)')
    expect(lh).toMatch(/mask-size:\s*100% 1lh/)
    expect(lh).toMatch(/(?<!-webkit-)mask-origin:\s*content-box/)
    expect(lh).toMatch(/(?<!-webkit-)mask-clip:\s*content-box/)
    expect(lh).toMatch(/-webkit-mask-origin:\s*content-box/)
    expect(lh).toMatch(/-webkit-mask-clip:\s*content-box/)
  })

  it('不使用 box-decoration-break(會讓換行的 inline 元素重複 padding/border,改變盒子)', () => {
    expect(css).not.toMatch(/box-decoration-break/)
  })

  it('--skeleton-mask-sweep 在子孫元素上宣告(使用處才解析 --skeleton-base),不在 .maskLoading 本身', () => {
    expect(css).toMatch(/\.maskLoading \*\s*\{[^}]*--skeleton-mask-sweep:\s*linear-gradient/)
    expect(css).not.toMatch(/\.maskLoading\s*\{[^}]*--skeleton-mask-sweep:\s*linear-gradient/)
  })

  it('依賴 :has() 的規則全部包在 @supports selector(:has(*)) 裡;不支援時退成整塊單色鋪底', () => {
    const has = block(css, '@supports selector(:has(*))')
    const noHas = block(css, '@supports not selector(:has(*))')
    expect(has).toMatch(/:has\(/)
    // @supports 區塊以外不得出現 :has((拿掉該區塊內容與兩個 @supports 標頭後檢查)
    const outside = css.split(has).join('').split('selector(:has(*))').join('')
    expect(outside).not.toMatch(/:has\(/)
    // 退化:有單色底、沒有掃光漸層
    expect(noHas).toMatch(/background-color:\s*var\(--skeleton-base\)\s*!important/)
    expect(noHas).not.toMatch(/--skeleton-mask-sweep|linear-gradient/)
  })
})
