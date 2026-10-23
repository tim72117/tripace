import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PlanTimelineView } from './PlanTimelineView'
import type { PlanNode } from './planTimeline'

// 住宿卡片類型:kind === '住宿' 的站畫成窄長橫幅(區間文字取 duration、不畫縮圖與描述),其他站維持一般景點卡;
// 互動(點擊平移、hover 連動)與一般卡片一致;呼叫端傳 renderStopCard 時仍整張替換。

function stop(id: string, over: Partial<PlanNode>): PlanNode {
  return { id, prevId: null, nextId: null, type: 'stop', name: id, time: '10:00', duration: '1 小時', kind: '景點', desc: `${id}描述`, lat: 1, lng: 2, ...over } as PlanNode
}

function renderTimeline(steps: PlanNode[], extra: Record<string, unknown> = {}) {
  const onPanToStop = vi.fn()
  const onHoverStop = vi.fn()
  const utils = render(
    <PlanTimelineView
      steps={steps}
      isThinking={false}
      emptyStateMessage=""
      selectedStopId={null}
      showJumpPill={false}
      onJumpToLatest={() => {}}
      onPanToStop={onPanToStop}
      onHoverStop={onHoverStop}
      onOpenPhotos={() => {}}
      mountedIdsRef={{ current: new Set() }}
      {...extra}
    />,
  )
  return { ...utils, onPanToStop, onHoverStop }
}

describe('PlanTimelineView 住宿卡片類型', () => {
  const steps = [
    stop('s1', { kind: '景點' }),
    stop('h1', { kind: '住宿', duration: 'Day 3–4', desc: '不該出現的描述' }),
  ]

  it('住宿站畫成橫幅:顯示區間與名稱,不畫描述;景點站維持一般卡片(有描述)', () => {
    renderTimeline(steps)
    expect(screen.getByText('Day 3–4')).toBeTruthy()
    expect(screen.getByText('h1')).toBeTruthy()
    expect(screen.queryByText('不該出現的描述')).toBeNull()
    expect(screen.getByText('s1描述')).toBeTruthy()
  })

  it('點住宿橫幅會平移到該站,hover 會回報該站 id', () => {
    const { onPanToStop, onHoverStop } = renderTimeline(steps)
    const banner = screen.getByText('h1').closest('[role="button"]') as HTMLElement
    fireEvent.mouseEnter(banner)
    expect(onHoverStop).toHaveBeenCalledWith('h1')
    fireEvent.click(banner)
    expect(onPanToStop).toHaveBeenCalledWith(expect.objectContaining({ id: 'h1' }))
  })

  it('住宿有照片時,橫幅用縮圖取代🛏️,點縮圖開照片而不是平移', () => {
    const onOpenPhotos = vi.fn()
    const { onPanToStop } = renderTimeline(
      [stop('h1', { kind: '住宿', duration: 'Day 3–4', googlePhotoUrls: ['https://x/a.jpg'] })],
      { onOpenPhotos },
    )
    expect(screen.queryByText('🛏️')).toBeNull()
    fireEvent.click(screen.getByLabelText('放大檢視照片'))
    expect(onOpenPhotos).toHaveBeenCalledWith({ photos: ['https://x/a.jpg'], alt: 'h1' })
    expect(onPanToStop).not.toHaveBeenCalled()
  })

  it('呼叫端傳 renderStopCard 時整張替換,住宿也不例外', () => {
    renderTimeline(steps, { renderStopCard: (s: PlanNode) => <div>自訂-{s.id}</div> })
    expect(screen.getByText('自訂-h1')).toBeTruthy()
    expect(screen.queryByText('Day 3–4')).toBeNull()
  })
})
