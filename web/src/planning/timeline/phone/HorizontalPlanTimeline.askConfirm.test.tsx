// 手機版時間軸內建的詢問頁:askPageConfirmViaComposer 傳入時景點候選頁沒有「確認選擇」按鈕,沒傳時保留。
import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithPlanData as render } from '../../data/fixtures'
import { HorizontalPlanTimeline } from './HorizontalPlanTimeline'
import { timelineOf } from '../fixtures'

const noop = () => {}

function setup(extra: Partial<React.ComponentProps<typeof HorizontalPlanTimeline>> = {}) {
  return render(
    <HorizontalPlanTimeline
      timeline={timelineOf([])}
      selectedStopId={null}
      onSelectStop={noop}
      onOpenPhotos={noop}
      showAskPage
      askPageInput={{ candidates: [{ placeId: 'p1', name: '赤崁樓' }] }}
      onAskPageDone={noop}
      {...extra}
    />,
  )
}

describe('HorizontalPlanTimeline 詢問頁的確認方式', () => {
  it('預設:有「確認選擇」按鈕', () => {
    setup()
    expect(screen.getByRole('button', { name: /確認選擇/ })).toBeTruthy()
  })

  it('askPageConfirmViaComposer:沒有「確認選擇」按鈕', () => {
    setup({ askPageConfirmViaComposer: true })
    expect(screen.queryByRole('button', { name: /確認選擇/ })).toBeNull()
  })
})
