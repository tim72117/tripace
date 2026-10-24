// planTimelineStorage 的持久化行為測試——重點在靠肉眼難驗證、出錯又不會報錯的事:
// 依天分組格式的往返、舊版(鏈結串列)資料的搬移,以及損毀/不相容資料的丟棄判斷。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { countNodes, createEmptyTimeline, getNode, hasNode, insertAfter, isTimelineEmpty, listNodes, stopLookupFailed, type PlanTimeline } from './planTimeline'
import {
  saveTimeline,
  loadTimeline,
  clearTimeline,
  loadTimelineForKey,
  loadTimelineWithRev,
  PLAN_TIMELINE_STORAGE_KEY,
} from './planTimelineStorage'
import { addedDay } from './planTimelineTestUtils'

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
  it('存檔後讀回,順序與內容完全一致', () => {
    const original = buildTimeline()
    saveTimeline(original)
    const restored = loadTimeline()

    expect(countNodes(restored)).toBe(3)
    const rendered = listNodes(restored)
    expect(rendered.map((n) => n.name)).toEqual(['赤崁樓', '祀典武廟', '林百貨'])
    expect(rendered.map((n) => n.time)).toEqual(['09:00', '10:00', '11:00'])
  })

  it('多天結構(含空的天、天的 id)原樣往返', () => {
    let timeline = buildTimeline()
    const r = insertAfter(timeline, 'n3', { type: 'stop', name: '安平古堡', time: '09:00', day: 2 }, 'n4')
    if (!r.ok) throw new Error('setup failed')
    timeline = addedDay(r.timeline, undefined, 'empty-day')
    saveTimeline(timeline)
    const restored = loadTimeline()

    expect(restored.days.map((d) => d.id)).toEqual(timeline.days.map((d) => d.id))
    expect(restored.days[2]).toEqual({ id: 'empty-day', nodes: [] })
    expect(getNode(restored, 'n4')?.day).toBe(2)
    expect(restored.days.map((d) => d.nodes.map((n) => n.id))).toEqual([['n1', 'n2', 'n3'], ['n4'], []])
  })

  it('從未存過時回傳空時間軸,不是 null', () => {
    const restored = loadTimeline()
    expect(isTimelineEmpty(restored)).toBe(true)
    expect(restored.days).toEqual([])
  })

  it('空時間軸也能正確往返', () => {
    saveTimeline(createEmptyTimeline())
    expect(loadTimeline().days).toEqual([])
  })
})

// 寫一份「舊草稿」到 localStorage(版本 2,節點帶舊欄位),測試載入時丟棄。
function seedLegacyDraft(node: Record<string, unknown>) {
  localStorage.setItem(
    PLAN_TIMELINE_STORAGE_KEY,
    JSON.stringify({ version: 2, rev: 1, days: [{ id: 'd1', nodes: [{ id: 'n1', type: 'stop', ...node }] }] }),
  )
}

describe('執行狀態與照片不在節點上、舊草稿載入時丟掉', () => {
  it('舊草稿裡的 loading/failed/removing/googlePhotoUrls 載入時一律丟掉,行程資料保留', () => {
    seedLegacyDraft({
      name: '赤崁樓', placeId: 'ChIJxxx', lat: 1, lng: 2,
      loading: true, failed: true, removing: true, googlePhotoUrls: ['https://example.com/a.jpg'],
    })
    const node = getNode(loadTimeline(), 'n1') as unknown as Record<string, unknown>
    expect(node.name).toBe('赤崁樓')
    expect(node.placeId).toBe('ChIJxxx')
    expect(node.lat).toBe(1)
    for (const k of ['loading', 'failed', 'removing', 'googlePhotoUrls']) expect(k in node).toBe(false)
  })

  it('舊的 failed 節點(有 placeId 沒座標)載入後仍被 stopLookupFailed 認出,掛載重試才找得到它', () => {
    seedLegacyDraft({ name: '查詢中…', placeId: 'ChIJxxx', failed: true })
    expect(stopLookupFailed(getNode(loadTimeline(), 'n1')!)).toBe(true)
  })

  it('版本 1 草稿(鏈結串列)遷移時同樣丟掉這些欄位', () => {
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        headId: 'n1',
        nodes: [['n1', { id: 'n1', type: 'stop', name: 'A', prevId: null, nextId: null, loading: true, googlePhotoUrls: ['x'] }]],
      }),
    )
    const node = getNode(loadTimeline(), 'n1') as unknown as Record<string, unknown>
    expect(node.name).toBe('A')
    expect('loading' in node).toBe(false)
    expect('googlePhotoUrls' in node).toBe(false)
  })

  it('存檔只含行程:存檔內容裡沒有 text/stale/ephemeral 這類訊息欄位', () => {
    saveTimeline(buildTimeline())
    const raw = localStorage.getItem(PLAN_TIMELINE_STORAGE_KEY) ?? ''
    expect(raw).not.toContain('message')
    expect(raw).not.toContain('ephemeral')
  })
})

