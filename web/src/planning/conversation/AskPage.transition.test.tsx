// AskPage 換步驟的轉場:方向由步驟層級(國家→城市→景點)決定,標在外殼 data-direction 上,
// 換頁後焦點移到新的標題。動畫本身是 CSS,這裡驗證的是「標了什麼方向」與焦點行為。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent } from '@testing-library/react'
import { AskPage } from './AskPage'
import styles from './AskPage.module.css'
import type { PlanAiDataSource } from '../data/source'
import type { AskPageInput } from './asktools'

const dataSource = {
  placeDetails: vi.fn().mockResolvedValue({ found: false }),
  transitEstimate: vi.fn(),
} as unknown as PlanAiDataSource

const COUNTRY: AskPageInput = { country: { countryIds: ['tw'] } } as AskPageInput
const CITY: AskPageInput = { city: { countryId: 'tw' } } as AskPageInput
const TRANSPORT: AskPageInput = { transport: ['walk', 'transit'] } as AskPageInput

function directionOf(container: HTMLElement): string | null {
  return container.firstElementChild?.getAttribute('data-direction') ?? null
}

describe('AskPage 轉場方向', () => {
  it('第一次掛載沒有方向', () => {
    const { container } = render(<AskPage dataSource={dataSource} input={COUNTRY} onDone={() => {}} />)
    expect(directionOf(container)).toBe('none')
  })

  it('國家 → 城市是前進,城市 → 國家是返回', () => {
    const { container, rerender } = render(<AskPage dataSource={dataSource} input={COUNTRY} onDone={() => {}} />)
    rerender(<AskPage dataSource={dataSource} input={CITY} onDone={() => {}} />)
    expect(directionOf(container)).toBe('forward')
    rerender(<AskPage dataSource={dataSource} input={COUNTRY} onDone={() => {}} />)
    expect(directionOf(container)).toBe('back')
  })

  it('同一步驟內重繪,方向維持不變', () => {
    const { container, rerender } = render(<AskPage dataSource={dataSource} input={COUNTRY} onDone={() => {}} />)
    rerender(<AskPage dataSource={dataSource} input={CITY} onDone={() => {}} />)
    rerender(<AskPage dataSource={dataSource} input={CITY} onDone={() => {}} />)
    expect(directionOf(container)).toBe('forward')
  })

  // 滑入只在換步驟那一刻播:動畫結束後方向清回 none,同一步驟內之後才插入的子元素(例如查詢中換成候選時出現的
  // 卡片列、操作列)不會再滑入一次。
  it('換步驟的滑入動畫結束(.bubble 直接子元素的 animationend)後方向清回 none,之後同一步驟重繪仍是 none', () => {
    const { container, rerender } = render(<AskPage dataSource={dataSource} input={COUNTRY} onDone={() => {}} />)
    rerender(<AskPage dataSource={dataSource} input={CITY} onDone={() => {}} />)
    expect(directionOf(container)).toBe('forward')
    fireEvent.animationEnd(container.querySelector('p')!)
    expect(directionOf(container)).toBe('none')
    rerender(<AskPage dataSource={dataSource} input={CITY} onDone={() => {}} />)
    expect(directionOf(container)).toBe('none')
    // 下一次換步驟照樣有方向
    rerender(<AskPage dataSource={dataSource} input={COUNTRY} onDone={() => {}} />)
    expect(directionOf(container)).toBe('back')
  })

  it('查詢中換成候選(同一步驟):滑入結束後新插入的卡片列與操作列不會帶方向重播', () => {
    const LOADING = { candidates: [], loading: true, back: {} } as unknown as AskPageInput
    const READY = { candidates: [{ placeId: 'p1', name: '赤崁樓' }], back: {} } as unknown as AskPageInput
    const { container, rerender } = render(<AskPage dataSource={dataSource} input={CITY} onDone={() => {}} />)
    rerender(<AskPage dataSource={dataSource} input={LOADING} onDone={() => {}} />)
    expect(directionOf(container)).toBe('forward')
    fireEvent.animationEnd(container.querySelector('p')!)
    rerender(<AskPage dataSource={dataSource} input={READY} onDone={() => {}} />)
    expect(directionOf(container)).toBe('none')
    expect(screen.getByRole('button', { name: '確認選擇' })).toBeInTheDocument()
  })

  it('不是 .bubble 直接子元素的 animationend(例如卡片內部、查詢中圖示)不影響方向', () => {
    const { container, rerender } = render(<AskPage dataSource={dataSource} input={COUNTRY} onDone={() => {}} />)
    rerender(<AskPage dataSource={dataSource} input={{ city: { countryId: 'jp' } } as AskPageInput} onDone={() => {}} />)
    const nested = container.querySelector('[data-ask-part="bubble"] > * > *')
    expect(nested).not.toBeNull()
    fireEvent.animationEnd(nested!)
    expect(directionOf(container)).toBe('forward')
  })

  it('交通方式不在層級內:換進去或換出來都沒有方向', () => {
    const { container, rerender } = render(<AskPage dataSource={dataSource} input={CITY} onDone={() => {}} />)
    rerender(<AskPage dataSource={dataSource} input={TRANSPORT} onDone={() => {}} />)
    expect(directionOf(container)).toBe('none')
  })

  it('stacked 標在外殼上(側欄改用縱向浮起)', () => {
    const { container } = render(<AskPage dataSource={dataSource} input={COUNTRY} onDone={() => {}} stacked />)
    expect(container.firstElementChild?.getAttribute('data-stacked')).toBe('true')
  })

  it('換步驟後焦點移到新的標題;第一次掛載不搶焦點', () => {
    const { container, rerender } = render(<AskPage dataSource={dataSource} input={COUNTRY} onDone={() => {}} />)
    expect(document.activeElement).toBe(document.body)
    rerender(<AskPage dataSource={dataSource} input={CITY} onDone={() => {}} />)
    const title = container.querySelector('p')
    expect(title).not.toBeNull()
    expect(document.activeElement).toBe(title)
  })

  // 詢問頁開著時輸入匡不鎖:使用者正在下方輸入匡打字時 AI 推進到下一步,焦點不能被搶走(字會打到別處/消失)。
  it('焦點在詢問頁外(例如輸入框)時換步驟:不搶焦點', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    try {
      const { rerender } = render(<AskPage dataSource={dataSource} input={COUNTRY} onDone={() => {}} />)
      input.focus()
      expect(document.activeElement).toBe(input)
      rerender(<AskPage dataSource={dataSource} input={CITY} onDone={() => {}} />)
      expect(document.activeElement).toBe(input)
    } finally {
      input.remove()
    }
  })

  it('剛點的卡片(焦點在詢問頁內)被換掉後:焦點移到新的標題', () => {
    const { container, rerender } = render(<AskPage dataSource={dataSource} input={{ country: {} } as AskPageInput} onDone={() => {}} />)
    const card = screen.getAllByRole('button').find((b) => b.getAttribute('aria-label') !== '不用了')!
    card.focus()
    expect(document.activeElement).toBe(card)
    rerender(<AskPage dataSource={dataSource} input={CITY} onDone={() => {}} />)
    expect(document.activeElement).toBe(container.querySelector('p'))
  })

  it('焦點仍在詢問頁內的同一個元素(沒被換掉)時換步驟:也移到新的標題', () => {
    // 返回鈕在國家頁 → 城市頁時是不同元件,這裡直接把焦點放在外殼(display: contents 的根節點內任一元素)模擬。
    const { container, rerender } = render(<AskPage dataSource={dataSource} input={COUNTRY} onDone={() => {}} />)
    const root = container.firstElementChild as HTMLElement
    const keeper = document.createElement('button')
    root.appendChild(keeper)
    keeper.focus()
    rerender(<AskPage dataSource={dataSource} input={CITY} onDone={() => {}} />)
    expect(document.activeElement).toBe(container.querySelector('p'))
  })

  it('標題 blur 後移除 tabindex(不留在頁面上變成可程式聚焦的殘留)', () => {
    const { container, rerender } = render(<AskPage dataSource={dataSource} input={COUNTRY} onDone={() => {}} />)
    rerender(<AskPage dataSource={dataSource} input={CITY} onDone={() => {}} />)
    const title = container.querySelector('p')!
    expect(title.getAttribute('tabindex')).toBe('-1')
    title.blur()
    expect(title.hasAttribute('tabindex')).toBe(false)
  })
})

