import { describe, it, expect } from 'vitest'
import { estimateTransit } from './estimateTransit'

// 緯度 1 度約 111.2km;用同經度、不同緯度的兩點做距離。
const at = (lat: number) => ({ lat, lng: 100 })

describe('estimateTransit', () => {
  it('<=1200m 步行,80m/分,距離用公尺顯示', () => {
    expect(estimateTransit(at(18), at(18.0045))).toEqual({ mode: '步行', minutes: 6, distance: '500m' })
  })
  it('1200m~5km 公車,300m/分,距離用公里顯示', () => {
    expect(estimateTransit(at(18), at(18.027))).toEqual({ mode: '公車', minutes: 10, distance: '3.0km' })
  })
  it('超過 5km 開車,400m/分', () => {
    expect(estimateTransit(at(18), at(18.09))).toEqual({ mode: '開車', minutes: 25, distance: '10.0km' })
  })
  it('兩站幾乎同一點(< 100m)不畫膠囊', () => {
    expect(estimateTransit(at(18), at(18))).toBeUndefined()
    expect(estimateTransit(at(18), at(18.0005))).toBeUndefined()
  })
})
