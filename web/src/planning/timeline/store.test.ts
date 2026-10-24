// store.test.ts(planning/timeline)— PlanTimelineStore 介面與內建 localStorage 實作
// (localStoragePlanTimelineStore,在 storage.ts)的回歸測試。(原本還有 noopPlanTimelineStore,2026-10 刪除,見 storage.ts 結尾的說明。)
//
// 存在的理由(2026-10,/ai-plan 展示頁交接給真實 TripPlanPage 之後):
// TripPlanPage 原本直接 import storage.ts(當時叫 planTimelineStorage.ts)的三個函式
// (readRev/loadTimelineWithRev/saveTimeline)呼叫,新增 store prop 把這
// 三個讀寫動作收斂成一個可替換的介面(見該檔案 PlanTimelineStore 的完整
// 說明)。這裡不重新渲染 TripPlanPage 本身(那個元件會建立 onagent
// WebSocket 連線、依賴 google.maps,成本遠高於這次要保護的邏輯,見同資料夾
// planning/panel/selectedStopSync.test.tsx 的同一種取捨),改成:
//   1. 直接測內建 store 實作本身的行為。
//   2. 用「掛載 → 讀初值 → 卸載 → 重新掛載」這個最小同構情境,驗證內容會保留——這正是
//      時間軸初始化時實際呼叫 store.loadTimelineWithRev() 的方式(見 usePlanTimelineCore 的 initialRef 寫法)。
import { describe, it, expect, beforeEach } from 'vitest'
import { createEmptyTimeline, insertAfter, isTimelineEmpty, listNodes } from './model'
import type { PlanTimeline } from './model'
import {
  localStoragePlanTimelineStore,
  loadTimeline,
  PLAN_TIMELINE_STORAGE_KEY,
  type PlanTimelineStore,
} from './storage'

function timelineWith(name: string): PlanTimeline {
  const r = insertAfter(createEmptyTimeline(), null, { type: 'stop', name }, `n-${name}`)
  if (!r.ok) throw new Error('fixture 建立失敗')
  return r.timeline
}

function namesOf(t: PlanTimeline): string[] {
  return listNodes(t).map((n) => n.name ?? '')
}

// mountTripPlanPageLike — 與 usePlanTimelineCore 的
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
      const r = insertAfter(timeline, isTimelineEmpty(timeline) ? null : listNodes(timeline).slice(-1)[0].id, { type: 'stop', name }, id)
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
