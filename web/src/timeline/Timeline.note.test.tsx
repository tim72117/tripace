// 舊版 MultiTrackTimeline 的備註列:title 帶全文;卡片展開時備註列帶展開 class(可換行看全文),收合時沒有。
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MultiTrackTimeline } from './Timeline'
import type { Entry } from '../types'

const LONG = '這是一段很長很長的備註'.repeat(10)

function entry(over: Partial<Entry> = {}): Entry {
  return { id: 'e1', tripID: 't', title: '測試事項', start: '2026-10-01', startTime: '09:00', category: null, tags: null, note: LONG, createdAt: '2026-10-01T00:00:00Z', ...over }
}

describe('MultiTrackTimeline 備註列', () => {
  it('備註文字元素 title 等於全文,內容仍完整可讀', () => {
    const { container } = render(<MultiTrackTimeline entries={[entry()]} />)
    const text = container.querySelector('[class*="noteText"]') as HTMLElement
    expect(text.getAttribute('title')).toBe(LONG)
    expect(text.textContent).toBe(LONG)
    expect(text.closest('[aria-hidden]')).toBeNull()
  })

  it('展開時備註列帶 noteRowOpen,收合時沒有', () => {
    const { container } = render(<MultiTrackTimeline entries={[entry()]} />)
    const row = () => container.querySelector('[class*="noteRow"]') as HTMLElement
    expect(row().className).not.toMatch(/noteRowOpen/)
    fireEvent.click(container.querySelector('[class*="cardRow"]') as HTMLElement)
    expect(row().className).toMatch(/noteRowOpen/)
    fireEvent.click(container.querySelector('[class*="cardRow"]') as HTMLElement)
    expect(row().className).not.toMatch(/noteRowOpen/)
  })
})
