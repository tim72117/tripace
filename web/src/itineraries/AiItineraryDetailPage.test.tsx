// AiItineraryDetailPage 的載入中標頭骨架:只有 API 才有、沒有靜態版本的行程,在 API 回來前用 SkeletonMask 遮住
// 同一份標頭 JSX(ItineraryHeader);讀屏宣告延後填入、祖先沒有 aria-busy;API 失敗才顯示「找不到這份行程」。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import styles from './AiItineraryDetailPage.module.css'

const fetchPage = vi.fn()
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, fetchPublicItineraryPage: (...args: unknown[]) => fetchPage(...args) }
})

import { AiItineraryDetailPage } from './AiItineraryDetailPage'

function renderDetail(id = 'only-in-api') {
  return render(
    <MemoryRouter>
      <AiItineraryDetailPage items={[]} id={id} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  fetchPage.mockReset()
})

describe('AiItineraryDetailPage 載入中標頭骨架', () => {
  it('API 查詢中且沒有靜態版本:標頭用 SkeletonMask 遮住,結構與真標頭同 class', async () => {
    fetchPage.mockReturnValue(new Promise(() => {}))
    const { container, getByRole, queryByText } = renderDetail()
    const mask = container.querySelector('[data-skeleton="mask"][data-loading]')
    expect(mask).not.toBeNull()
    const header = mask!.querySelector('header')!
    expect(header).toHaveClass(styles.header)
    expect(header.querySelector('h1')).toHaveClass(styles.title)
    expect(header.querySelector(`.${styles.meta}`)).not.toBeNull()
    expect(header.querySelector(`.${styles.summary}`)).not.toBeNull()
    // 遮罩層 aria-hidden + inert:骨架文字不被讀屏讀到、不能取得焦點
    const content = header.parentElement as HTMLElement
    expect(content).toHaveAttribute('aria-hidden', 'true')
    expect(content.hasAttribute('inert')).toBe(true)
    expect(queryByText('找不到這份行程')).toBeNull()
    // 讀屏宣告延後填入,祖先沒有 aria-busy
    const status = getByRole('status')
    await waitFor(() => expect(status.textContent).toBe('行程載入中'))
    expect(container.querySelector('[aria-busy]')).toBeNull()
  })

  it('API 失敗(查無)且沒有靜態版本:骨架換成「找不到這份行程」', async () => {
    fetchPage.mockRejectedValue(new Error('boom'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { findByText, container } = renderDetail()
    expect(await findByText('找不到這份行程')).toBeTruthy()
    expect(container.querySelector('[data-skeleton="mask"]')).toBeNull()
    errSpy.mockRestore()
  })
})
