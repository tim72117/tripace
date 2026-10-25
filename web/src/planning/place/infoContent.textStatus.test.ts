// PlaceInfoContent.textStatus 的初始值——只有「開卡後真的會去查 Google
// 地點文字(簡介、評分)」的來源一開始是 'pending'(見
// planning/member/usePlanningState.ts 的 placeTextFetch effect),其餘資料
// 已同步齊全或根本不查文字的來源一律 undefined,卡片才不會永遠停在骨架。
import { describe, it, expect } from 'vitest'
import type { GeoAttraction, GeoPlaceDetails, GeoSearchResult } from '../../api'
import {
  attractionToInfoContent,
  candidateInfoContent,
  poiInfoContent,
  searchResultInfoContent,
} from './infoContent'

const place: GeoSearchResult = { kind: 'place', placeId: 'p1', name: 'A', address: 'addr', lat: 1, lng: 2 }

describe('textStatus 初始值', () => {
  it('搜尋結果/推薦地點(有 placeId):pending', () => {
    expect(searchResultInfoContent(place).textStatus).toBe('pending')
  })

  it('沒有 placeId 的搜尋結果、geocode 定位結果:undefined', () => {
    expect(searchResultInfoContent({ ...place, placeId: undefined }).textStatus).toBeUndefined()
    expect(
      searchResultInfoContent({ kind: 'geocode', name: 'g', address: 'a', lat: 1, lng: 2 } as GeoSearchResult).textStatus,
    ).toBeUndefined()
  })

  it('Google POI 詳情(文字已同步帶齊):undefined', () => {
    const details = { name: 'P', address: 'a', lat: 1, lng: 2, summary: 's', rating: 4.2 } as GeoPlaceDetails
    expect(poiInfoContent(details).textStatus).toBeUndefined()
  })

  it('人工建檔景點(文字同步帶進來):undefined', () => {
    const a = { name: 'X', placeId: 'p9', lat: 1, lng: 2, summary: 's' } as GeoAttraction
    expect(attractionToInfoContent(a).textStatus).toBeUndefined()
  })

  it('候選籃:place 有 placeId 為 pending,entry/無 placeId 為 undefined', () => {
    expect(
      candidateInfoContent({ kind: 'place', name: 'A', address: 'a', lat: 1, lng: 2, primaryType: '', placeId: 'p1' }).textStatus,
    ).toBe('pending')
    expect(
      candidateInfoContent({ kind: 'place', name: 'A', address: 'a', lat: 1, lng: 2, primaryType: '' }).textStatus,
    ).toBeUndefined()
    expect(
      candidateInfoContent({ kind: 'entry', id: 'e1', name: 'E', lat: 1, lng: 2, inTrip: true } as Parameters<typeof candidateInfoContent>[0])
        .textStatus,
    ).toBeUndefined()
  })
})
