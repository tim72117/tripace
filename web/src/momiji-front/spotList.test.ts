import { describe, expect, it } from 'vitest'
import { MOMIJI_SPOTS, type MomijiSpot } from './momijiSpots'
import { spotListEntries } from './spotList'

const spot = (id: string, itineraryId?: string): MomijiSpot => ({ id, name: id, area: 'A', kind: 'K', lat: 0, lng: 0, itineraryId })

describe('spotListEntries', () => {
  it('有行程的景點排最前面、連結是 /itineraries/<id>,其餘維持原順序', () => {
    const out = spotListEntries([spot('a'), spot('b', 'trip-b'), spot('c'), spot('d', 'trip-d')])
    expect(out.map((e) => e.id)).toEqual(['b', 'd', 'a', 'c'])
    expect(out[0].href).toBe('/itineraries/trip-b')
    expect(out[1].href).toBe('/itineraries/trip-d')
    expect(out[2].href).toBeNull()
    expect(out[3].href).toBeNull()
  })
  it('不改動傳入的陣列', () => {
    const input = [spot('a'), spot('b', 'trip-b')]
    spotListEntries(input)
    expect(input.map((s) => s.id)).toEqual(['a', 'b'])
  })
  it('空清單回空陣列', () => {
    expect(spotListEntries([])).toEqual([])
  })
  it('實際資料:數量不變、每個有 itineraryId 的景點都有連結、沒有的沒有', () => {
    const out = spotListEntries(MOMIJI_SPOTS)
    expect(out).toHaveLength(MOMIJI_SPOTS.length)
    for (const e of out) {
      const src = MOMIJI_SPOTS.find((s) => s.id === e.id)!
      expect(e.href).toBe(src.itineraryId ? `/itineraries/${src.itineraryId}` : null)
    }
  })
})
