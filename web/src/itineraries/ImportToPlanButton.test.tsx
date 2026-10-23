// ImportToPlanButton——「帶入我的規劃」:寫入草稿成功就前往 /app;草稿有內容時展開頁內確認列(不用原生 confirm);失敗顯示訊息不跳轉;沒有站就停用。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ImportToPlanButton, IMPORT_REPLACE_MESSAGE } from './ImportToPlanButton'
import { createEmptyTimeline, listNodes, type PlanNode, type PlanTimeline } from '../planning/timeline/model'
import { timelineOf } from '../planning/timeline/fixtures'
import { clearTimeline, loadTimelineWithRev, saveTimeline } from '../planning/timeline/storage'

function oneStop(name: string): PlanTimeline {
  return timelineOf([{ id: 'n0', type: 'stop', name, time: '09:00', kind: '景點', duration: '1h', lat: 1, lng: 2 } as PlanNode])
}
const savedNames = () => listNodes(loadTimelineWithRev().timeline).map((n) => n.name)

function setup(timeline: PlanTimeline) {
  return render(
    <MemoryRouter initialEntries={['/itineraries/x']}>
      <Routes>
        <Route path="/itineraries/x" element={<ImportToPlanButton timeline={timeline} />} />
        <Route path="/app" element={<div data-testid="app" />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  clearTimeline()
})
afterEach(() => vi.restoreAllMocks())

describe('ImportToPlanButton', () => {
  it('草稿是空的:寫入並前往 /app,不展開確認列、也不呼叫原生 confirm', () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { getByText, getByTestId, queryByRole } = setup(oneStop('A'))
    fireEvent.click(getByText('帶入我的規劃'))
    expect(confirm).not.toHaveBeenCalled()
    expect(queryByRole('alertdialog')).toBeNull()
    expect(getByTestId('app')).toBeTruthy()
    expect(savedNames()).toEqual(['A'])
  })

  it('草稿已有內容:展開頁內確認列,不寫入、不跳轉、不呼叫原生 confirm', () => {
    saveTimeline(oneStop('舊'), 0)
    const confirm = vi.spyOn(window, 'confirm')
    const { getByText, getByRole, queryByTestId } = setup(oneStop('A'))
    fireEvent.click(getByText('帶入我的規劃'))
    expect(confirm).not.toHaveBeenCalled()
    expect(getByRole('alertdialog').textContent).toContain(IMPORT_REPLACE_MESSAGE)
    expect(queryByTestId('app')).toBeNull()
    expect(savedNames()).toEqual(['舊'])
  })

  it('確認列按「取消」或 Esc:收起,草稿不變', () => {
    saveTimeline(oneStop('舊'), 0)
    const { getByText, queryByRole, getByRole } = setup(oneStop('A'))
    fireEvent.click(getByText('帶入我的規劃'))
    fireEvent.click(getByText('取消'))
    expect(queryByRole('alertdialog')).toBeNull()
    fireEvent.click(getByText('帶入我的規劃'))
    fireEvent.keyDown(getByRole('alertdialog'), { key: 'Escape' })
    expect(queryByRole('alertdialog')).toBeNull()
    expect(savedNames()).toEqual(['舊'])
  })

  it('確認列按「取代並帶入」:取代草稿並前往 /app', () => {
    saveTimeline(oneStop('舊'), 0)
    const { getByText, getByTestId } = setup(oneStop('A'))
    fireEvent.click(getByText('帶入我的規劃'))
    fireEvent.click(getByText('取代並帶入'))
    expect(getByTestId('app')).toBeTruthy()
    expect(savedNames()).toEqual(['A'])
  })

  it('寫入失敗:顯示訊息、不跳轉', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    const { getByText, getByRole, queryByTestId } = setup(oneStop('A'))
    fireEvent.click(getByText('帶入我的規劃'))
    expect(getByRole('alert').textContent).toContain('帶入失敗')
    expect(queryByTestId('app')).toBeNull()
  })

  it('時間軸沒有任何站:按鈕停用', () => {
    const { getByText } = setup(createEmptyTimeline())
    expect((getByText('帶入我的規劃').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
})
