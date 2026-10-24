// groupInTripByDay:已排入行程的 entry 依日期分組,日期升冪、未排定日期排最後,同一天維持傳入順序。
import { describe, it, expect } from 'vitest'
import { groupInTripByDay, NO_DATE_GROUP, type GeoCandidate } from './candidateHelpers'

const entry = (name: string, start?: string) =>
  ({ kind: 'entry', inTrip: true, name, lat: 1, lng: 2, start }) as unknown as GeoCandidate & { kind: 'entry' }

describe('groupInTripByDay', () => {
  it('依日期升冪分組、未排定日期排最後、同一天維持傳入順序', () => {
    const groups = groupInTripByDay([
      entry('c', '2026-10-03'),
      entry('n1'),
      entry('a1', '2026-10-01'),
      entry('a2', '2026-10-01'),
      entry('n2'),
    ])
    expect(groups.map(([k]) => k)).toEqual(['2026-10-01', '2026-10-03', NO_DATE_GROUP])
    expect(groups[0][1].map((c) => c.name)).toEqual(['a1', 'a2'])
    expect(groups[2][1].map((c) => c.name)).toEqual(['n1', 'n2'])
  })

  it('沒有項目:回傳空陣列', () => {
    expect(groupInTripByDay([])).toEqual([])
  })
})
