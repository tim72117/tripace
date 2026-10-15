// planTimelineStore.test.ts — PlanTimelineStore 介面與兩個內建實作
// (localStoragePlanTimelineStore/noopPlanTimelineStore)的回歸測試。
//
// 存在的理由(2026-10,/ai-plan 展示頁交接給真實 TripPlanPage 之後):
// TripPlanPage 原本直接 import planTimelineStorage.ts 的三個函式
// (readRev/loadTimelineWithRev/saveTimeline)呼叫,新增 store prop 把這
// 三個讀寫動作收斂成一個可替換的介面(見該檔案 PlanTimelineStore 的完整
// 說明)。這裡不重新渲染 TripPlanPage 本身(那個元件會建立 onagent
// WebSocket 連線、依賴 google.maps,成本遠高於這次要保護的邏輯,見同資料夾
// trip-plan/selectedStopSync.test.tsx 的同一種取捨),改成:
//   1. 直接測兩個內建 store 實作本身的行為。
//   2. 用「掛載 → 讀初值 → 卸載 → 重新掛載」這個最小同構情境,驗證
//      noopPlanTimelineStore 確實讓重新掛載不保留上次異動的內容——這正是
//      TripPlanPage 初始化時實際呼叫 store.loadTimelineWithRev() 的方式
//      (見 TripPlanPage.tsx useTripPlanTimeline 的 initialRef 寫法)。
import { describe, it, expect, beforeEach } from 'vitest'
import { createEmptyTimeline, insertAfter } from './planTimeline'
import type { PlanTimeline } from './planTimeline'
import {
  localStoragePlanTimelineStore,
  noopPlanTimelineStore,
  loadTimeline,
  PLAN_TIMELINE_STORAGE_KEY,
  type PlanTimelineStore,
} from './planTimelineStorage'

function timelineWith(name: string): PlanTimeline {
  const r = insertAfter(createEmptyTimeline(), null, { type: 'stop', name }, `n-${name}`)
  if (!r.ok) throw new Error('fixture 建立失敗')
  return r.timeline
}

function namesOf(t: PlanTimeline): string[] {
  return [...t.nodes.values()].map((n) => n.name ?? '')
}

// mountTripPlanPageLike — 與 TripPlanPage.tsx useTripPlanTimeline 的
// initialRef 寫法同構的最小重現:掛載時用 store.loadTimelineWithRev()
// 讀一次初值,之後透過 store.saveTimeline() 寫入異動。不需要整個
// useSyncedState/commitTimeline 機制,這裡只驗證「store 切換」這個行為
// 本身,不是整條時間軸資料流。
function mountTripPlanPageLike(store: PlanTimelineStore) {
  let rev = 0
  let timeline: PlanTimeline
  ;({ timeline, rev } = store.loadTimelineWithRev())
  return {
    get timeline() { return timeline },
    insertStop(name: string, id: string) {
      const r = insertAfter(timeline, timeline.headId == null ? null : [...timeline.nodes.values()].slice(-1)[0].id, { type: 'stop', name }, id)
      if (!r.ok) throw new Error('insert failed')
      timeline = r.timeline
      const saved = store.saveTimeline(timeline, rev)
      if (saved !== null) rev = saved
    },
  }
}

describe('localStoragePlanTimelineStore', () => {
  beforeEach(() => {
    localStorage.removeItem(PLAN_TIMELINE_STORAGE_KEY)
  })

  it('readRev/loadTimelineWithRev/saveTimeline 原樣委派給同名函式', () => {
    expect(localStoragePlanTimelineStore.readRev()).toBe(0)
    const saved = localStoragePlanTimelineStore.saveTimeline(timelineWith('赤崁樓'), 0)
    expect(saved).toBe(1)
    expect(localStoragePlanTimelineStore.readRev()).toBe(1)
    const { timeline, rev } = localStoragePlanTimelineStore.loadTimelineWithRev()
    expect(namesOf(timeline)).toEqual(['赤崁樓'])
    expect(rev).toBe(1)
    // 跟直接呼叫模組既有函式讀到的內容一致——這層包裝不改變底層行為。
    expect(namesOf(loadTimeline())).toEqual(['赤崁樓'])
  })

  it('掛載 → 寫入 → 卸載 → 重新掛載:內容會保留(對照組)', () => {
    const first = mountTripPlanPageLike(localStoragePlanTimelineStore)
    first.insertStop('使用者排的', 'n1')
    expect(namesOf(first.timeline)).toEqual(['使用者排的'])

    // 模擬卸載再重新掛載:新的一次 loadTimelineWithRev() 呼叫
    const second = mountTripPlanPageLike(localStoragePlanTimelineStore)
    expect(namesOf(second.timeline)).toEqual(['使用者排的'])
  })
})

describe('noopPlanTimelineStore', () => {
  beforeEach(() => {
    localStorage.removeItem(PLAN_TIMELINE_STORAGE_KEY)
  })

  it('readRev 固定回 0', () => {
    expect(noopPlanTimelineStore.readRev()).toBe(0)
  })

  it('loadTimelineWithRev 固定回空時間軸與 rev 0', () => {
    const { timeline, rev } = noopPlanTimelineStore.loadTimelineWithRev()
    expect(namesOf(timeline)).toEqual([])
    expect(rev).toBe(0)
  })

  it('saveTimeline 固定回 null,且不寫進 localStorage', () => {
    const saved = noopPlanTimelineStore.saveTimeline(timelineWith('展示用的站'), 0)
    expect(saved).toBeNull()
    expect(localStorage.getItem(PLAN_TIMELINE_STORAGE_KEY)).toBeNull()
  })

  it('不會動到既有使用者真正排好的 localStorage 內容(展示頁交接情境)', () => {
    // 使用者先在 /app 用正式 store 排了一趟行程。
    localStoragePlanTimelineStore.saveTimeline(timelineWith('使用者排的'), 0)

    // /ai-plan 交接給 LivePlanLayer,用 noopPlanTimelineStore 掛載、
    // 異動幾站。
    const live = mountTripPlanPageLike(noopPlanTimelineStore)
    expect(namesOf(live.timeline)).toEqual([])
    live.insertStop('展示用的站', 'n-live')
    expect(namesOf(live.timeline)).toEqual(['展示用的站'])

    // localStorage 裡使用者原本那份完全沒被動到。
    expect(namesOf(loadTimeline())).toEqual(['使用者排的'])
  })

  it('重新掛載不會保留上次異動的內容(與 localStoragePlanTimelineStore 的對照組相反)', () => {
    const first = mountTripPlanPageLike(noopPlanTimelineStore)
    first.insertStop('這一次的展示內容', 'n1')
    expect(namesOf(first.timeline)).toEqual(['這一次的展示內容'])

    // 重新掛載(例如使用者重新整理 /ai-plan 頁面):應該是全新的空時間軸,
    // 不會看到上一輪展示留下的內容。
    const second = mountTripPlanPageLike(noopPlanTimelineStore)
    expect(namesOf(second.timeline)).toEqual([])
  })
})
