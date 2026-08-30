// useGeoPlanningState 的 geocodeCandidates/searchResults 資料流——2026-08
// 起 geocodeCandidates(型別 GeoGeocodeCandidate[])的擁有權從
// GeoOutlinePanel.tsx 搬到這個共用狀態層(見該檔案對應 state 宣告處的
// 完整說明),searchResults 也從此改成用 useMemo 從 geocodeCandidates 衍生
// (取代原本兩份手動同步的獨立 state)。這裡驗證兩件事:
//
// 1. 衍生關係本身——setGeocodeCandidates 寫入後,searchResults 應該同步
//    反映轉型後的內容(geocodeCandidateToSearchResult),不需要再另外呼叫
//    任何同步用的 setter。
// 2. 這次新增的清空功能——呼叫 setGeocodeCandidates([]) 之後,
//    geocodeCandidates 與 searchResults 應該一起變成空陣列。這是
//    GeoOutlinePhoneListDrawer.onClose/桌面版 GeoHotelSidebar.onClose
//    實際呼叫的同一顆 setter,見 GeoOutlinePhoneView.tsx/DesktopLayout.tsx
//    對應 onClose 的說明。
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGeoPlanningState } from './useGeoPlanningState'
import type { ClientConfig, GeoGeocodeCandidate, GeoSearchResult } from '../api'

const cfg: ClientConfig = { baseURL: 'http://localhost', token: 'test-token' }

const fakeCandidate: GeoGeocodeCandidate = {
  name: '測試地點',
  address: '測試地址',
  lat: 25.03,
  lng: 121.56,
  placeId: 'place_1',
  category: 'restaurant',
}

describe('useGeoPlanningState：geocodeCandidates 與 searchResults 的衍生關係', () => {
  it('setGeocodeCandidates 寫入後，searchResults 同步反映轉型後的內容', () => {
    const { result } = renderHook(() => useGeoPlanningState({ cfg, tripID: 'trip_1' }))

    expect(result.current.geocodeCandidates).toEqual([])
    expect(result.current.searchResults).toEqual([])

    act(() => {
      result.current.setGeocodeCandidates([fakeCandidate])
    })

    expect(result.current.geocodeCandidates).toEqual([fakeCandidate])
    expect(result.current.searchResults).toHaveLength(1)
    expect(result.current.searchResults[0]).toMatchObject({
      kind: 'geocode',
      placeId: 'place_1',
      name: '測試地點',
      lat: 25.03,
      lng: 121.56,
    })
  })

  it('清空 geocodeCandidates（如清單抽屜/候選籃側欄關閉時呼叫）後，searchResults 也一併變成空陣列', () => {
    const { result } = renderHook(() => useGeoPlanningState({ cfg, tripID: 'trip_1' }))

    act(() => {
      result.current.setGeocodeCandidates([fakeCandidate])
    })
    expect(result.current.searchResults).toHaveLength(1)

    // 對應 GeoOutlinePhoneListDrawer.onClose / GeoHotelSidebar.onClose
    // 實際呼叫的同一顆 setter——清空唯一資料來源,地圖 marker 與清單/
    // 候選籃側欄應該一起消失。
    act(() => {
      result.current.setGeocodeCandidates([])
    })

    expect(result.current.geocodeCandidates).toEqual([])
    expect(result.current.searchResults).toEqual([])
  })
})

// patchGeocodeCandidateText/patchGeocodeCandidatePhoto 的 placeId 二次
// 確認——驗證重複快速點選不同候選(A → B)時,A 的文字/照片查詢若在 B
// 已經顯示之後才回來,不會誤蓋掉 B 卡片的內容。這是 GeoOutlinePanel.tsx
// 的 useEffect + cancelled flag 之外的第二道防線(見這兩個函式的完整
// 說明),即使呼叫端的 cancelled flag 邏輯意外失效(或未來新增一條繞過
// 該 effect 的呼叫路徑),這裡仍能擋下錯誤的 patch。
describe('useGeoPlanningState：patchGeocodeCandidateText/patchGeocodeCandidatePhoto 的 placeId 二次確認', () => {
  const placeResultA: GeoSearchResult = {
    kind: 'place',
    placeId: 'place_A',
    name: '候選 A',
    address: '地址 A',
    lat: 25.0,
    lng: 121.5,
  }
  const placeResultB: GeoSearchResult = {
    kind: 'place',
    placeId: 'place_B',
    name: '候選 B',
    address: '地址 B',
    lat: 25.1,
    lng: 121.6,
  }

  it('晚到的 A 查詢結果不會蓋掉已經切換顯示的 B 卡片內容', () => {
    const { result } = renderHook(() => useGeoPlanningState({ cfg, tripID: 'trip_1' }))

    // 使用者連續快速點選 A、B 兩個候選(對應地圖上點兩顆不同 marker)。
    act(() => {
      result.current.selectSearchResult(placeResultA)
    })
    act(() => {
      result.current.selectSearchResult(placeResultB)
    })
    expect(result.current.infoContent?.placeId).toBe('place_B')

    // A 的文字查詢晚到——即使呼叫端(GeoOutlinePanel.tsx)的 cancelled
    // flag 這次意外沒有擋下(模擬防線失效的情境),這裡的 placeId 比對
    // 仍要讓這個 patch 被忽略,不能把 B 卡片的內容改成 A 的文字。
    act(() => {
      result.current.patchGeocodeCandidateText('place_A', {
        name: '候選 A(補查文字)',
        address: '地址 A(補查)',
        summary: 'A 的簡介',
        lat: 25.0,
        lng: 121.5,
      })
    })
    expect(result.current.infoContent?.name).toBe('候選 B')
    expect(result.current.infoContent?.summary).not.toBe('A 的簡介')

    // B 的查詢正常回來——placeId 對得上,應該正確套用。
    act(() => {
      result.current.patchGeocodeCandidateText('place_B', {
        name: '候選 B(補查文字)',
        address: '地址 B(補查)',
        summary: 'B 的簡介',
        lat: 25.1,
        lng: 121.6,
      })
    })
    expect(result.current.infoContent?.summary).toBe('B 的簡介')
  })

  it('晚到的 A 照片查詢不會蓋掉已經切換顯示的 B 卡片照片', () => {
    const { result } = renderHook(() => useGeoPlanningState({ cfg, tripID: 'trip_1' }))

    act(() => {
      result.current.selectSearchResult(placeResultA)
    })
    act(() => {
      result.current.selectSearchResult(placeResultB)
    })

    act(() => {
      result.current.patchGeocodeCandidatePhoto('place_A', 'https://example.com/a.jpg')
    })
    expect(result.current.infoContent?.photoUrl).not.toBe('https://example.com/a.jpg')

    act(() => {
      result.current.patchGeocodeCandidatePhoto('place_B', 'https://example.com/b.jpg')
    })
    expect(result.current.infoContent?.photoUrl).toBe('https://example.com/b.jpg')
  })
})
