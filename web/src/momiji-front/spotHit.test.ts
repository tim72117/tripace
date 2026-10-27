import { describe, expect, it } from 'vitest'
import { nearestWithin } from './spotHit'

const pts = [
  { id: 'a', x: 100, y: 100 },
  { id: 'b', x: 130, y: 100 },
]

describe('nearestWithin', () => {
  it('半徑內回傳該點;半徑外回 null', () => {
    expect(nearestWithin(pts, 105, 102, 16)).toBe('a')
    expect(nearestWithin(pts, 200, 200, 16)).toBeNull()
  })
  it('邊界:剛好等於半徑算命中,超過一點點不算', () => {
    const solo = [{ id: 'a', x: 100, y: 100 }]
    expect(nearestWithin(solo, 116, 100, 16)).toBe('a')
    expect(nearestWithin(solo, 116.5, 100, 16)).toBeNull()
  })
  it('多個點都在半徑內時取最近的,距離相同取清單前面的', () => {
    expect(nearestWithin(pts, 118, 100, 20)).toBe('b')
    expect(nearestWithin(pts, 115, 100, 20)).toBe('a')
  })
  it('空清單回 null', () => {
    expect(nearestWithin([], 0, 0, 16)).toBeNull()
  })
})

describe('nearestWithin:名稱文字也可點', () => {
  // 徽章中心 (100,100),文字寬 60:文字從 x=113 畫到 173
  const spot = [{ id: 'a', x: 100, y: 100, labelWidth: 60 }]
  it('點在文字上(超出徽章半徑)也命中', () => {
    expect(nearestWithin(spot, 150, 100, 18)).toBe('a')
    expect(nearestWithin(spot, 170, 104, 18)).toBe('a')
  })
  it('文字矩形的邊界:左右各留 SPOT_LABEL_PAD_X、上下 SPOT_LABEL_HALF_HEIGHT,超過不算', () => {
    expect(nearestWithin(spot, 177, 100, 18)).toBe('a') // 173 + 4
    expect(nearestWithin(spot, 178, 100, 18)).toBeNull()
    expect(nearestWithin(spot, 150, 110, 18)).toBe('a') // ±10
    expect(nearestWithin(spot, 150, 111, 18)).toBeNull()
  })
  it('沒給 labelWidth 的點只有圓形可點(文字位置點不到)', () => {
    expect(nearestWithin([{ id: 'a', x: 100, y: 100 }], 150, 100, 18)).toBeNull()
  })
  it('文字重疊時取離自己文字中心較近的那個', () => {
    const two = [
      { id: 'a', x: 100, y: 100, labelWidth: 80 }, // 文字 113..193,中心 153
      { id: 'b', x: 140, y: 100, labelWidth: 80 }, // 文字 153..233,中心 193
    ]
    expect(nearestWithin(two, 160, 100, 18)).toBe('a')
    expect(nearestWithin(two, 185, 100, 18)).toBe('b')
  })
  it('點在別人的文字上、同時也在自己的徽章半徑內:取較近的錨點', () => {
    const two = [
      { id: 'a', x: 100, y: 100, labelWidth: 80 }, // 文字中心 153
      { id: 'b', x: 150, y: 100, labelWidth: 20 }, // 徽章中心 150
    ]
    expect(nearestWithin(two, 150, 100, 18)).toBe('b') // 距 b 徽章 0,距 a 文字中心 3
  })
})
