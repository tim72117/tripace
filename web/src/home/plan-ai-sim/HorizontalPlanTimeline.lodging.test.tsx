// HorizontalPlanTimeline 的住宿卡片(窄版錨點卡):kind === '住宿' 不走景點卡的版面,顯示區間文字與名稱,互動與其他卡一致。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { HorizontalPlanTimeline } from './HorizontalPlanTimeline'
import type { PlanNode } from '../../plan-core/planTimeline'

function stop(over: Partial<PlanNode> & { id: string }): PlanNode {
  return { type: 'stop', prevId: null, nextId: null, name: over.id, day: 1, time: '09:00', duration: '1h', kind: '景點', desc: `${over.id}描述`, ...over } as PlanNode
}

function setup(steps: PlanNode[], extra: Record<string, unknown> = {}) {
  const onSelectStop = vi.fn()
  const utils = render(
    <HorizontalPlanTimeline
      steps={steps}
      selectedStopId={null}
      onSelectStop={onSelectStop}
      onOpenPhotos={() => {}}
      isGenerating={false}
      {...extra}
    />,
  )
  return { ...utils, onSelectStop }
}

describe('HorizontalPlanTimeline 住宿卡片', () => {
  // jsdom 沒有 scrollIntoView,點卡片選取時元件會呼叫它。
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  const steps = [stop({ id: 's1' }), stop({ id: 'h1', kind: '住宿', duration: 'Day 3–4', time: '18:00', desc: '不該出現的描述' })]

  it('住宿顯示區間文字與名稱,沒有照片橫幅與描述;景點卡維持原樣(有描述)', () => {
    const { getByText, queryByText, container } = setup(steps)
    expect(getByText('Day 3–4')).toBeTruthy()
    expect(getByText('h1')).toBeTruthy()
    expect(queryByText('不該出現的描述')).toBeNull()
    expect(getByText('s1描述')).toBeTruthy()
    const card = getByText('h1').closest('[role="button"]') as HTMLElement
    expect(card.className).toMatch(/lodgingCard/)
    expect(container.querySelectorAll('[class*="lodgingCard"]')).toHaveLength(1)
  })

  it('沒有照片顯示🛏️,有可用照片改顯示縮圖', () => {
    const a = setup(steps)
    expect(a.getByText('🛏️')).toBeTruthy()
    a.unmount()
    const b = setup([stop({ id: 'h1', kind: '住宿', duration: 'Day 3–4', googlePhotoUrls: ['https://x/a.jpg'] })])
    expect(b.queryByText('🛏️')).toBeNull()
    expect(b.container.querySelector('img[src="https://x/a.jpg"]')).not.toBeNull()
  })

  it('點整張卡選取;「移動到此」與移除按鈕各自呼叫且不觸發選取', () => {
    const onPanToStop = vi.fn()
    const onRemoveStop = vi.fn()
    const { getByText, getByLabelText, onSelectStop } = setup(steps, { onPanToStop, onRemoveStop })
    fireEvent.click(getByLabelText('在地圖上移動到「h1」'))
    expect(onPanToStop).toHaveBeenCalledWith('h1')
    fireEvent.click(getByLabelText('移除「h1」'))
    expect(onRemoveStop).toHaveBeenCalledWith('h1')
    expect(onSelectStop).not.toHaveBeenCalled()
    fireEvent.click(getByText('h1'))
    expect(onSelectStop).toHaveBeenCalledWith('h1')
  })
})