// 高度過渡(useHeightTransition 本身的行為見 useHeightTransition.test.tsx):這裡只確認 AskPage 有接上——
// 手機版換步驟會對 .bubble 做高度動畫,寬螢幕側欄(stacked)不做。
const ALL_COUNTRIES: AskPageInput = { country: {} } as AskPageInput

describe('AskPage 面板高度過渡', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate
  })

  function mockLayout() {
    const animate = vi.fn(() => ({ cancel() {}, finish() {}, onfinish: null, oncancel: null }))
    ;(HTMLElement.prototype as unknown as { animate: unknown }).animate = animate
    // 國家頁的面板當作 160px、交通頁 120px(用面板裡的按鈕數量區分)。
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const h = this.querySelectorAll('button').length > 10 ? 160 : 120
      return { height: h, width: 300, top: 0, left: 0, right: 300, bottom: h, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    })
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }))
    return animate
  }

  it('手機版:國家 → 交通方式,面板高度從 160 動到 120', () => {
    const animate = mockLayout()
    const { rerender } = render(<AskPage dataSource={dataSource} input={ALL_COUNTRIES} onDone={() => {}} />)
    expect(animate).not.toHaveBeenCalled()
    rerender(<AskPage dataSource={dataSource} input={TRANSPORT} onDone={() => {}} />)
    expect(animate).toHaveBeenCalledTimes(1)
    expect(animate.mock.calls[0]).toEqual([[{ height: '160px' }, { height: '120px' }], expect.objectContaining({ duration: 220 })])
  })

  it('stacked(寬螢幕側欄):不做高度動畫', () => {
    const animate = mockLayout()
    const { rerender } = render(<AskPage dataSource={dataSource} input={ALL_COUNTRIES} onDone={() => {}} stacked />)
    rerender(<AskPage dataSource={dataSource} input={TRANSPORT} onDone={() => {}} stacked />)
    expect(animate).not.toHaveBeenCalled()
  })
})

