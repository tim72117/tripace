// planTimelineStorage 的持久化行為測試——重點在兩件靠肉眼難驗證、出錯
// 又不會報錯的事:Map 的序列化往返,以及損毀/舊版資料的丟棄判斷。
import { describe, it, expect, beforeEach } from 'vitest'
import { createEmptyTimeline, insertAfter, toRenderList, type PlanTimeline } from './planTimeline'
import {
  saveTimeline,
  loadTimeline,
  clearTimeline,
  PLAN_TIMELINE_STORAGE_KEY,
} from './planTimelineStorage'

function stop(name: string, time?: string) {
  return { type: 'stop' as const, name, time }
}

// buildTimeline — 組一條有三個站點的時間軸,供往返測試使用。
function buildTimeline(): PlanTimeline {
  let timeline: PlanTimeline = createEmptyTimeline()
  const r1 = insertAfter(timeline, null, stop('赤崁樓', '09:00'), 'n1')
  if (!r1.ok) throw new Error('setup failed')
  timeline = r1.timeline
  const r2 = insertAfter(timeline, 'n1', stop('祀典武廟', '10:00'), 'n2')
  if (!r2.ok) throw new Error('setup failed')
  timeline = r2.timeline
  const r3 = insertAfter(timeline, 'n2', stop('林百貨', '11:00'), 'n3')
  if (!r3.ok) throw new Error('setup failed')
  return r3.timeline
}

beforeEach(() => {
  localStorage.clear()
})

describe('saveTimeline / loadTimeline 往返', () => {
  it('存檔後讀回，節點順序與內容完全一致（Map 正確序列化）', () => {
    const original = buildTimeline()
    saveTimeline(original)
    const restored = loadTimeline()

    expect(restored.headId).toBe(original.headId)
    expect(restored.nodes.size).toBe(3)
    // 用 toRenderList 驗證鏈結走訪順序——這是真正會影響畫面的東西,
    // 只比對 nodes.size 無法確認 prevId/nextId 有沒有正確存回。
    expect(toRenderList(restored).map((n) => n.name)).toEqual(['赤崁樓', '祀典武廟', '林百貨'])
    expect(toRenderList(restored).map((n) => n.time)).toEqual(['09:00', '10:00', '11:00'])
  })

  it('從未存過時回傳空時間軸，不是 null', () => {
    const restored = loadTimeline()
    expect(restored.headId).toBeNull()
    expect(restored.nodes.size).toBe(0)
  })

  it('空時間軸也能正確往返', () => {
    saveTimeline(createEmptyTimeline())
    const restored = loadTimeline()
    expect(restored.headId).toBeNull()
    expect(restored.nodes.size).toBe(0)
  })
})

describe('暫態 UI 狀態不被持久化', () => {
  it('loading/removing 存檔時被清掉——避免重整後卡在永遠轉圈/永遠淡出的狀態', () => {
    let timeline: PlanTimeline = createEmptyTimeline()
    const r = insertAfter(
      timeline,
      null,
      { type: 'stop', name: '查詢中…', placeId: 'ChIJxxx', loading: true, removing: true },
      'n1',
    )
    if (!r.ok) throw new Error('setup failed')
    timeline = r.timeline

    saveTimeline(timeline)
    const restored = loadTimeline()
    const node = restored.nodes.get('n1')

    expect(node).toBeDefined()
    // 規劃內容本身要保留
    expect(node?.name).toBe('查詢中…')
    expect(node?.placeId).toBe('ChIJxxx')
    // 暫態狀態要被丟棄
    expect(node?.loading).toBeUndefined()
    expect(node?.removing).toBeUndefined()
  })
})

describe('損毀/不相容資料一律丟棄，回到空時間軸', () => {
  it('不是合法 JSON', () => {
    localStorage.setItem(PLAN_TIMELINE_STORAGE_KEY, '{ this is not json')
    expect(loadTimeline().nodes.size).toBe(0)
  })

  it('版本號不符（舊版殘留資料）', () => {
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      JSON.stringify({ version: 999, headId: 'n1', nodes: [['n1', { id: 'n1', type: 'stop', prevId: null, nextId: null }]] }),
    )
    expect(loadTimeline().nodes.size).toBe(0)
  })

  it('nodes 不是陣列', () => {
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      JSON.stringify({ version: 1, headId: null, nodes: { n1: {} } }),
    )
    expect(loadTimeline().nodes.size).toBe(0)
  })

  it('節點缺少必要欄位（type）', () => {
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      JSON.stringify({ version: 1, headId: 'n1', nodes: [['n1', { id: 'n1', prevId: null, nextId: null }]] }),
    )
    expect(loadTimeline().nodes.size).toBe(0)
  })

  it('headId 指向不存在的節點（資料不一致）', () => {
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        headId: 'missing',
        nodes: [['n1', { id: 'n1', type: 'stop', prevId: null, nextId: null }]],
      }),
    )
    expect(loadTimeline().nodes.size).toBe(0)
  })
})

describe('clearTimeline', () => {
  it('清空後讀回是空時間軸', () => {
    saveTimeline(buildTimeline())
    expect(loadTimeline().nodes.size).toBe(3)
    clearTimeline()
    expect(loadTimeline().nodes.size).toBe(0)
  })
})