describe('舊版(版本 1,鏈結串列)資料自動搬移成依天分組', () => {
  function legacy(nodes: Array<Record<string, unknown>>, headId: string | null) {
    return JSON.stringify({
      version: 1,
      headId,
      nodes: nodes.map((n) => [n.id, n]),
      rev: 3,
    })
  }

  it('依 stop 的 day 分天,day 欄位不再存進節點', () => {
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      legacy(
        [
          { id: 'a', type: 'stop', name: 'A', time: '09:00', day: 1, prevId: null, nextId: 'b' },
          { id: 'b', type: 'stop', name: 'B', time: '09:00', day: 2, prevId: 'a', nextId: 'c' },
          { id: 'c', type: 'stop', name: 'C', time: '10:00', day: 2, prevId: 'b', nextId: null },
        ],
        'a',
      ),
    )
    const restored = loadTimeline()
    expect(restored.days).toHaveLength(2)
    expect(restored.days[0].nodes.map((n) => n.id)).toEqual(['a'])
    expect(restored.days[1].nodes.map((n) => n.id)).toEqual(['b', 'c'])
    expect(restored.days[1].nodes[0]).not.toHaveProperty('day')
    expect(restored.days[1].nodes[0]).not.toHaveProperty('prevId')
    expect(getNode(restored, 'c')?.day).toBe(2)
  })

  it('沒有 day 的 stop 視為第 1 天;天數不連續時補空的天', () => {
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      legacy(
        [
          { id: 'a', type: 'stop', name: 'A', prevId: null, nextId: 'b' },
          { id: 'b', type: 'stop', name: 'B', day: 3, prevId: 'a', nextId: null },
        ],
        'a',
      ),
    )
    const restored = loadTimeline()
    expect(restored.days).toHaveLength(3)
    expect(restored.days[1].nodes).toEqual([])
    expect(getNode(restored, 'a')?.day).toBe(1)
    expect(getNode(restored, 'b')?.day).toBe(3)
  })

  it('舊草稿裡 type 為 section 的節點直接丟掉(不崩潰、不佔位置),其餘節點與順序照常搬移', () => {
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      legacy(
        [
          { id: 's1', type: 'section', label: '上午', prevId: null, nextId: 'a' },
          { id: 'a', type: 'stop', name: 'A', day: 1, prevId: 's1', nextId: 's2' },
          { id: 's2', type: 'section', label: '下午', prevId: 'a', nextId: 'b' },
          { id: 'b', type: 'stop', name: 'B', day: 1, prevId: 's2', nextId: null },
        ],
        's1',
      ),
    )
    const restored = loadTimeline()
    expect(restored.days).toHaveLength(1)
    expect(restored.days[0].nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(hasNode(restored, 's1')).toBe(false)
  })

  it('搬移後再存檔就是新格式', () => {
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      legacy([{ id: 'a', type: 'stop', name: 'A', prevId: null, nextId: null }], 'a'),
    )
    saveTimeline(loadTimeline(), 3)
    const raw = JSON.parse(localStorage.getItem(PLAN_TIMELINE_STORAGE_KEY)!)
    expect(raw.version).toBe(2)
    expect(raw.headId).toBeUndefined()
    expect(raw.days[0].nodes[0].id).toBe('a')
  })

  it('舊版資料損毀(headId 指向不存在的節點、缺 type、nodes 不是陣列)仍丟棄', () => {
    localStorage.setItem(PLAN_TIMELINE_STORAGE_KEY, legacy([{ id: 'n1', type: 'stop', prevId: null, nextId: null }], 'missing'))
    expect(isTimelineEmpty(loadTimeline())).toBe(true)
    localStorage.setItem(PLAN_TIMELINE_STORAGE_KEY, legacy([{ id: 'n1', prevId: null, nextId: null }], 'n1'))
    expect(isTimelineEmpty(loadTimeline())).toBe(true)
    localStorage.setItem(PLAN_TIMELINE_STORAGE_KEY, JSON.stringify({ version: 1, headId: null, nodes: { n1: {} } }))
    expect(isTimelineEmpty(loadTimeline())).toBe(true)
  })
})

