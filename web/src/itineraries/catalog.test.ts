import { describe, it, expect } from 'vitest'
import { toRenderList } from '../plan-core/planTimeline'
import {
  coverPhotoOf, deriveFilters, filterItineraries, findItinerary, sortByNewest, toPlanTimeline,
} from './catalog'
import type { SampleItinerary, SampleStop } from './types'

function make(over: Partial<SampleItinerary> & { id: string }): SampleItinerary {
  return {
    title: over.id, region: '台灣・台南', days: 1, categories: ['美食'], summary: 's', addedAt: '2026-10-01',
    stops: [stop({ name: 'A' })],
    ...over,
  }
}

// 測試用的站:kind/duration 是必填欄位,給預設值,只在需要時覆寫。
function stop(over: Partial<SampleStop> & { name: string }): SampleStop {
  return { time: '09:00', kind: '景點', duration: '1h', ...over }
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
  it('封面:明確指定的優先,否則取第一個有照片的站的第一張,都沒有回 null', () => {
    expect(coverPhotoOf(make({ id: 'a', coverPhoto: 'https://x/cover.jpg' }))).toBe('https://x/cover.jpg')
    expect(coverPhotoOf(make({ id: 'a', stops: [stop({ time: '09:00', name: 'A' }), stop({ time: '10:00', name: 'B', photos: ['https://x/b1.jpg', 'https://x/b2.jpg'] })] }))).toBe('https://x/b1.jpg')
    expect(coverPhotoOf(make({ id: 'a' }))).toBeNull()
  })
})

describe('toPlanTimeline', () => {
  it('依序轉成時間軸,跨天時自動出現日期分隔', () => {
    const it = make({
      id: 'x', days: 2,
      stops: [
        stop({ day: 1, time: '09:00', name: 'A', kind: '景點', duration: '1h', desc: 'da', photos: ['https://x/a.jpg'], lat: 1, lng: 2 }),
        stop({ day: 1, time: '11:00', name: 'B' }),
        stop({ day: 2, time: '09:00', name: 'C' }),
      ],
    })
    const { timeline, skipped } = toPlanTimeline(it)
    expect(skipped).toEqual([])
    const list = toRenderList(timeline)
    const stops = list.filter((n) => n.type === 'stop')
    expect(stops.map((n) => n.name)).toEqual(['A', 'B', 'C'])
    expect(stops[0]).toMatchObject({ kind: '景點', duration: '1h', desc: 'da', googlePhotoUrls: ['https://x/a.jpg'], lat: 1, lng: 2 })
    // 第二天之前會多一個分隔節點(section)
    expect(list.filter((n) => n.type === 'section').length).toBeGreaterThanOrEqual(1)
  })
  it('同一天時間倒退的站被略過並回報,其餘照常轉出', () => {
    const it = make({ id: 'x', stops: [stop({ time: '10:00', name: 'A' }), stop({ time: '09:00', name: 'B' }), stop({ time: '11:00', name: 'C' })] })
    const { timeline, skipped } = toPlanTimeline(it)
    expect(skipped).toHaveLength(1)
    expect(skipped[0]).toContain('B')
    expect(toRenderList(timeline).filter((n) => n.type === 'stop').map((n) => n.name)).toEqual(['A', 'C'])
  })
  it('時間格式不對的站被略過', () => {
    const { skipped } = toPlanTimeline(make({ id: 'x', stops: [stop({ time: '9點', name: 'A' })] }))
    expect(skipped).toHaveLength(1)
  })
})
