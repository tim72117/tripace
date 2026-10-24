import { describe, it, expect } from 'vitest'
import { initialCenterOf } from './initialCenter'
import { makeItinerary as make, stop } from './testUtils'

describe('initialCenterOf', () => {
  it('取第一天有座標的站點的中心,不被後面天數、相距很遠的站點拉走', () => {
    const it = make([
      stop({ day: 1, name: 'A', lat: 18.8, lng: 98.96 }),
      stop({ day: 1, time: '11:00', name: 'B', lat: 18.82, lng: 98.98 }),
      stop({ day: 3, name: 'C', lat: 19.22, lng: 98.86 }),
    ])
    const c = initialCenterOf(it)!
    expect(c.lat).toBeCloseTo(18.81, 5)
    expect(c.lng).toBeCloseTo(98.97, 5)
  })

  it('day 省略視為第 1 天;第一天沒有座標時用最早一天有座標的站點', () => {
    expect(initialCenterOf(make([stop({ name: 'A', lat: 1, lng: 2 })]))).toEqual({ lat: 1, lng: 2 })
    const it = make([
      stop({ day: 1, name: 'A' }),
      stop({ day: 2, name: 'B', lat: 5, lng: 6 }),
      stop({ day: 4, name: 'C', lat: 9, lng: 9 }),
    ])
    expect(initialCenterOf(it)).toEqual({ lat: 5, lng: 6 })
  })

  it('完全沒有座標回 null(交給 PlanMap 退回預設起點)', () => {
    expect(initialCenterOf(make([stop({ name: 'A' })]))).toBeNull()
  })
})