describe('損毀/不相容資料一律丟棄,回到空時間軸', () => {
  it('不是合法 JSON', () => {
    localStorage.setItem(PLAN_TIMELINE_STORAGE_KEY, '{ this is not json')
    expect(countNodes(loadTimeline())).toBe(0)
  })

  it('版本號不符(未知版本殘留資料)', () => {
    localStorage.setItem(PLAN_TIMELINE_STORAGE_KEY, JSON.stringify({ version: 999, days: [{ id: 'd', nodes: [{ id: 'n1', type: 'stop' }] }] }))
    expect(countNodes(loadTimeline())).toBe(0)
  })

  it('days 不是陣列', () => {
    localStorage.setItem(PLAN_TIMELINE_STORAGE_KEY, JSON.stringify({ version: 2, days: { d: {} } }))
    expect(countNodes(loadTimeline())).toBe(0)
  })

  it('節點缺少必要欄位(type)', () => {
    localStorage.setItem(PLAN_TIMELINE_STORAGE_KEY, JSON.stringify({ version: 2, days: [{ id: 'd1', nodes: [{ id: 'n1' }] }] }))
    expect(countNodes(loadTimeline())).toBe(0)
  })

  it('節點 id 重複(資料不一致)', () => {
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      JSON.stringify({ version: 2, days: [{ id: 'd1', nodes: [{ id: 'n1', type: 'stop' }, { id: 'n1', type: 'stop' }] }] }),
    )
    expect(countNodes(loadTimeline())).toBe(0)
  })

  it('天缺少 id 或 nodes', () => {
    localStorage.setItem(PLAN_TIMELINE_STORAGE_KEY, JSON.stringify({ version: 2, days: [{ nodes: [] }] }))
    expect(loadTimeline().days).toEqual([])
    localStorage.setItem(PLAN_TIMELINE_STORAGE_KEY, JSON.stringify({ version: 2, days: [{ id: 'd1' }] }))
    expect(loadTimeline().days).toEqual([])
  })
})

describe('天的 id 必須唯一', () => {
  it('兩天用同一個 id 視為損毀,整份丟棄', () => {
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      JSON.stringify({ version: 2, days: [{ id: 'd1', nodes: [{ id: 'n1', type: 'stop' }] }, { id: 'd1', nodes: [{ id: 'n2', type: 'stop' }] }] }),
    )
    const t = loadTimeline()
    expect(t.days).toEqual([])
    expect(countNodes(t)).toBe(0)
  })

  it('不同的天 id 正常載入', () => {
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      JSON.stringify({ version: 2, days: [{ id: 'd1', nodes: [{ id: 'n1', type: 'stop' }] }, { id: 'd2', nodes: [{ id: 'n2', type: 'stop' }] }] }),
    )
    expect(loadTimeline().days.map((d) => d.id)).toEqual(['d1', 'd2'])
  })
})

