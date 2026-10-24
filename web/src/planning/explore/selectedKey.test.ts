import { describe, it, expect } from 'vitest'
import { itemKey } from './selectedKey'

describe('itemKey', () => {
  it('用 kind+名稱+座標組成識別鍵', () => {
    expect(itemKey('attraction', { name: '古城區', lat: 18.7883, lng: 98.9853 })).toBe(
      'attraction:古城區:18.7883:98.9853',
    )
  })

  it('不同 kind、相同名稱與座標時產生不同的鍵(避免跨來源誤判成同一筆)', () => {
    const item = { name: '同名同座標', lat: 1, lng: 2 }
    const hotelKey = itemKey('hotel', item)
    const attractionKey = itemKey('attraction', item)
    const placeKey = itemKey('place', item)
    const entryKey = itemKey('entry', item)
    const keys = [hotelKey, attractionKey, placeKey, entryKey]
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('相同 kind+名稱+座標永遠產生相同的鍵(可重複呼叫、可拿來做 === 比對)', () => {
    const a = itemKey('hotel', { name: 'X 飯店', lat: 25.03, lng: 121.56 })
    const b = itemKey('hotel', { name: 'X 飯店', lat: 25.03, lng: 121.56 })
    expect(a).toBe(b)
  })
})
