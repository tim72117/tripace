// ScriptedAskPage(/ai-plan 播放態的景點詢問頁)要跟正式詢問頁長得一樣:正式版的「不用了」已改成氣泡右上角的關閉圖示鈕,
// 播放態同樣畫成右上角的 X(同 class),但它是假互動——不是 button、不可聚焦、不可點,讀屏仍讀得到「不用了」這段演出內容。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import styles from './AskPage.module.css'
import { ScriptedAskPage } from './ScriptedAskPage'
import type { PlanAiDataSource } from '../data/source'

const dataSource = {
  placeDetails: vi.fn().mockResolvedValue({ found: false }),
  transitEstimate: vi.fn(),
} as unknown as PlanAiDataSource

function renderScripted() {
  return render(
    <ScriptedAskPage dataSource={dataSource} candidates={[{ placeId: 'p1', name: '赤崁樓' }]} picks={[]} onDone={() => {}} />,
  )
}

describe('ScriptedAskPage 右上角關閉圖示(播放態假互動)', () => {
  it('右上角畫同外觀的關閉圖示:closeBtn + cornerBtnStatic,在標題之後;標題左右對稱留空', () => {
    const { container } = renderScripted()
    const close = container.querySelector(`.${styles.closeBtn}`) as HTMLElement
    expect(close).not.toBeNull()
    expect(close.className).toContain(styles.cornerBtnStatic)
    expect(close.previousElementSibling?.tagName).toBe('P')
    expect(close.previousElementSibling?.className).toContain(styles.questionWithControls)
    expect(close.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  // 純裝飾:用 role="img" 會被讀屏唸成「不用了,圖像」,像是一個可操作的東西;播放態沒有真的關閉動作,整顆藏起來。
  it('不是控制項:沒有 button/img 角色、不在 Tab 順序、對輔助技術隱藏', () => {
    const { container } = renderScripted()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
    const close = container.querySelector(`.${styles.closeBtn}`) as HTMLElement
    expect(close.tagName).toBe('DIV')
    expect(close.getAttribute('aria-hidden')).toBe('true')
    expect(close.hasAttribute('role')).toBe(false)
    expect(close.hasAttribute('aria-label')).toBe(false)
    expect(close.getAttribute('tabindex')).toBeNull()
  })

  it('候選卡片是不可點的靜態卡(不套 hover/pointer 的 directionCardStatic)', () => {
    const { container } = renderScripted()
    const card = container.querySelector(`.${styles.directionCard}`) as HTMLElement
    expect(card.tagName).toBe('DIV')
    expect(card.classList.contains(styles.directionCardStatic)).toBe(true)
  })

  it('操作列不再有「不用了」文字,只剩「確認選擇」', () => {
    const { container } = renderScripted()
    const actions = container.querySelector(`.${styles.actions}`)!
    expect(actions.textContent).toBe('確認選擇')
    expect(screen.queryByText('不用了')).toBeNull()
  })
})

describe('ScriptedAskPage 演出結束的 onDone', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // 計時器排程在掛載當下建立,若直接讀當下的 details(空的),onDone 的 attractionId 永遠是 undefined;
  // 要讀到「背景查詢完成後」最新的 details。
  it('帶出背景查詢補到的 attractionId(查無資料的只有 placeId)', async () => {
    vi.useFakeTimers()
    const ds = {
      placeDetails: vi.fn((placeId: string) =>
        Promise.resolve(placeId === 'p1' ? { found: true, name: '赤崁樓', attractionId: 'a-1' } : { found: false }),
      ),
      transitEstimate: vi.fn(),
    } as unknown as PlanAiDataSource
    const onDone = vi.fn()
    render(
      <ScriptedAskPage
        dataSource={ds}
        candidates={[{ placeId: 'p1', name: '赤崁樓' }, { placeId: 'p2', name: '林百貨' }]}
        picks={['p1', 'p2']}
        confirmAfterMs={100}
        onDone={onDone}
      />,
    )
    // 讓 placeDetails 的 Promise 先解決、寫進 details
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledWith([
      { placeId: 'p1', attractionId: 'a-1' },
      { placeId: 'p2', attractionId: undefined },
    ])
  })
})
