// footprintIcon——腳印圖示的 SVG path:左右腳是鏡像、各往兩側偏移,且是合法的 path 字串。
import { describe, it, expect } from 'vitest'
import { FOOTPRINT_LEFT, FOOTPRINT_RIGHT, FOOTPRINT_REFERENCE_ZOOM, footprintSpacing } from './footprintIcon'

describe('footprintIcon', () => {
  it('左右腳是不同的 path,且都是由一個腳掌加五顆腳趾組成(六個子路徑)', () => {
    expect(FOOTPRINT_LEFT).not.toBe(FOOTPRINT_RIGHT)
    for (const p of [FOOTPRINT_LEFT, FOOTPRINT_RIGHT]) {
      expect(p.match(/M/g)).toHaveLength(6)
      expect(p).not.toMatch(/NaN|undefined/)
    }
  })

  it('左腳的腳掌起點在 x 負側、右腳在 x 正側(沿路徑交錯時左右分開)', () => {
    const startX = (p: string) => Number(p.match(/^M(-?\d+(\.\d+)?),/)![1])
    expect(startX(FOOTPRINT_LEFT)).toBeLessThan(0)
    expect(startX(FOOTPRINT_RIGHT)).toBeGreaterThan(0)
    expect(startX(FOOTPRINT_LEFT)).toBe(-startX(FOOTPRINT_RIGHT))
  })
})

describe('footprintSpacing', () => {
  it('基準 zoom:間距 40px、scale 1;週期是兩步', () => {
    const s = footprintSpacing(FOOTPRINT_REFERENCE_ZOOM)
    expect(s.stepPx).toBe(40)
    expect(s.scale).toBe(1)
    expect(s.repeatPx).toBe(80)
  })

  it('zoom 越大間距與 scale 越大(單調),並限制在 20–120px、0.6–1.6', () => {
    const zooms = [8, 11, 13, 15, 17, 19, 22]
    const list = zooms.map(footprintSpacing)
    for (let i = 1; i < list.length; i++) expect(list[i].stepPx).toBeGreaterThanOrEqual(list[i - 1].stepPx)
    for (const s of list) {
      expect(s.stepPx).toBeGreaterThanOrEqual(20)
      expect(s.stepPx).toBeLessThanOrEqual(120)
      expect(s.scale).toBeGreaterThanOrEqual(0.6)
      expect(s.scale).toBeLessThanOrEqual(1.6)
    }
    expect(footprintSpacing(8).stepPx).toBe(20)
    expect(footprintSpacing(22).stepPx).toBe(120)
  })
})
