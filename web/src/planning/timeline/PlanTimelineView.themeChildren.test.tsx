// PlanTimelineView 預設景點卡的主題點子景點 chip(ThemeChildChips):節點只存 attractions/places 的 id,
// 名稱經資料存取層解析;點 chip 回報(父節點 id, 子景點),不冒泡成「點卡片」。
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { dataSourceFromRefs, renderWithPlanData as render } from '../data/fixtures'
import { PlanTimelineView } from './PlanTimelineView'
import type { PlanNode, PlanThemeChild, PlanTimeline } from './model'

const theme: PlanNode = { id: 't', type: 'stop', name: '孔廟周邊', time: '09:00', duration: '停留 2h', kind: '景點', places: ['c1', 'c2'] }
const plain: PlanNode = { id: 'p', type: 'stop', name: '赤崁樓', time: '11:00', duration: '停留 1h', kind: '景點' }
const tl = (...nodes: PlanNode[]): PlanTimeline => ({ days: [{ id: 'd', nodes }] })
const refs = new Map<string, PlanThemeChild>([
  ['c1', { id: 'c1', name: '孔廟' } as PlanThemeChild],
  ['c2', { id: 'c2', name: '孔廟商圈' } as PlanThemeChild],
])

function view(timeline: PlanTimeline, extra: Partial<React.ComponentProps<typeof PlanTimelineView>> = {}) {
  return (
    <PlanTimelineView
      timeline={timeline}
      isThinking={false}
      emptyStateMessage=""
      selectedStopId={null}
      showJumpPill={false}
      onJumpToLatest={() => {}}
      onPanToStop={() => {}}
      onOpenPhotos={() => {}}
      mountedIdsRef={{ current: new Set(['t', 'p']) }}
      {...extra}
    />
  )
}

describe('PlanTimelineView 主題點子景點 chip', () => {
  it('主題點卡片列出子景點名稱;沒有子景點的站不畫 chip 列', async () => {
    render(view(tl(theme, plain)), dataSourceFromRefs(refs))
    await waitFor(() => expect(screen.getByText('孔廟商圈')).toBeTruthy())
    expect(screen.getByText('孔廟')).toBeTruthy()
    expect(screen.getAllByRole('list', { name: '孔廟周邊包含的景點' })).toHaveLength(1)
    expect(screen.queryByRole('list', { name: '赤崁樓包含的景點' })).toBeNull()
  })

  it('點 chip 回報父節點 id 與子景點,且不觸發卡片的 onPanToStop', async () => {
    const onSelectThemeChild = vi.fn()
    const onPanToStop = vi.fn()
    render(view(tl(theme), { onSelectThemeChild, onPanToStop }), dataSourceFromRefs(refs))
    await waitFor(() => expect(screen.getByText('孔廟商圈')).toBeTruthy())
    fireEvent.click(screen.getByText('孔廟商圈'))
    expect(onSelectThemeChild).toHaveBeenCalledTimes(1)
    expect(onSelectThemeChild.mock.calls[0][0]).toBe('t')
    expect(onSelectThemeChild.mock.calls[0][1]).toMatchObject({ id: 'c2' })
    expect(onPanToStop).not.toHaveBeenCalled()
  })
})
