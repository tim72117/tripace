import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CandidateCard } from './CandidateCard'
import styles from './AskPage.module.css'

describe('CandidateCard', () => {
  it('未勾選:無勾號與 checked class,aria-pressed=false', () => {
    const { container } = render(<CandidateCard name="赤崁樓" checked={false} />)
    const btn = screen.getByRole('button')
    expect(btn.className).toContain(styles.directionCard)
    expect(btn.className).not.toContain(styles.directionCardChecked)
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector(`.${styles.directionCheck}`)).toBeNull()
    expect(screen.getByText('赤崁樓').className).toContain(styles.directionLabel)
  })

  it('已勾選:有 checked class 與勾號', () => {
    const { container } = render(<CandidateCard name="赤崁樓" checked />)
    const btn = screen.getByRole('button')
    expect(btn.className).toContain(styles.directionCardChecked)
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector(`.${styles.directionCheck}`)).not.toBeNull()
  })

  it('有照片時渲染 img,不渲染佔位', () => {
    const { container } = render(<CandidateCard name="A" checked={false} photoUrl="http://x/p.jpg" stacked />)
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('http://x/p.jpg')
    expect(img.className).toContain(styles.directionPhotoStacked)
    expect(container.querySelector(`.${styles.directionPhotoPlaceholder}`)).toBeNull()
  })

  it('沒照片:stacked 顯示佔位,非 stacked 什麼都不放', () => {
    const a = render(<CandidateCard name="A" checked={false} stacked />)
    expect(a.container.querySelector('img')).toBeNull()
    expect(a.container.querySelector(`.${styles.directionPhotoPlaceholder}`)).not.toBeNull()
    a.unmount()
    const b = render(<CandidateCard name="A" checked={false} />)
    expect(b.container.querySelector(`.${styles.directionPhotoPlaceholder}`)).toBeNull()
  })

  it('stacked 變體 class', () => {
    render(<CandidateCard name="A" checked={false} stacked />)
    expect(screen.getByRole('button').className).toContain(styles.directionCardStacked)
    expect(screen.getByText('A').className).toContain(styles.directionLabelStacked)
  })

  it('標題:loading 顯示查詢中,沒名字顯示未命名', () => {
    const a = render(<CandidateCard name="A" loading checked={false} />)
    expect(screen.getByText('查詢中…')).toBeTruthy()
    a.unmount()
    render(<CandidateCard checked={false} />)
    expect(screen.getByText('未命名地點')).toBeTruthy()
  })

  it('點擊呼叫 onToggle', () => {
    const onToggle = vi.fn()
    render(<CandidateCard name="A" checked={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('擴充點:className 加在根節點、children 渲染在勾號之後', () => {
    const { container } = render(
      <CandidateCard name="A" checked className="fx">
        <span data-testid="ripple" />
      </CandidateCard>,
    )
    const root = container.firstElementChild!
    expect(root.className).toContain('fx')
    expect(root.className).toContain(styles.directionCard)
    expect(root.lastElementChild).toBe(screen.getByTestId('ripple'))
    expect(root.querySelector(`.${styles.directionCheck}`)!.nextElementSibling).toBe(screen.getByTestId('ripple'))
  })

  it('as="div":不是按鈕、無 aria-pressed,標上 directionCardStatic(不套 pointer 與 hover)', () => {
    const { container } = render(<CandidateCard as="div" name="A" checked />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.firstElementChild!.tagName).toBe('DIV')
    expect(container.firstElementChild!.hasAttribute('aria-pressed')).toBe(false)
    expect(container.firstElementChild!.classList.contains(styles.directionCardStatic)).toBe(true)
  })

  it('按鈕版不帶 directionCardStatic', () => {
    render(<CandidateCard name="A" checked={false} />)
    expect(screen.getByRole('button').classList.contains(styles.directionCardStatic)).toBe(false)
  })

  // Google 照片網址會過期:載入失敗時退回「沒有照片」的外觀(stacked 補佔位、橫向卡只剩底色),不顯示破圖。
  it('照片載入失敗:移除 img,stacked 改顯示佔位', () => {
    const { container } = render(<CandidateCard name="A" checked={false} photoUrl="http://x/expired.jpg" stacked />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector(`.${styles.directionPhotoPlaceholder}`)).not.toBeNull()
  })

  it('照片載入失敗:橫向卡移除 img(只剩底色,與沒有照片一致)', () => {
    const { container } = render(<CandidateCard name="A" checked={false} photoUrl="http://x/expired.jpg" />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector(`.${styles.directionPhotoPlaceholder}`)).toBeNull()
  })

  it('換成新的照片網址後重新嘗試顯示', () => {
    const { container, rerender } = render(<CandidateCard name="A" checked={false} photoUrl="http://x/expired.jpg" />)
    fireEvent.error(container.querySelector('img')!)
    rerender(<CandidateCard name="A" checked={false} photoUrl="http://x/fresh.jpg" />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('http://x/fresh.jpg')
  })
})