// 轉場排除角落圖示鈕:jsdom 不跑 CSS 動畫,改成直接檢查樣式表——每一條對 .bubble 直接子元素套動畫的選擇器,
// 都要同時排除 .backBtn 與 .closeBtn(兩顆圖示鈕是外殼的固定控制項,只有內容滑動)。
describe('AskPage 轉場排除角落圖示鈕', () => {
  // ?raw 在測試環境會被 CSS Modules 處理成物件,改直接讀檔。
  const css = readFileSync(join(__dirname, 'AskPage.module.css'), 'utf8')

  it('所有 .transition … .bubble > 的動畫選擇器都排除 .backBtn 與 .closeBtn', () => {
    // 解析式:去掉註解後取出每條規則的選擇器清單,逐條拆開;不寫死條數(只要求至少涵蓋 forward/back 兩個方向)。
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const selectors = [...noComments.matchAll(/([^{}]+)\{/g)]
      .flatMap((m) => m[1].split(','))
      .map((sel) => sel.trim().replace(/\s+/g, ' '))
      .filter((sel) => /^\.transition\b/.test(sel) && /\.bubble\s*>/.test(sel))
    expect(selectors.some((sel) => sel.includes("data-direction='forward'"))).toBe(true)
    expect(selectors.some((sel) => sel.includes("data-direction='back'"))).toBe(true)
    for (const sel of selectors) {
      expect(sel).toContain(':not(.backBtn)')
      expect(sel).toContain(':not(.closeBtn)')
    }
  })

  it('換步驟時關閉鈕仍是 .bubble 的直接子元素(才會被上面的 :not 排除),且與返回鈕並存', () => {
    const CITY_WITH_BACK = { city: { countryId: 'tw', back: {} } } as AskPageInput
    const { container, rerender } = render(<AskPage dataSource={dataSource} input={COUNTRY} onDone={() => {}} onBack={() => {}} />)
    rerender(<AskPage dataSource={dataSource} input={CITY_WITH_BACK} onDone={() => {}} onBack={() => {}} />)
    expect(container.firstElementChild?.getAttribute('data-direction')).toBe('forward')
    const close = screen.getByRole('button', { name: '不用了' })
    const back = screen.getByRole('button', { name: '返回上一層' })
    expect(close.parentElement?.classList.contains(styles.bubble)).toBe(true)
    expect(back.parentElement).toBe(close.parentElement)
  })
})
