// 插槽站點卡的備註列:文字元素 title 等於全文(截斷只是視覺,內容仍可讀)。
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { StopCardRenderContext } from '../planning/timeline/PlanTimelineView'
import { createRenderItineraryStopCard } from './renderItineraryStopCard'
import { createRenderOnsenAutumnStopCard } from './renderOnsenAutumnStopCard'
import { stop } from './testUtils'

const LONG = '很長的備註內容'.repeat(15)
const ctx: StopCardRenderContext = {
  isSelected: false, isHovered: false, loading: false, usablePhotos: [],
  onClick: vi.fn(), onMouseEnter: vi.fn(), onMouseLeave: vi.fn(), onFocus: vi.fn(), onBlur: vi.fn(), onOpenPhotos: vi.fn(),
}

describe.each([
  ['renderItineraryStopCard', () => createRenderItineraryStopCard(false)],
  ['renderOnsenAutumnStopCard', () => createRenderOnsenAutumnStopCard()],
])('%s 備註', (_n, make) => {
  it('備註文字元素 title 等於全文', () => {
    const step = stop({ name: '站', note: { text: LONG, category: 'info' } })
    const { container } = render(<>{make()(step, ctx)}</>)
    const el = container.querySelector('[class*="oteText"]') as HTMLElement
    expect(el.getAttribute('title')).toBe(LONG)
    expect(el.textContent).toContain(LONG)
  })
})