describe('解析失敗時把原始內容備份到 <key>.backup', () => {
  const BACKUP_KEY = `${PLAN_TIMELINE_STORAGE_KEY}.backup`

  it('壞掉的 JSON:回空時間軸,原始 raw 完整備份,並 console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const raw = '{ this is not json'
    localStorage.setItem(PLAN_TIMELINE_STORAGE_KEY, raw)
    expect(countNodes(loadTimeline())).toBe(0)
    expect(localStorage.getItem(BACKUP_KEY)).toBe(raw)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('版本不符、天 id 重複、節點 id 重複同樣備份;loadTimelineWithRev 路徑也一樣', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad = JSON.stringify({ version: 999, days: [] })
    localStorage.setItem(PLAN_TIMELINE_STORAGE_KEY, bad)
    expect(loadTimelineWithRev().timeline.days).toEqual([])
    expect(localStorage.getItem(BACKUP_KEY)).toBe(bad)

    const dup = JSON.stringify({ version: 2, days: [{ id: 'd1', nodes: [] }, { id: 'd1', nodes: [] }] })
    localStorage.setItem(PLAN_TIMELINE_STORAGE_KEY, dup)
    loadTimeline()
    expect(localStorage.getItem(BACKUP_KEY)).toBe(dup)
    vi.restoreAllMocks()
  })

  it('沒存過、或合法的空草稿:不備份也不警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    loadTimeline()
    localStorage.setItem(PLAN_TIMELINE_STORAGE_KEY, JSON.stringify({ version: 2, days: [] }))
    loadTimeline()
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('備份寫入失敗(配額)不丟例外,仍回空時間軸', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem(PLAN_TIMELINE_STORAGE_KEY, 'garbage')
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => loadTimeline()).not.toThrow()
    expect(countNodes(loadTimeline())).toBe(0)
    setItem.mockRestore()
    vi.restoreAllMocks()
  })

  it('備份 key 跟著傳入的 key 走(草稿用自訂 key 時備份在各自的 .backup)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('other.key', 'garbage')
    loadTimelineForKey('other.key')
    expect(localStorage.getItem('other.key.backup')).toBe('garbage')
    vi.restoreAllMocks()
  })
})

describe('載入時清掉查詢中的交通資訊(transitFromPrev.loading)', () => {
  it('loading:true 的 transitFromPrev 被清掉,已有結果的保留', () => {
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        days: [
          {
            id: 'd1',
            nodes: [
              { id: 'a', type: 'stop', name: 'a' },
              { id: 'b', type: 'stop', name: 'b', transitFromPrev: { loading: true } },
              { id: 'c', type: 'stop', name: 'c', transitFromPrev: { mode: 'walk', minutes: 5 } },
              { id: 'd', type: 'stop', name: 'd', transitFromPrev: { loading: false, minutes: 9 } },
            ],
          },
        ],
      }),
    )
    const t = loadTimeline()
    expect(getNode(t, 'b')?.transitFromPrev).toBeUndefined()
    expect('transitFromPrev' in (getNode(t, 'b') ?? {})).toBe(false)
    expect(getNode(t, 'c')?.transitFromPrev).toEqual({ mode: 'walk', minutes: 5 })
    expect(getNode(t, 'd')?.transitFromPrev).toEqual({ loading: false, minutes: 9 })
  })

  it('版本 1 的舊草稿同樣清掉', () => {
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        headId: 'a',
        nodes: [
          ['a', { id: 'a', type: 'stop', prevId: null, nextId: 'b' }],
          ['b', { id: 'b', type: 'stop', prevId: 'a', nextId: null, transitFromPrev: { loading: true } }],
        ],
      }),
    )
    expect(getNode(loadTimeline(), 'b')?.transitFromPrev).toBeUndefined()
  })
})

describe('clearTimeline', () => {
  it('清空後讀回是空時間軸', () => {
    saveTimeline(buildTimeline())
    expect(countNodes(loadTimeline())).toBe(3)
    clearTimeline()
    expect(countNodes(loadTimeline())).toBe(0)
  })
})

describe('內嵌子景點資料不被持久化', () => {
  it('attractions/places/farFromNext(只存 id)原樣往返', () => {
    const r = insertAfter(
      createEmptyTimeline(),
      null,
      { type: 'stop', name: '午餐候選', candidateCards: true, attractions: ['lmk_1'], places: ['attr-a', 'attr-b'], farFromNext: ['attr-b'] },
      'n1',
    )
    if (!r.ok) throw new Error('setup failed')
    saveTimeline(r.timeline)
    const node = getNode(loadTimeline(), 'n1')
    expect(node?.attractions).toEqual(['lmk_1'])
    expect(node?.places).toEqual(['attr-a', 'attr-b'])
    expect(node?.farFromNext).toEqual(['attr-b'])
  })
})

