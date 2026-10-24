// useFitToGeocodeResults:有定位(geocode)搜尋結果時,把地圖鏡頭調到能同時看見全部(fitBounds,留 64px)。
// 搜尋結果標記遷進統一繪製層(draw/layers/searchResultLayer.ts)時拆出來:鏡頭動作不是繪製,不能放進統一繪製層的功能層。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { GeoSearchResult } from '../../api'
import { useFitToGeocodeResults } from './useFitToGeocodeResults'

class FakeBounds {
  static all: FakeBounds[] = []
  points: { lat: number; lng: number }[] = []
  constructor() {
    FakeBounds.all.push(this)
  }
  extend(p: { lat: number; lng: number }) {
    this.points.push(p)
  }
}
;(globalThis as { google?: unknown }).google = { maps: { LatLngBounds: FakeBounds } }

const res = (kind: GeoSearchResult['kind'], name: string, lat = 1, lng = 2): GeoSearchResult => ({
  kind,
  name,
  address: '',
  lat,
  lng,
})

function setup(results: GeoSearchResult[], mapReady = true) {
  const fitBounds = vi.fn()
  const map = { fitBounds } as unknown as google.maps.Map
  const props = { mapRef: { current: map }, mapReady, results }
  const hook = renderHook((p: typeof props) => useFitToGeocodeResults(p), { initialProps: props })
  return { hook, props, fitBounds }
}

beforeEach(() => {
  FakeBounds.all = []
})

describe('useFitToGeocodeResults', () => {
  it('有定位結果:fitBounds 到全部定位結果,留 64px', () => {
    const { fitBounds } = setup([res('geocode', 'A', 1, 2), res('geocode', 'B', 3, 4)])
    expect(fitBounds).toHaveBeenCalledTimes(1)
    expect(fitBounds.mock.calls[0][1]).toBe(64)
    expect(FakeBounds.all[0].points).toEqual([
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
    ])
  })

  it('只算定位結果,飯店與地點不納入範圍', () => {
    setup([res('hotel', 'H', 9, 9), res('geocode', 'G', 1, 2), res('place', 'P', 8, 8)])
    expect(FakeBounds.all[0].points).toEqual([{ lat: 1, lng: 2 }])
  })

  it('沒有定位結果:不動鏡頭', () => {
    const { fitBounds } = setup([res('hotel', 'H'), res('place', 'P')])
    expect(fitBounds).not.toHaveBeenCalled()
  })

  it('地圖還沒好:不動;好了之後才調整', () => {
    const { hook, props, fitBounds } = setup([res('geocode', 'G')], false)
    expect(fitBounds).not.toHaveBeenCalled()
    hook.rerender({ ...props, mapReady: true })
    expect(fitBounds).toHaveBeenCalledTimes(1)
  })

  it('結果內容改變:重新調整;內容沒變(換新陣列)不重複調整,避免使用者拖曳後被拉回', () => {
    const { hook, props, fitBounds } = setup([res('geocode', 'G', 1, 2)])
    hook.rerender({ ...props, results: [res('geocode', 'G', 1, 2)] })
    expect(fitBounds).toHaveBeenCalledTimes(1)
    hook.rerender({ ...props, results: [res('geocode', 'G', 5, 6)] })
    expect(fitBounds).toHaveBeenCalledTimes(2)
  })
})
