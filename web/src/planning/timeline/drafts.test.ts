// drafts.test.ts——startNewDraft 的清單行為回歸測試。
//
// 重點是「空白草稿不該佔清單」:使用者連按「新行程」時,每次都會建立新
// 草稿 id,若新草稿一建立就被歸檔,清單會累積一排沒有內容的項目
// (startNewDraft 原本註解宣稱的「自我清理」並不會發生——被寫進去的空白
// 項目沒有任何路徑會移除它)。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { PlanTimeline } from './model'
import { createEmptyTimeline } from './model'
import {
  DRAFTS_INDEX_KEY,
  LEGACY_DRAFT_ID,
  deriveDraftTitle,
  readDraftsIndex,
  sortDraftsByRecent,
  startNewDraft,
  touchDraft,
} from './drafts'

// isTimelineEmpty 看有沒有任何節點,測試用最小的非空時間軸即可,不需要走完整
// 的 insertAfter。
function nonEmptyTimeline(): PlanTimeline {
  return { days: [{ id: 'd1', nodes: [{ id: 'n1', type: 'stop' }] }] }
}

// namedTimeline——帶上指定站名的時間軸,給 deriveDraftTitle/touchDraft
// 的測試用(nonEmptyTimeline 的單一節點沒有 name,無法驗證標題推導)。
function namedTimeline(names: string[]): PlanTimeline {
  return {
    days: [
      {
        id: 'd1',
        nodes: names.map((name, i) => ({ id: `n${i}`, type: 'stop' as const, name })),
      },
    ],
  }
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

describe('deriveDraftTitle', () => {
  it('沒有任何站點時回傳預設標題', () => {
    expect(deriveDraftTitle(createEmptyTimeline())).toBe('新行程')
  })

  it('站點沒有名稱(例如還在查詢中)時回傳預設標題', () => {
    expect(deriveDraftTitle(nonEmptyTimeline())).toBe('新行程')
  })

  it('一個站點:直接用站名當標題', () => {
    expect(deriveDraftTitle(namedTimeline(['九份老街']))).toBe('九份老街')
  })

  it('兩個站點:用頓號接起來,不加省略符號', () => {
    expect(deriveDraftTitle(namedTimeline(['九份老街', '阿妹茶樓']))).toBe('九份老街、阿妹茶樓')
  })

  it('超過兩個站點:只取前兩個,加上省略符號表示還有更多', () => {
    expect(deriveDraftTitle(namedTimeline(['九份老街', '阿妹茶樓', '昇平戲院']))).toBe('九份老街、阿妹茶樓⋯等')
  })

  it('忽略沒有名稱的站點,用第一個有名稱的開始算', () => {
    const timeline: PlanTimeline = {
      days: [{ id: 'd1', nodes: [{ id: 'n0', type: 'stop' }, { id: 'n1', type: 'stop', name: '九份老街' }] }],
    }
    expect(deriveDraftTitle(timeline)).toBe('九份老街')
  })
})

describe('touchDraft', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('空白時間軸不寫入清單', () => {
    touchDraft('draft-a', createEmptyTimeline())

    expect(readDraftsIndex()).toEqual([])
  })

  it('有內容時寫入清單,標題用 deriveDraftTitle 推導', () => {
    touchDraft('draft-a', namedTimeline(['九份老街']))

    const drafts = readDraftsIndex()
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({ id: 'draft-a', title: '九份老街' })
  })

  it('第一次存檔的 createdAt 與 updatedAt 相同', () => {
    touchDraft('draft-a', namedTimeline(['九份老街']))

    const [draft] = readDraftsIndex()
    expect(draft.createdAt).toBe(draft.updatedAt)
  })

  it('同一份草稿再次存檔:保留原本的 createdAt,更新 updatedAt 與 title', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    touchDraft('draft-a', namedTimeline(['九份老街']))
    const firstCreatedAt = readDraftsIndex()[0].createdAt

    vi.setSystemTime(2000)
    touchDraft('draft-a', namedTimeline(['九份老街', '阿妹茶樓']))

    const [draft] = readDraftsIndex()
    expect(draft.createdAt).toBe(firstCreatedAt)
    expect(draft.updatedAt).toBe(2000)
    expect(draft.title).toBe('九份老街、阿妹茶樓')
    vi.useRealTimers()
  })

  it('同一份草稿多次存檔,清單裡只有一筆,不會重複累積', () => {
    touchDraft('draft-a', namedTimeline(['九份老街']))
    touchDraft('draft-a', namedTimeline(['九份老街', '阿妹茶樓']))
    touchDraft('draft-a', namedTimeline(['九份老街', '阿妹茶樓', '昇平戲院']))

    expect(readDraftsIndex()).toHaveLength(1)
  })
})

describe('readDraftsIndex 對舊格式的相容', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('舊版資料沒有 updatedAt/title 欄位:補上預設值,不整筆丟棄', () => {
    localStorage.setItem(
      DRAFTS_INDEX_KEY,
      JSON.stringify({ version: 1, drafts: [{ id: 'draft-a', createdAt: 123 }] }),
    )

    const [draft] = readDraftsIndex()
    expect(draft).toEqual({ id: 'draft-a', createdAt: 123, updatedAt: 123, title: '新行程' })
  })
})

describe('sortDraftsByRecent', () => {
  it('依 updatedAt 由新到舊排序,不修改原陣列', () => {
    const drafts = [
      { id: 'a', createdAt: 1, updatedAt: 100, title: 'A' },
      { id: 'b', createdAt: 1, updatedAt: 300, title: 'B' },
      { id: 'c', createdAt: 1, updatedAt: 200, title: 'C' },
    ]
    const original = [...drafts]

    const sorted = sortDraftsByRecent(drafts)

    expect(sorted.map((d) => d.id)).toEqual(['b', 'c', 'a'])
    expect(drafts).toEqual(original)
  })
})
