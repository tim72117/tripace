import { describe, it, expect } from 'vitest'
import {
  NO_DATE_GROUP,
  candidateEntryKind,
  candidateListKey,
  dayGroupKey,
  dayGroupLabel,
  entryKindIcon,
  localDateKey,
  type GeoCandidate,
} from './geoCandidateHelpers'
import { Hotel, MapPin, UtensilsCrossed } from 'lucide-react'

describe('dayGroupKey', () => {
  it('kind 為 entry 且有 start 時,回傳 start 本身', () => {
    const c: GeoCandidate = {
      kind: 'entry', inTrip: true, id: '1', name: 'A', lat: 0, lng: 0,
      start: '2026-08-01',
    } as GeoCandidate
    expect(dayGroupKey(c)).toBe('2026-08-01')
  })

  it('kind 為 entry 但 start 是空字串時,歸進 NO_DATE_GROUP', () => {
    const c: GeoCandidate = {
      kind: 'entry', inTrip: true, id: '1', name: 'A', lat: 0, lng: 0,
      start: '',
    } as GeoCandidate
    expect(dayGroupKey(c)).toBe(NO_DATE_GROUP)
  })

  it('kind 不是 entry(hotel/attraction/place)一律歸進 NO_DATE_GROUP', () => {
    const c: GeoCandidate = { kind: 'hotel', name: 'H', lat: 0, lng: 0 } as GeoCandidate
    expect(dayGroupKey(c)).toBe(NO_DATE_GROUP)
  })
})

describe('dayGroupLabel', () => {
  it('NO_DATE_GROUP 顯示為「未排定日期」', () => {
    expect(dayGroupLabel(NO_DATE_GROUP)).toBe('未排定日期')
  })

  it('YYYY-MM-DD 格式的 key 轉成「M/D」(不補零)', () => {
    expect(dayGroupLabel('2026-08-01')).toBe('8/1')
    expect(dayGroupLabel('2026-12-25')).toBe('12/25')
  })

  it('完全沒有連字號的 key 原樣回傳(split 後只有一段,month/day 為 undefined)', () => {
    expect(dayGroupLabel('nodash')).toBe('nodash')
  })

  // 已知邊界行為:key 裡有 >=2 個連字號、但不是合法日期數字時(例如
  // 'not-a-date'),split('-') 後 month/day 兩段都是非空字串(truthy),
  // 會被誤判成「格式正確」而進入 Number() 轉換,產生 'NaN/NaN' 而非把
  // key 原樣退回——這不是這次新增測試要修的行為,只是先如實記錄現況,
  // 避免之後誰改了這個函式、不小心以為這裡沒有涵蓋這個情況。
  it('形似日期但月/日欄位非數字時,目前會產生 NaN/NaN(已知邊界行為,非預期輸出)', () => {
    expect(dayGroupLabel('not-a-date')).toBe('NaN/NaN')
  })
})

describe('localDateKey', () => {
  it('用本地時間的年/月/日組出 YYYY-MM-DD,不經過 UTC 轉換', () => {
    // 刻意用一個午夜前後容易在 UTC 轉換時倒退一天的時刻驗證。
    const d = new Date(2026, 0, 15, 0, 30) // 本地時間 2026-01-15 00:30
    expect(localDateKey(d)).toBe('2026-01-15')
  })

  it('月/日個位數補零', () => {
    const d = new Date(2026, 2, 5) // 本地時間 2026-03-05
    expect(localDateKey(d)).toBe('2026-03-05')
  })
})

describe('candidateListKey', () => {
  it('entry 形狀用自己的 id 當 key,不受名稱/座標影響', () => {
    const c: GeoCandidate = {
      kind: 'entry', inTrip: true, id: 'ent_123', name: 'A', lat: 1, lng: 2,
    } as GeoCandidate
    expect(candidateListKey(c)).toBe('entry-ent_123')
  })

  it('非 entry 形狀用 kind+名稱+座標組成 key', () => {
    const c: GeoCandidate = { kind: 'hotel', name: 'X 飯店', lat: 25.03, lng: 121.56 } as GeoCandidate
    expect(candidateListKey(c)).toBe('hotel-X 飯店-25.03-121.56')
  })

  it('同一筆候選被拖進行程兩次(產生兩個不同 id 的 entry)不會撞 key', () => {
    const base = { kind: 'entry' as const, inTrip: true, name: 'A', lat: 1, lng: 2 }
    const first = { ...base, id: 'ent_1' } as GeoCandidate
    const second = { ...base, id: 'ent_2' } as GeoCandidate
    expect(candidateListKey(first)).not.toBe(candidateListKey(second))
  })
})

describe('candidateEntryKind', () => {
  it('hotel 一律對應 stay', () => {
    const c: GeoCandidate = { kind: 'hotel', name: 'H', lat: 0, lng: 0 } as GeoCandidate
    expect(candidateEntryKind(c)).toBe('stay')
  })

  it('place 依 category 查表(lodging→stay/restaurant→restaurant/tourist_attraction→activity)', () => {
    const make = (category: string): GeoCandidate =>
      ({ kind: 'place', name: 'P', lat: 0, lng: 0, category } as GeoCandidate)
    expect(candidateEntryKind(make('lodging'))).toBe('stay')
    expect(candidateEntryKind(make('restaurant'))).toBe('restaurant')
    expect(candidateEntryKind(make('tourist_attraction'))).toBe('activity')
  })

  it('place 的 category 查不到對應值時退回 activity', () => {
    const c: GeoCandidate = { kind: 'place', name: 'P', lat: 0, lng: 0, category: 'unknown_type' } as GeoCandidate
    expect(candidateEntryKind(c)).toBe('activity')
  })

  it('attraction 固定對應 activity', () => {
    const c: GeoCandidate = { kind: 'attraction', name: 'A', lat: 0, lng: 0 } as GeoCandidate
    expect(candidateEntryKind(c)).toBe('activity')
  })

  it('entry 沿用自己保留的 entryKind,沒有值時退回 activity', () => {
    const withKind: GeoCandidate = {
      kind: 'entry', inTrip: true, id: '1', name: 'A', lat: 0, lng: 0, entryKind: 'restaurant',
    } as GeoCandidate
    const withoutKind: GeoCandidate = {
      kind: 'entry', inTrip: true, id: '1', name: 'A', lat: 0, lng: 0, entryKind: null,
    } as GeoCandidate
    expect(candidateEntryKind(withKind)).toBe('restaurant')
    expect(candidateEntryKind(withoutKind)).toBe('activity')
  })
})

describe('entryKindIcon', () => {
  it('已知 kind 回傳對應圖示', () => {
    expect(entryKindIcon('stay')).toBe(Hotel)
    expect(entryKindIcon('restaurant')).toBe(UtensilsCrossed)
  })

  it('未知或缺漏的 kind 退回 MapPin', () => {
    expect(entryKindIcon('some_unknown_kind')).toBe(MapPin)
    expect(entryKindIcon(null)).toBe(MapPin)
    expect(entryKindIcon(undefined)).toBe(MapPin)
  })
})