describe('舊草稿的 children(內嵌子景點)載入時搬成 places', () => {
  const childrenNode = {
    id: 'n1',
    type: 'stop',
    name: '赤崁樓周邊',
    children: [
      { id: 'c1', name: '赤崁樓', desc: '很長的說明', thumbBg: 'x', thumbIcon: '🏯', placeId: 'attr-chikanlou', lat: 1, lng: 2, googlePhotoUrls: ['u'] },
      { id: 'c2', name: '福記肉圓', placeId: 'attr-fuji', farFromNext: true },
      { id: 'c3', name: '沒有 placeId 的項目' },
      { id: 'c4', placeId: 'attr-chikanlou' },
      null,
      'bad',
    ],
  }

  it('版本 2:placeId 收成 places(去重),farFromNext 的項目收進 farFromNext,其餘內嵌資料與 children 丟掉', () => {
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      JSON.stringify({ version: 2, days: [{ id: 'd1', nodes: [childrenNode] }], rev: 1 }),
    )
    const node = getNode(loadTimeline(), 'n1')
    expect(node?.places).toEqual(['attr-chikanlou', 'attr-fuji'])
    expect(node?.farFromNext).toEqual(['attr-fuji'])
    expect('children' in (node as object)).toBe(false)
    expect(node?.name).toBe('赤崁樓周邊')
  })

  it('版本 1(鏈結串列)的節點同樣搬移', () => {
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      JSON.stringify({ version: 1, headId: 'n1', nodes: [['n1', { ...childrenNode, prevId: null, nextId: null }]], rev: 1 }),
    )
    const node = getNode(loadTimeline(), 'n1')
    expect(node?.places).toEqual(['attr-chikanlou', 'attr-fuji'])
    expect('children' in (node as object)).toBe(false)
  })

  it('children 形狀不對(不是陣列)或全無 placeId:不崩潰,也不產生空的 places', () => {
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        days: [{ id: 'd1', nodes: [{ id: 'a', type: 'stop', children: 'oops' }, { id: 'b', type: 'stop', children: [{ name: 'x' }] }] }],
        rev: 1,
      }),
    )
    const loaded = loadTimeline()
    expect(getNode(loaded, 'a')?.places).toBeUndefined()
    expect(getNode(loaded, 'b')?.places).toBeUndefined()
    expect('children' in (getNode(loaded, 'b') as object)).toBe(false)
  })

  it('搬移後再存檔,寫出的資料不再含 children 與內嵌顯示資料', () => {
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      JSON.stringify({ version: 2, days: [{ id: 'd1', nodes: [childrenNode] }], rev: 1 }),
    )
    saveTimeline(loadTimeline(), 1)
    const raw = localStorage.getItem(PLAN_TIMELINE_STORAGE_KEY)!
    expect(raw).not.toContain('children')
    expect(raw).not.toContain('thumbBg')
    expect(raw).not.toContain('googlePhotoUrls')
  })
})

describe('版本 2 草稿裡的舊 section 節點', () => {
  it('讀進來時直接丟掉,其餘節點留著;只剩 section 的天保留成空的天', () => {
    localStorage.setItem(
      PLAN_TIMELINE_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        days: [
          { id: 'd1', nodes: [{ id: 'sec', type: 'section', label: 'Day 1' }, { id: 'a', type: 'stop', name: 'A' }] },
          { id: 'd2', nodes: [{ id: 'sec2', type: 'section', label: 'Day 2' }] },
        ],
        rev: 1,
      }),
    )
    const restored = loadTimeline()
    expect(restored.days.map((d) => d.id)).toEqual(['d1', 'd2'])
    expect(restored.days.map((d) => d.nodes.map((n) => n.id))).toEqual([['a'], []])
  })
})
