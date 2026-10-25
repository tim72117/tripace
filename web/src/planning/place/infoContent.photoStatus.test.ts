// PlaceInfoContent.photoStatus 的初始值——只有「開卡後真的會去查照片」的來源
// (有 placeId、還沒有照片)一開始是 'pending'(見 planning/member/usePlanningState.ts
// 的 placePhotoFetch effect);照片已同步帶齊、或根本沒有東西可查的來源一律
// undefined(已是最終結果),PhotoCarousel 才不會對「確定沒照片」永遠掃光。
import { describe, it, expect } from 'vitest'
import type { GeoAttraction, GeoPlaceDetails, GeoSearchResult } from '../../api'
import {
  attractionToInfoContent,
  candidateInfoContent,
  poiInfoContent,
  searchResultInfoContent,
} from './infoContent'

const place: GeoSearchResult = { kind: 'place', placeId: 'p1', name: 'A', address: 'addr', lat: 1, lng: 2 }

describe('photoStatus 初始值', () => {
  it('搜尋結果/推薦地點(有 placeId、沒有照片):pending', () => {
    expect(searchResultInfoContent(place).photoStatus).toBe('pending')
  })

  it('已帶照片、沒有 placeId、geocode 定位結果:undefined', () => {
    expect(searchResultInfoContent({ ...place, photoUrl: 'https://example.com/a.jpg' }).photoStatus).toBeUndefined()
    expect(searchResultInfoContent({ ...place, placeId: undefined }).photoStatus).toBeUndefined()
    expect(
      searchResultInfoContent({ kind: 'geocode', name: 'g', address: 'a', lat: 1, lng: 2, placeId: 'g1' } as GeoSearchResult)
        .photoStatus,
    ).toBeUndefined()
  })

  it('Google POI 詳情(照片清單已同步帶齊):undefined', () => {
    const details = { name: 'P', address: 'a', lat: 1, lng: 2 } as GeoPlaceDetails
    expect(poiInfoContent(details).photoStatus).toBeUndefined()
  })

  it('人工建檔景點:有 placeId 為 pending(由 usePlanningState 補查),沒有 placeId 為 undefined', () => {
    const a = { name: 'X', placeId: 'p9', lat: 1, lng: 2, summary: 's' } as GeoAttraction
    expect(attractionToInfoContent(a).photoStatus).toBe('pending')
    expect(attractionToInfoContent({ ...a, placeId: undefined }).photoStatus).toBeUndefined()
  })

  it('候選籃:place 有 placeId 為 pending;entry、hotel、無 placeId 為 undefined', () => {
    expect(
      candidateInfoContent({ kind: 'place', name: 'A', address: 'a', lat: 1, lng: 2, primaryType: '', placeId: 'p1' }).photoStatus,
    ).toBe('pending')
    expect(
      candidateInfoContent({ kind: 'place', name: 'A', address: 'a', lat: 1, lng: 2, primaryType: '' }).photoStatus,
    ).toBeUndefined()
    expect(
      candidateInfoContent({ kind: 'entry', id: 'e1', name: 'E', lat: 1, lng: 2, inTrip: true } as Parameters<typeof candidateInfoContent>[0])
        .photoStatus,
    ).toBeUndefined()
    expect(
      candidateInfoContent({ kind: 'hotel', name: 'H', address: 'h', lat: 1, lng: 2 } as Parameters<typeof candidateInfoContent>[0])
        .photoStatus,
    ).toBeUndefined()
  })
})
