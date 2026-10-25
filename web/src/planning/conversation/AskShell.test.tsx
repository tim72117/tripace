import { describe, it, expect, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import styles from './AskPage.module.css'
import { AskShell } from './AskShell'

const wrapOf = (c: HTMLElement) => c.firstElementChild as HTMLElement

describe('AskShell', () => {
  it('DOM 結構:wrap > bubble > p.question > children > actions', () => {
    const { container } = render(
      <AskShell question="要去哪?" actions={<button>x</button>}>
        <div data-testid="body" />
      </AskShell>,
    )
    const wrap = wrapOf(container)
    expect(wrap.className).toContain(styles.wrap)
    const bubble = wrap.firstElementChild as HTMLElement
    expect(bubble.className).toContain(styles.bubble)
    const [p, body, actions] = Array.from(bubble.children)
    expect(p.tagName).toBe('P')
    expect(p.className).toContain(styles.question)
    expect(p.className).not.toContain(styles.questionLoading)
    expect(p.getAttribute('role')).toBeNull()
    expect(p.textContent).toBe('要去哪?')
    expect(body).toBe(screen.getByTestId('body'))
    expect(actions.className).toBe(styles.actions)
  })

  it('stacked 套 wrapStacked / bubbleStacked,沒傳則沒有', () => {
    const { container, rerender } = render(<AskShell question="q" />)
    expect(wrapOf(container).className).not.toContain(styles.wrapStacked)
    expect(wrapOf(container).firstElementChild!.className).not.toContain(styles.bubbleStacked)
    rerender(<AskShell question="q" stacked />)
    expect(wrapOf(container).className).toContain(styles.wrapStacked)
    expect(wrapOf(container).firstElementChild!.className).toContain(styles.bubbleStacked)
  })

  it('loading:標題用 questionLoading 與 role=status,且不套 hoverLocked', () => {
    const { container } = render(<AskShell question="查詢中" loading />)
    const p = screen.getByRole('status')
    expect(p.className).toContain(styles.question)
    expect(p.className).toContain(styles.questionLoading)
    expect(wrapOf(container).className).not.toContain(styles.hoverLocked)
  })

  it('hover 鎖定:掛載時有 hoverLocked,pointermove 後消失', () => {
    const { container } = render(<AskShell question="q" />)
    expect(wrapOf(container).className).toContain(styles.hoverLocked)
    act(() => {
      window.dispatchEvent(new Event('pointermove'))
    })
    expect(wrapOf(container).className).not.toContain(styles.hoverLocked)
  })

  it('loading 中指標已動過,轉成候選時不再鎖定(解鎖狀態同樣延續)', () => {
    const { container, rerender } = render(<AskShell question="q" loading />)
    act(() => {
      window.dispatchEvent(new Event('pointermove'))
    })
    rerender(<AskShell question="q" />)
    expect(wrapOf(container).className).not.toContain(styles.hoverLocked)
  })

  it('融合掛點:wrap 標 data-ask-part="wrap"、bubble 標 data-ask-part="bubble"', () => {
    const { container } = render(<AskShell question="q" />)
    const wrap = wrapOf(container)
    expect(wrap.getAttribute('data-ask-part')).toBe('wrap')
    expect(wrap.firstElementChild!.getAttribute('data-ask-part')).toBe('bubble')
  })

  it('loading 轉成候選時鎖定狀態延續', () => {
    const { container, rerender } = render(<AskShell question="q" loading />)
    rerender(<AskShell question="q" />)
    expect(wrapOf(container).className).toContain(styles.hoverLocked)
  })

  it('沒傳 actions 不渲染 .actions', () => {
    const { container } = render(<AskShell question="q" />)
    expect(container.querySelector(`.${styles.actions}`)).toBeNull()
  })

  it('actionsPinned:操作列多套 actionsPinned', () => {
    const { container } = render(<AskShell question="q" actions={<button>x</button>} actionsPinned />)
    expect(container.querySelector(`.${styles.actions}`)!.className).toContain(styles.actionsPinned)
  })
})

describe('AskShell 返回圖示鈕', () => {
  it('沒傳 onBack:不渲染返回鈕,標題沒有 questionWithControls', () => {
    const { container } = render(<AskShell question="q" />)
    expect(screen.queryByRole('button', { name: '返回上一層' })).toBeNull()
    expect(container.querySelector(`.${styles.backBtn}`)).toBeNull()
    expect(container.querySelector('p')!.className).not.toContain(styles.questionWithControls)
  })

  it('有傳 onBack:氣泡第一個子元素是圖示鈕(無文字),有 aria-label 與 title', () => {
    const { container } = render(<AskShell question="要去哪?" onBack={() => {}} />)
    const btn = screen.getByRole('button', { name: '返回上一層' })
    const bubble = wrapOf(container).firstElementChild as HTMLElement
    expect(bubble.firstElementChild).toBe(btn)
    expect(btn.className).toBe(styles.backBtn)
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn.getAttribute('title')).toBe('返回上一層')
    expect(btn.textContent).toBe('')
    expect(btn.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('有傳 onBack:標題加 questionWithControls 左右留空,不被箭頭蓋到', () => {
    const { container } = render(<AskShell question="q" onBack={() => {}} />)
    const p = container.querySelector('p')!
    expect(p.className).toContain(styles.question)
    expect(p.className).toContain(styles.questionWithControls)
  })

  it('點擊呼叫 onBack', () => {
    const onBack = vi.fn()
    render(<AskShell question="q" onBack={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: '返回上一層' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('鍵盤可操作:Tab 第一個聚焦到返回鈕,Enter 與空白鍵都觸發', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<AskShell question="q" onBack={onBack} actions={<button>不用了</button>} />)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '返回上一層' }))
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onBack).toHaveBeenCalledTimes(2)
  })

  it('自訂 backLabel', () => {
    render(<AskShell question="q" onBack={() => {}} backLabel="上一步" />)
    const btn = screen.getByRole('button', { name: '上一步' })
    expect(btn.getAttribute('title')).toBe('上一步')
  })
})

describe('AskShell 關閉圖示鈕', () => {
  it('沒傳 onClose:不渲染關閉鈕', () => {
    const { container } = render(<AskShell question="q" />)
    expect(screen.queryByRole('button', { name: '不用了' })).toBeNull()
    expect(container.querySelector(`.${styles.closeBtn}`)).toBeNull()
  })

  it('有傳 onClose:圖示鈕(無文字)放在標題之後、內容之前,預設 aria-label/title 為「不用了」', () => {
    const { container } = render(
      <AskShell question="要去哪?" onClose={() => {}} actions={<button>確認</button>}>
        <div data-testid="body" />
      </AskShell>,
    )
    const btn = screen.getByRole('button', { name: '不用了' })
    const bubble = wrapOf(container).firstElementChild as HTMLElement
    const [p, close, body] = Array.from(bubble.children)
    expect(p.tagName).toBe('P')
    expect(close).toBe(btn)
    expect(body).toBe(screen.getByTestId('body'))
    expect(btn.className).toBe(styles.closeBtn)
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn.getAttribute('aria-label')).toBe('不用了')
    expect(btn.getAttribute('title')).toBe('不用了')
    expect(btn.textContent).toBe('')
    expect(btn.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('自訂 closeLabel', () => {
    render(<AskShell question="q" onClose={() => {}} closeLabel="關閉詢問" />)
    const btn = screen.getByRole('button', { name: '關閉詢問' })
    expect(btn.getAttribute('title')).toBe('關閉詢問')
  })

  it('點擊呼叫 onClose', () => {
    const onClose = vi.fn()
    render(<AskShell question="q" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '不用了' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('鍵盤:Tab 順序 返回 → 關閉 → 內容選項 → 操作列;Enter 與空白鍵觸發關閉', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onBack = vi.fn()
    render(
      <AskShell question="q" onBack={onBack} onClose={onClose} actions={<button>確認選擇</button>}>
        <button>東京</button>
      </AskShell>,
    )
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '返回上一層' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '不用了' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '東京' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '確認選擇' }))
    screen.getByRole('button', { name: '不用了' }).focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(onBack).not.toHaveBeenCalled()
  })

  it('與返回鈕並存:兩顆各自獨立,點返回不觸發關閉、點關閉不觸發返回', () => {
    const onClose = vi.fn()
    const onBack = vi.fn()
    const { container } = render(<AskShell question="q" onBack={onBack} onClose={onClose} />)
    const bubble = wrapOf(container).firstElementChild as HTMLElement
    expect(bubble.firstElementChild!.className).toBe(styles.backBtn)
    fireEvent.click(screen.getByRole('button', { name: '返回上一層' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '不用了' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  // 標題左右留空要對稱:只要任一角落有圖示鈕,兩側都預留(國家頁只有關閉鈕,左側也要留,標題才會維持置中)。
  it.each([
    ['都沒有', {}, false],
    ['只有返回', { onBack: () => {} }, true],
    ['只有關閉', { onClose: () => {} }, true],
    ['兩者都有', { onBack: () => {}, onClose: () => {} }, true],
  ] as const)('標題留空 class:%s', (_name, extra, expected) => {
    const { container } = render(<AskShell question="q" {...extra} />)
    const cls = container.querySelector('p')!.className
    if (expected) expect(cls).toContain(styles.questionWithControls)
    else expect(cls).not.toContain(styles.questionWithControls)
  })

  it('loading 時也可以帶 onClose(由呼叫端決定),標題同時有 questionLoading 與留空', () => {
    render(<AskShell question="查詢中" loading onClose={() => {}} />)
    const p = screen.getByRole('status')
    expect(p.className).toContain(styles.questionLoading)
    expect(p.className).toContain(styles.questionWithControls)
    expect(screen.getByRole('button', { name: '不用了' })).toBeInTheDocument()
  })
})
