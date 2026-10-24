// 手機版橫向時間軸的住宿卡(PlanTimeline.lodgings):比照「空天佔位卡」的做法,在入住日那天第一張卡之前合成一張窄版住宿卡,
// 不是 stop,不影響時間尺與卷軸選取以外的任何東西;連住的後續天不重複。
import { beforeAll, describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithPlanData as render } from '../../data/fixtures'
import { HorizontalPlanTimeline } from './HorizontalPlanTimeline'
import type { PlanLodging, PlanNode } from '../model'
import { timelineOf } from '../fixtures'

const stopNode = (id: string, day: number, time = '09:00'): PlanNode => ({ id, type: 'stop', name: `站${id}`, time, duration: '停留 1h', day })

function renderWith(lodgings: PlanLodging[], onSelectStop = vi.fn()) {
  const timeline = { ...timelineOf([stopNode('a', 1), stopNode('b', 2), stopNode('c', 3)]), lodgings }
  const utils = render(<HorizontalPlanTimeline timeline={timeline} selectedStopId={null} onSelectStop={onSelectStop} onOpenPhotos={() => {}} />)
  return { ...utils, onSelectStop }
}

describe('HorizontalPlanTimeline 住宿卡', () => {
  // jsdom 沒有 scrollIntoView,點卡片會呼叫它。
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  const lodgings: PlanLodging[] = [{ id: 'L1', name: '海景飯店', dayIds: ['d2', 'd3'] }]

  it('只在入住日畫一張,排在那天第一張卡之前,顯示名稱與區間', () => {
    const { container } = renderWith(lodgings)
    const cards = container.querySelectorAll('[data-lodging-id]')
    expect(cards).toHaveLength(1)
    expect(screen.getByText('海景飯店')).toBeTruthy()
    expect(screen.getByText('Day 2–3')).toBeTruthy()
    // DOM 順序:Day 2 的住宿卡在 b 之前、c 之前
    const html = container.innerHTML
    expect(html.indexOf('data-lodging-id="L1"')).toBeGreaterThan(html.indexOf('站a'))
    expect(html.indexOf('data-lodging-id="L1"')).toBeLessThan(html.indexOf('站b'))
  })

  it('點住宿卡:onSelectStop 收到旅館 id', () => {
    const { container, onSelectStop } = renderWith(lodgings)
    fireEvent.click(container.querySelector('[data-lodging-id="L1"]')!)
    expect(onSelectStop).toHaveBeenCalledWith('L1')
  })

  it('不影響時間尺:住宿卡不會多出時間尺區段', () => {
    const { container } = renderWith(lodgings)
    // 選取第 1 天的站時只有 a 一個區段;住宿卡沒有時間不產生區段
    expect(container.querySelectorAll('button[aria-label^="跳到"]')).toHaveLength(1)
  })

  it('沒有名稱也沒有 placeId 時退回「住宿」', () => {
    renderWith([{ id: 'L2', dayIds: ['d1'] }])
    expect(screen.getByText('住宿')).toBeTruthy()
  })

  it('同一天入住兩間各一張,依 lodgings 順序', () => {
    const { container } = renderWith([
      { id: 'A', name: '甲', dayIds: ['d1', 'd2'] },
      { id: 'B', name: '乙', dayIds: ['d2'] },
    ])
    const ids = Array.from(container.querySelectorAll('[data-lodging-id]')).map((e) => e.getAttribute('data-lodging-id'))
    expect(ids).toEqual(['A', 'B'])
  })
})
