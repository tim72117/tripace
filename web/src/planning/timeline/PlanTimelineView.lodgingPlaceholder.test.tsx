import { describe, it, expect } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithPlanData as render } from '../data/fixtures'
import type { PlanAiDataSource } from '../data/source'
import { PlanTimelineView } from './PlanTimelineView'
import type { PlanLodging, PlanNode } from './model'
import { timelineOf } from './fixtures'
import styles from './PlanTimelineView.module.css'

// 住宿橫幅先站位(版面不跳):旅館 placeId 的查詢還沒回來時,橫幅就要以作者寫的名稱(沒有就「住宿」)畫出完整的一列,
// 查詢回來只換文字/可點與否,外框(列、橫幅的 class 與子結構)不變——否則旅館列晚出現會把後面所有站點卡往下推。
// 查詢失敗(found:false 或 reject)時同樣保留作者名稱與外框。
// jsdom 沒有版面,高度無法量;這裡斷言的是「各狀態的 class 與 DOM 結構相同」這個結構契約(像素高度不在本測試範圍)。

function stop(id: string, over: Partial<PlanNode> = {}): PlanNode {
  return { id, type: 'stop', name: id, time: '10:00', duration: '1 小時', kind: '景點', desc: `${id}描述`, lat: 1, lng: 2, ...over } as PlanNode
}

type Outcome = { found: true; name: string; lat: number; lng: number } | { found: false } | { reject: Error }

// deferredDataSource——placeDetails 一直掛著,直到測試呼叫 settleAll(模擬 API 被擋住/很慢),
// 再依 outcome 回成功、查無(found:false)或 reject。
function deferredDataSource(outcome: Outcome) {
  const pending: Array<() => void> = []
  const ds = {
    placeDetails: () =>
      new Promise((resolve, reject) => {
        pending.push(() => {
          if ('reject' in outcome) reject(outcome.reject)
          else if (outcome.found) resolve({ ...outcome, googlePhotoUrls: [] })
          else resolve({ found: false })
        })
      }),
    transitEstimate: async () => ({ mode: 'walking', icon: '', minutes: 0, distance: '' }),
  } as unknown as PlanAiDataSource
  return { ds, pendingCount: () => pending.length, settleAll: () => pending.splice(0).forEach((f) => f()) }
}

function renderTimeline(lodgings: PlanLodging[], ds: PlanAiDataSource) {
  const timeline = { ...timelineOf([stop('s1', { day: 1 }), stop('s2', { day: 2 })]), lodgings }
  return render(
    <PlanTimelineView
      timeline={timeline}
      isThinking={false}
      emptyStateMessage=""
      selectedStopId={null}
      showJumpPill={false}
      onJumpToLatest={() => {}}
      onPanToStop={() => {}}
      onOpenPhotos={() => {}}
      mountedIdsRef={{ current: new Set() }}
    />,
    ds,
  )
}

const bannerOf = (c: HTMLElement, id: string) => {
  const el = c.querySelector<HTMLElement>(`[data-lodging-id="${id}"]`)
  if (!el) throw new Error(`找不到住宿橫幅 ${id}`)
  return el
}

// shapeOf——橫幅外框的「版面指紋」:列/外層/橫幅本身的 class,以及每個子元素的標籤與 class(不含文字)。
// 列與外層以 closest 找 styles.lodgingRow/lodgingBannerWrap(不依賴 parentElement 層數)。
function shapeOf(banner: HTMLElement) {
  const row = banner.closest<HTMLElement>(`.${styles.lodgingRow}`)
  const wrap = banner.closest<HTMLElement>(`.${styles.lodgingBannerWrap}`)
  expect(row).not.toBeNull()
  expect(wrap).not.toBeNull()
  const walk = (el: Element): unknown => ({ tag: el.tagName, cls: el.className, children: [...el.children].map(walk) })
  return { row: row!.className, wrap: wrap!.className, banner: walk(banner) }
}

describe('PlanTimelineView 住宿橫幅先站位', () => {
  it('查詢未回來時已畫出完整橫幅(作者寫的名稱 + 區間),回來後外框 class 與結構不變、只換名稱', async () => {
    const { ds, settleAll } = deferredDataSource({ found: true, name: 'Google 上的旅館名', lat: 5, lng: 6 })
    const { container } = renderTimeline([{ id: 'l1', placeId: 'p1', name: '作者寫的旅館', dayIds: ['d1', 'd2'] }], ds)

    const before = bannerOf(container, 'l1')
    expect(before.contains(screen.getByText('作者寫的旅館'))).toBe(true)
    expect(before.contains(screen.getByText('Day 1–2'))).toBe(true)
    // 橫幅在 Day 1 第一張卡之前(先站位,而不是資料到了才插進來)
    const firstCardDesc = screen.getByText('s1描述')
    expect(before.compareDocumentPosition(firstCardDesc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const shapeBefore = shapeOf(before)

    await act(async () => {
      settleAll()
    })
    expect(await screen.findByText('Google 上的旅館名')).toBeTruthy()
    expect(screen.queryByText('作者寫的旅館')).toBeNull()
    const after = bannerOf(container, 'l1')
    // 同一個 DOM 節點(沒有卸載重掛、不會重播進場動畫),外框指紋完全相同
    expect(after).toBe(before)
    expect(shapeOf(after)).toEqual(shapeBefore)
  })

  it.each<[string, Outcome]>([
    ['查無(found:false)', { found: false }],
    ['查詢失敗(reject)', { reject: new Error('network') }],
  ])('%s:橫幅保留作者寫的名稱,外框指紋不變、同一個節點', async (_label, outcome) => {
    const { ds, settleAll, pendingCount } = deferredDataSource(outcome)
    const { container } = renderTimeline([{ id: 'l1', placeId: 'p1', name: '作者寫的旅館', dayIds: ['d1', 'd2'] }], ds)
    const before = bannerOf(container, 'l1')
    const shapeBefore = shapeOf(before)
    expect(pendingCount()).toBeGreaterThan(0)

    await act(async () => {
      settleAll()
    })
    const after = bannerOf(container, 'l1')
    expect(after).toBe(before)
    expect(after.contains(screen.getByText('作者寫的旅館'))).toBe(true)
    expect(after.contains(screen.getByText('Day 1–2'))).toBe(true)
    expect(shapeOf(after)).toEqual(shapeBefore)
    // 沒查到座標:不可點
    expect(after.getAttribute('role')).toBeNull()
  })

  it('沒寫名稱的旅館:查詢未回來時以「住宿」站位,結構與有名稱時相同', async () => {
    const { ds, settleAll } = deferredDataSource({ found: false })
    const { container } = renderTimeline(
      [
        { id: 'named', placeId: 'p1', name: '有名稱', dayIds: ['d1'] },
        { id: 'unnamed', placeId: 'p2', dayIds: ['d2'] },
      ],
      ds,
    )
    const named = bannerOf(container, 'named')
    const unnamed = bannerOf(container, 'unnamed')
    expect(unnamed.contains(screen.getByText('住宿'))).toBe(true)
    expect(shapeOf(unnamed)).toEqual(shapeOf(named))
    // 收尾:讓掛著的查詢結束,不留未完成的非同步到下一個測試
    await act(async () => {
      settleAll()
    })
  })
})
