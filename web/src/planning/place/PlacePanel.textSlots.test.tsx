// PlacePanel 的徽章列/簡介站位——Google 地點來源開卡時評分與簡介還沒到
// (見 infoContent.ts 的 reservesLateTextSlots 說明),徽章列與簡介要先
// 佔好位置、class 不變,資料補上時「加入行程」按鈕組不被往下推。
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PlacePanel, type PlaceInfoContent } from './PlacePanel'
import { reservesLateTextSlots } from './infoContent'
import styles from './PlacePanel.module.css'
import type { GeoAttraction } from '../../api'

// lateText:Google 地點來源、評分與簡介都還沒有的內容(本身不帶 textStatus,
// 即「查完了但沒有文字」;要測查詢中骨架時另外加 textStatus: 'pending')。
// 原名 pending 名不符實(沒有 textStatus),2026-10 改名。
const lateText: PlaceInfoContent = {
  name: '九份老街',
  placeId: 'p1',
  subtitle: '新北市瑞芳區基山街',
  badges: [],
  candidate: { kind: 'place', name: '九份老街', address: '新北市瑞芳區基山街', lat: 25.1, lng: 121.8, primaryType: '' } as PlaceInfoContent['candidate'],
}
const arrived: PlaceInfoContent = { ...lateText, summary: '依山而建的老街。', badges: ['評分 4.3'] }

describe('reservesLateTextSlots', () => {
  it('Google 地點(有 placeId、非人工建檔景點)要預留', () => {
    expect(reservesLateTextSlots(lateText)).toBe(true)
  })
  it('沒有 placeId 或人工建檔景點不預留', () => {
    expect(reservesLateTextSlots({ name: 'x', badges: [] })).toBe(false)
    expect(
      reservesLateTextSlots({
        name: 'x',
        placeId: 'p2',
        badges: [],
        candidate: { kind: 'attraction', name: 'x' } as unknown as GeoAttraction & { kind: 'attraction' },
      } as PlaceInfoContent),
    ).toBe(false)
  })
})

describe('PlacePanel 文字晚到時的站位', () => {
  it('評分/簡介還沒到:仍渲染空的 .metaRow 與帶 .summaryReserved 的簡介', () => {
    const { container } = render(<PlacePanel content={lateText} onClose={() => {}} />)
    const meta = container.querySelector(`.${styles.metaRow}`)
    expect(meta).not.toBeNull()
    expect(meta!.children.length).toBe(0)
    const summary = container.querySelector(`.${styles.summaryEmpty}`)!
    expect(summary.className).toContain(styles.summaryReserved)
  })

  it('資料補上後:.metaRow 與簡介仍帶同一組站位 class', () => {
    const { container, rerender } = render(<PlacePanel content={lateText} onClose={() => {}} />)
    rerender(<PlacePanel content={arrived} onClose={() => {}} />)
    expect(container.querySelector(`.${styles.metaRow}`)!.children.length).toBe(1)
    expect(container.querySelector(`.${styles.summary}`)!.className).toContain(styles.summaryReserved)
  })

  it('沒有 placeId 的來源(例如行程 entry)不額外預留空白', () => {
    const { container } = render(<PlacePanel content={{ name: '飯店', badges: [] }} onClose={() => {}} />)
    expect(container.querySelector(`.${styles.metaRow}`)).toBeNull()
    expect(container.querySelector(`.${styles.summaryEmpty}`)!.className).not.toContain(styles.summaryReserved)
  })
})

// textStatus:Google 地點文字查詢(簡介、評分)的進度——'pending' 時簡介區
// 與徽章列換成骨架(不是「還沒有簡介資料」那句,那句只留給查詢完成但真的
// 沒有簡介的情況),'failed' 時顯示「簡介載入失敗。」,不永遠停在骨架。
describe('PlacePanel 文字查詢中的骨架', () => {
  const loading: PlaceInfoContent = { ...lateText, textStatus: 'pending' }

  it('textStatus=pending:簡介區是帶 aria 的骨架(3 條),不顯示「還沒有簡介資料」', () => {
    const { container, getByRole, queryByText } = render(<PlacePanel content={loading} onClose={() => {}} />)
    const status = getByRole('status', { name: '簡介載入中' })
    expect(status.querySelectorAll('[data-skeleton-line]').length).toBe(3)
    expect(queryByText('這個地點還沒有簡介資料。')).toBeNull()
    // 外框沿用 .summaryEmpty + .summaryReserved,跟真內容同一組高度規則。
    expect(status.className).toContain(styles.summaryReserved)
    // 徽章列也有一顆同尺寸的骨架徽章。
    const meta = container.querySelector(`.${styles.metaRow}`)!
    expect(meta.querySelectorAll('[data-skeleton="block"]').length).toBe(1)
  })

  it('文字到了:骨架消失、簡介與徽章顯示,外框仍帶 .summaryReserved', () => {
    const { container, rerender, queryByRole } = render(<PlacePanel content={loading} onClose={() => {}} />)
    rerender(<PlacePanel content={{ ...arrived, textStatus: undefined }} onClose={() => {}} />)
    expect(queryByRole('status', { name: '簡介載入中' })).toBeNull()
    expect(container.querySelector(`.${styles.metaRow} [data-skeleton="block"]`)).toBeNull()
    expect(container.querySelector(`.${styles.summary}`)!.className).toContain(styles.summaryReserved)
    expect(container.querySelector(`.${styles.metaRow}`)!.textContent).toBe('評分 4.3')
  })

  it('查詢完成但沒有簡介:仍顯示原句', () => {
    const { getByText, queryByRole } = render(<PlacePanel content={lateText} onClose={() => {}} />)
    expect(getByText('這個地點還沒有簡介資料。')).toBeTruthy()
    expect(queryByRole('status')).toBeNull()
  })

  it('textStatus=failed:顯示「簡介載入失敗。」且沒有骨架', () => {
    const { container, getByText, queryByRole } = render(
      <PlacePanel content={{ ...lateText, textStatus: 'failed' }} onClose={() => {}} />,
    )
    const p = getByText('簡介載入失敗。')
    expect(p.className).toContain(styles.summaryReserved)
    expect(queryByRole('status')).toBeNull()
    expect(container.querySelector(`.${styles.metaRow} [data-skeleton="block"]`)).toBeNull()
  })
})
