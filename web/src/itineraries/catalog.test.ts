import { describe, it, expect } from 'vitest'
import { listNodes } from '../planning/timeline/model'
import {
  allNodesOf, coverPhotoOf, dayCountOf, deriveFilters, filterItineraries, findItinerary, sortByNewest, stopCountOf, toPlanTimeline,
} from './catalog'
import type { SampleItinerary } from './types'
import { stop, timelineOf } from './testUtils'

// stops:帶 day 的扁平站點,依 day 分組成時間軸(見 testUtils.ts)。
function make(over: Partial<Omit<SampleItinerary, 'timeline'>> & { id: string; stops?: ReturnType<typeof stop>[]; days?: number }): SampleItinerary {
  const { stops, days, ...rest } = over
  return {
    title: over.id, region: '台灣・台南', categories: ['美食'], summary: 's', addedAt: '2026-10-01',
    timeline: timelineOf(stops ?? [stop({ name: 'A' })], days ?? 1),
    ...rest,
  }
}

describe('sortByNewest', () => {
  it('依上架日期由新到舊', () => {
    const r = sortByNewest([make({ id: 'a', addedAt: '2026-10-01' }), make({ id: 'b', addedAt: '2026-10-09' }), make({ id: 'c', addedAt: '2026-10-05' })])
    expect(r.map((x) => x.id)).toEqual(['b', 'c', 'a'])
  })
  it('同一天維持傳入順序,且不修改原陣列', () => {
    const input = [make({ id: 'a' }), make({ id: 'b' }), make({ id: 'c' })]
    expect(sortByNewest(input).map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(input.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('deriveFilters', () => {
  const items = [
    make({ id: 'a', region: '台灣・台南', categories: ['美食', '文青'] }),
    make({ id: 'b', region: '台灣・台南', categories: ['美食'] }),
    make({ id: 'c', region: '日本・京都', categories: ['親子'] }),
  ]
  it('由資料算出地區與分類,並帶上各自的份數(多的在前)', () => {
    const f = deriveFilters(items)
    expect(f.regions).toEqual([{ value: '台灣・台南', count: 2 }, { value: '日本・京都', count: 1 }])
    expect(f.categories[0]).toEqual({ value: '美食', count: 2 })
    expect(f.categories.map((c) => c.value).sort()).toEqual(['文青', '美食', '親子'])
  })
  it('新增帶新分類的行程,篩選選項自動多一個(不需要改型別)', () => {
    const f = deriveFilters([...items, make({ id: 'd', categories: ['溫泉'] })])
    expect(f.categories.map((c) => c.value)).toContain('溫泉')
  })
  it('沒有資料時兩個清單都是空的', () => {
    expect(deriveFilters([])).toEqual({ regions: [], categories: [] })
  })
})

describe('filterItineraries', () => {
  const items = [
    make({ id: 'a', region: '台灣・台南', categories: ['美食', '文青'] }),
    make({ id: 'b', region: '台灣・台南', categories: ['親子'] }),
    make({ id: 'c', region: '日本・京都', categories: ['美食'] }),
  ]
  it('兩個都不限就全部留下', () => {
    expect(filterItineraries(items, { region: null, category: null })).toHaveLength(3)
  })
  it('只篩地區 / 只篩分類', () => {
    expect(filterItineraries(items, { region: '台灣・台南', category: null }).map((x) => x.id)).toEqual(['a', 'b'])
    expect(filterItineraries(items, { region: null, category: '美食' }).map((x) => x.id)).toEqual(['a', 'c'])
  })
  it('地區與分類同時成立才留下(AND)', () => {
    expect(filterItineraries(items, { region: '台灣・台南', category: '美食' }).map((x) => x.id)).toEqual(['a'])
  })
  it('沒有符合的回空陣列', () => {
    expect(filterItineraries(items, { region: '日本・京都', category: '親子' })).toEqual([])
  })
})

describe('findItinerary / coverPhotoOf', () => {
  it('依 id 找,找不到回 null', () => {
    const items = [make({ id: 'a' })]
    expect(findItinerary(items, 'a')?.id).toBe('a')
    expect(findItinerary(items, 'zzz')).toBeNull()
  })
  it('封面:只用明確指定的 coverPhoto,沒有回 null(節點不存照片網址,不從站點補圖)', () => {
    expect(coverPhotoOf(make({ id: 'a', coverPhoto: 'https://x/cover.jpg' }))).toBe('https://x/cover.jpg')
    expect(coverPhotoOf(make({ id: 'a' }))).toBeNull()
  })
})

describe('toPlanTimeline', () => {
  it('依序轉成時間軸,跨天時自動出現日期分隔', () => {
    const it = make({
      id: 'x', days: 2,
      stops: [
        stop({ day: 1, time: '09:00', name: 'A', kind: '景點', duration: '1h', desc: 'da', lat: 1, lng: 2 }),
        stop({ day: 1, time: '11:00', name: 'B' }),
        stop({ day: 2, time: '09:00', name: 'C' }),
      ],
    })
    const { timeline } = toPlanTimeline(it)
    const stops = listNodes(timeline).filter((n) => n.type === 'stop')
    expect(stops.map((n) => n.name)).toEqual(['A', 'B', 'C'])
    expect(stops[0]).toMatchObject({ kind: '景點', duration: '1h', desc: 'da', lat: 1, lng: 2 })
    // 依天分組:兩天,第一天兩站、第二天一站(「Day N」標題由視圖依 days 畫,時間軸裡沒有分隔節點)
    expect(timeline.days.map((d) => d.nodes.length)).toEqual([2, 1])
  })
  it('stop.transitFromPrev 帶進該站的 transitFromPrev(上一站到這一站的交通),沒填的站沒有', () => {
    const it = make({
      id: 'x',
      stops: [
        stop({ time: '09:00', name: 'A' }),
        stop({ time: '11:00', name: 'B', transitFromPrev: { mode: '電車', minutes: 20, note: '搭 JR 嵯峨野線' } }),
        stop({ time: '13:00', name: 'C' }),
      ],
    })
    const stops = listNodes(toPlanTimeline(it).timeline).filter((n) => n.type === 'stop')
    expect(stops[0].transitFromPrev).toBeUndefined()
    expect(stops[1].transitFromPrev).toEqual({ mode: '電車', minutes: 20, note: '搭 JR 嵯峨野線' })
    expect(stops[2].transitFromPrev).toBeUndefined()
  })
  it('沒填 transitFromPrev 時,同一天相鄰且都有座標的站用直線距離估計;人工填的優先;跨天與沒座標的站不畫', () => {
    const it = make({
      id: 'x', days: 2,
      stops: [
        stop({ day: 1, time: '09:00', name: 'A', lat: 18, lng: 100 }),
        stop({ day: 1, time: '10:00', name: 'B', lat: 18.0045, lng: 100 }),
        stop({ day: 1, time: '11:00', name: 'C', lat: 18.0045, lng: 100, transitFromPrev: { mode: '電車', note: '搭 JR' } }),
        stop({ day: 1, time: '12:00', name: 'D' }),
        stop({ day: 1, time: '13:00', name: 'E', lat: 18, lng: 100 }),
        stop({ day: 2, time: '09:00', name: 'F', lat: 18.0045, lng: 100 }),
      ],
    })
    const s = listNodes(toPlanTimeline(it).timeline).filter((n) => n.type === 'stop')
    expect(s[0].transitFromPrev).toBeUndefined()
    expect(s[1].transitFromPrev).toMatchObject({ mode: '步行', minutes: 6, distance: '500m' })
    expect(s[2].transitFromPrev).toEqual({ mode: '電車', note: '搭 JR' })
    expect(s[3].transitFromPrev).toBeUndefined()
    expect(s[4].transitFromPrev).toBeUndefined()
    expect(s[5].transitFromPrev).toBeUndefined()
  })
  it('lodgings 原樣帶過去,載入補值不丟掉住宿', () => {
    const it = make({ id: 'x', days: 3, stops: [stop({ day: 1, name: 'A' })] })
    it.timeline = { ...it.timeline, lodgings: [{ id: 'l1', placeId: 'p1', name: '飯店', dayIds: ['d1', 'd2'] }] }
    expect(toPlanTimeline(it).timeline.lodgings).toEqual([{ id: 'l1', placeId: 'p1', name: '飯店', dayIds: ['d1', 'd2'] }])
  })
  // 原本(SampleStop 時代)toPlanTimeline 要逐欄把 note、children 轉進節點;現在節點本身就是 PlanNode,
  // 這裡確認載入補值是展開原節點、不會漏掉這些欄位(主題點的子景點改為 attractions/places id 清單)。
  it('站點的 note 與主題點的 attractions/places 原樣帶過去,不增加時間軸站數', () => {
    const it = make({
      id: 'x',
      stops: [
        stop({ time: '09:00', name: 'A', note: { text: '17:00 閉館', category: 'info' }, attractions: ['lmk_1'], places: ['p1', 'p2'] }),
        stop({ time: '11:00', name: 'B' }),
      ],
    })
    const s = listNodes(toPlanTimeline(it).timeline).filter((n) => n.type === 'stop')
    expect(s).toHaveLength(2)
    expect(s[0]).toMatchObject({ note: { text: '17:00 閉館', category: 'info' }, attractions: ['lmk_1'], places: ['p1', 'p2'] })
    expect(s[1].note).toBeUndefined()
    expect(s[1].attractions).toBeUndefined()
  })
  it('沒有照片時補縮圖備用樣式,資料有寫的尊重資料;不改動 registry 裡的原始資料', () => {
    const it = make({ id: 'x', stops: [stop({ name: 'A' }), stop({ time: '10:00', name: 'B', thumbIcon: '🍜' })] })
    const before = JSON.stringify(it)
    const s = listNodes(toPlanTimeline(it).timeline).filter((n) => n.type === 'stop')
    expect(s[0]).toMatchObject({ thumbBg: 'var(--ios-active)', thumbIcon: '📍' })
    expect(s[1].thumbIcon).toBe('🍜')
    expect(JSON.stringify(it)).toBe(before)
  })
  it('空的天保留在時間軸裡(有 Day 分隔但沒有站點)', () => {
    const t = toPlanTimeline(make({ id: 'x', days: 3 })).timeline
    expect(t.days).toHaveLength(3)
    expect(t.days[2].nodes).toEqual([])
  })
})

describe('dayCountOf / stopCountOf / allNodesOf', () => {
  it('天數是時間軸的天數;站數只算 stop;allNodesOf 跨天依序攤平', () => {
    const it = make({ id: 'x', days: 3, stops: [stop({ day: 1, name: 'A' }), stop({ day: 1, time: '10:00', name: 'B' }), stop({ day: 3, name: 'C' })] })
    expect(dayCountOf(it)).toBe(3)
    expect(stopCountOf(it)).toBe(3)
    expect(allNodesOf(it).map((n) => n.name)).toEqual(['A', 'B', 'C'])
  })
})
