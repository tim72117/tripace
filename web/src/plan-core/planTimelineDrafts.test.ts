// planTimelineDrafts.test.ts——startNewDraft 的清單行為回歸測試。
//
// 重點是「空白草稿不該佔清單」:使用者連按「新行程」時,每次都會建立新
// 草稿 id,若新草稿一建立就被歸檔,清單會累積一排沒有內容的項目
// (startNewDraft 原本註解宣稱的「自我清理」並不會發生——被寫進去的空白
// 項目沒有任何路徑會移除它)。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { PlanTimeline } from './planTimeline'
import { createEmptyTimeline } from './planTimeline'
import { LEGACY_DRAFT_ID, readDraftsIndex, startNewDraft } from './planTimelineDrafts'

// isTimelineEmpty 看有沒有任何節點,測試用最小的非空時間軸即可,不需要走完整
// 的 insertAfter。
function nonEmptyTimeline(): PlanTimeline {
  return { days: [{ id: 'd1', nodes: [{ id: 'n1', type: 'stop' }] }] }
}

// 自備記憶體版 localStorage:這個專案的 vitest + jsdom 環境下全域
// localStorage 可能是不完整的物件(clear/getItem 不存在),會讓依賴它的
// 測試整批失敗(planTimelineStore.test.ts 同樣受影響)。這份測試驗證的
// 是清單邏輯,不是 Storage 本身,所以顯式提供一份行為單純的替身。
function createMemoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => { data.delete(k) },
    setItem: (k, v) => { data.set(k, String(v)) },
  }
}

describe('startNewDraft', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('目前草稿有內容:歸檔它的 id,並回傳新的草稿 id', () => {
    const newId = startNewDraft('draft-a', nonEmptyTimeline())

    expect(newId).not.toBe('draft-a')
    expect(readDraftsIndex().map((d) => d.id)).toEqual(['draft-a'])
  })

  it('目前還沒有草稿 id 且內容非空:以 LEGACY_DRAFT_ID 歸檔', () => {
    startNewDraft(null, nonEmptyTimeline())

    expect(readDraftsIndex().map((d) => d.id)).toEqual([LEGACY_DRAFT_ID])
  })

  it('目前草稿是空白的:不歸檔任何東西', () => {
    startNewDraft('draft-a', createEmptyTimeline())

    expect(readDraftsIndex()).toEqual([])
  })

  it('連按多次「新行程」(每次目前草稿都還是空白):清單不會累積空白項目', () => {
    let current: string | null = null
    for (let i = 0; i < 5; i++) {
      current = startNewDraft(current, createEmptyTimeline())
    }

    expect(readDraftsIndex()).toEqual([])
  })

  it('新草稿之後有了內容再按「新行程」:才會以該草稿 id 進入清單', () => {
    const second = startNewDraft('draft-a', nonEmptyTimeline())
    startNewDraft(second, nonEmptyTimeline())

    expect(readDraftsIndex().map((d) => d.id)).toEqual(['draft-a', second])
  })
})
