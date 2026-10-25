// AiItineraryListPage 的站位行為:清單資料還沒到時用 SkeletonMask 遮住同一份卡片 JSX(不閃空狀態),封面交給 FramedImage。
import { describe, it, expect } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import styles from './AiItineraryListPage.module.css'
import { MemoryRouter } from 'react-router-dom'
import { AiItineraryListPage } from './AiItineraryListPage'
import { makeItinerary, stop } from './testUtils'
import type { SampleItinerary } from './types'

function renderList(items: SampleItinerary[], loading?: boolean) {
  return render(
    <MemoryRouter>
      <AiItineraryListPage items={items} loading={loading} />
    </MemoryRouter>,
  )
}

describe('AiItineraryListPage 載入中骨架', () => {
  it('loading 且沒有行程:畫骨架卡片,不顯示「還沒有範例行程」', async () => {
    const { getAllByTestId, queryByText, container, getByRole } = renderList([], true)
    expect(getAllByTestId('itinerary-card-skeleton')).toHaveLength(6)
    expect(queryByText('還沒有範例行程')).toBeNull()
    expect(container.querySelector('[data-skeleton="mask"][data-loading]')).not.toBeNull()
    // 讀屏宣告:status 延後填入文字;祖先不能有 aria-busy(會壓住 live region 的通知)
    const status = getByRole('status')
    await waitFor(() => expect(status.textContent).toBe('行程清單載入中'))
    expect(status.closest('[aria-busy]')).toBeNull()
    expect(container.querySelector('[aria-busy]')).toBeNull()
  })

  it('骨架的篩選膠囊與真的按鈕同 class,且 .chip 明確設定字型與行高(span 與 button 等價)', () => {
    const { container } = renderList([], true)
    const chips = container.querySelectorAll(`span.${styles.chip}`)
    expect(chips.length).toBeGreaterThan(0)
    const css = readFileSync(resolve(__dirname, 'AiItineraryListPage.module.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '')
    const chipRule = css.match(/\.chip\s*\{([^}]*)\}/)![1]
    expect(chipRule).toMatch(/font:\s*inherit/)
    expect(chipRule).toMatch(/line-height:\s*[^;]+/)
    // font 簡寫要在 font-size/line-height 之前,否則會被重設
    expect(chipRule.indexOf('font:')).toBeLessThan(chipRule.indexOf('font-size'))
    expect(chipRule.indexOf('font:')).toBeLessThan(chipRule.indexOf('line-height'))
  })

  it('骨架卡片與真卡片用同一組外框 class(card/cover/body)', () => {
    const skeleton = renderList([], true)
    const skCard = skeleton.container.querySelector('ul > li > *') as HTMLElement
    const skCover = skCard.firstElementChild as HTMLElement
    const skBody = skCard.children[1] as HTMLElement
    skeleton.unmount()

    const real = renderList([makeItinerary([stop({ name: 'a' })], { id: 'a', title: 'A' })])
    const card = real.container.querySelector('ul > li > a') as HTMLElement
    expect(skCard.className).toContain(card.className.split(' ')[0])
    expect(skCover.className).toBe((card.firstElementChild as HTMLElement).className)
    expect(skBody.className).toBe((card.children[1] as HTMLElement).className)
  })

  it('loading 但已有行程(靜態先到):直接畫真卡片,不畫骨架', () => {
    const { queryAllByTestId, getByText } = renderList([makeItinerary([stop({ name: 'a' })], { id: 'a', title: '行程甲' })], true)
    expect(queryAllByTestId('itinerary-card-skeleton')).toHaveLength(0)
    expect(getByText('行程甲')).toBeTruthy()
  })

  it('載入結束仍沒有行程:才顯示空狀態', () => {
    const { getByText, queryAllByTestId } = renderList([], false)
    expect(getByText('還沒有範例行程')).toBeTruthy()
    expect(queryAllByTestId('itinerary-card-skeleton')).toHaveLength(0)
  })
})

describe('AiItineraryListPage 封面站位', () => {
  it('沒有照片:封面外框仍在、只有佔位圖示', () => {
    const { container } = renderList([makeItinerary([stop({ name: 'a' })], { id: 'a' })])
    const cover = container.querySelector('[class*="_cover_"]')!
    expect((cover as HTMLElement).dataset.status).toBe('idle')
    expect(cover.querySelector('svg')).not.toBeNull()
    expect(cover.querySelector('img')).toBeNull()
  })

  it('有照片:封面外框不變,照片載入完成 loaded、失敗 error(同尺寸失敗佔位)', () => {
    const it0 = makeItinerary([stop({ name: 'a' })], { id: 'a', coverPhoto: 'https://example.com/c.jpg' })
    const ok = renderList([it0])
    const cover = ok.container.querySelector('[class*="_cover_"]') as HTMLElement
    expect(cover.dataset.status).toBe('loading')
    fireEvent.load(cover.querySelector('img')!)
    expect(cover.dataset.status).toBe('loaded')
    expect(ok.container.querySelector('[class*="_cover_"]')).toBe(cover)
    ok.unmount()

    const bad = renderList([it0])
    const badCover = bad.container.querySelector('[class*="_cover_"]') as HTMLElement
    fireEvent.error(badCover.querySelector('img')!)
    expect(badCover.dataset.status).toBe('error')
    expect(badCover.querySelector('img')).toBeNull()
  })
})
