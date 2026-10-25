// usePlanningState 的 geocodeCandidates/searchResults 資料流——2026-08
// 起 geocodeCandidates(型別 GeoGeocodeCandidate[])的擁有權從
// 當時的 GeoOutlinePanel.tsx(已退役)搬到這個共用狀態層(見 usePlanningState.ts 對應 state 宣告處的
// 完整說明),searchResults 也從此改成用 useMemo 從 geocodeCandidates 衍生
// (取代原本兩份手動同步的獨立 state)。這裡驗證兩件事:
//
// 1. 衍生關係本身——setGeocodeCandidates 寫入後,searchResults 應該同步
//    反映轉型後的內容(geocodeCandidateToSearchResult),不需要再另外呼叫
//    任何同步用的 setter。
// 2. 這次新增的清空功能——呼叫 setGeocodeCandidates([]) 之後,
//    geocodeCandidates 與 searchResults 應該一起變成空陣列。這是
//    phone/ResultList.onClose/桌面版 planning/place/desktop/ResultList.onClose
//    實際呼叫的同一顆 setter,見 PlanPhoneView.tsx/desktop/Content.tsx
//    對應 onClose 的說明。
import { describe, it, expect, vi } from 'vitest'
import { StrictMode, createElement, type ReactNode } from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePlanningState } from './usePlanningState'
import type { ClientConfig, GeoGeocodeCandidate, GeoPlaceText, GeoSearchResult } from '../../api'
import type { PlanAiDataSource } from '../data/source'
import type { PlaceInfoContent } from '../place/PlacePanel'

const cfg: ClientConfig = { baseURL: 'http://localhost', token: 'test-token' }

// stubSource:每個方法都是 stub(預設回傳永不回來的 Promise)的假資料存取層——
// 不展開真實的 createPlanAiApiDataSource:沒覆寫到的方法會真的打網路。選取
// Google 地點會觸發文字/照片查詢(見 usePlanningState.ts 的 placeTextFetch/
// placePhotoFetch effect),既有測試只驗證手動 patch 的行為,讓查詢永遠不回來。
function stubSource(overrides: Partial<PlanAiDataSource> = {}): PlanAiDataSource {
  const never = () => new Promise<never>(() => {})
  return {
    placeDetails: vi.fn(never),
    transitEstimate: vi.fn(never),
    photoAssets: vi.fn(never),
    geoPlaceDetails: vi.fn(never),
    attractionsByCity: vi.fn(never),
    attractionByID: vi.fn(never),
    placePhoto: vi.fn(never),
    placeText: vi.fn(never),
    geocode: vi.fn(never),
    searchNearby: vi.fn(never),
    nearbyAttractionAreas: vi.fn(never),
    ...overrides,
  }
}
const dataSource = stubSource()

const fakeCandidate: GeoGeocodeCandidate = {
  name: '測試地點',
  address: '測試地址',
  lat: 25.03,
  lng: 121.56,
  placeId: 'place_1',
  category: 'restaurant',
}

describe('usePlanningState：geocodeCandidates 與 searchResults 的衍生關係', () => {
  it('setGeocodeCandidates 寫入後，searchResults 同步反映轉型後的內容', () => {
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource, tripID: 'trip_1' }))

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
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource, tripID: 'trip_1' }))

    act(() => {
      result.current.setGeocodeCandidates([fakeCandidate])
    })
    expect(result.current.searchResults).toHaveLength(1)

    // 對應 phone/ResultList.onClose / planning/place/desktop/ResultList.onClose
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
// 已經顯示之後才回來,不會誤蓋掉 B 卡片的內容。這是 useMapState.ts
// 的 useEffect + cancelled flag 之外的第二道防線(見這兩個函式的完整
// 說明),即使呼叫端的 cancelled flag 邏輯意外失效(或未來新增一條繞過
// 該 effect 的呼叫路徑),這裡仍能擋下錯誤的 patch。
describe('usePlanningState：patchGeocodeCandidateText/patchGeocodeCandidatePhoto 的 placeId 二次確認', () => {
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
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource, tripID: 'trip_1' }))

    // 使用者連續快速點選 A、B 兩個候選(對應地圖上點兩顆不同 marker)。
    act(() => {
      result.current.selectSearchResult(placeResultA)
    })
    act(() => {
      result.current.selectSearchResult(placeResultB)
    })
    expect(result.current.infoContent?.placeId).toBe('place_B')

    // A 的文字查詢晚到——即使呼叫端(useMapState.ts)的 cancelled
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
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource, tripID: 'trip_1' }))

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

// textStatus 資料流——選取 Google 地點(有 placeId)開卡時 textStatus 是
// 'pending',usePlanningState 自己發起文字查詢:成功 → 套用簡介/評分並清成
// undefined;失敗 → 'failed'(卡片顯示「簡介載入失敗。」,不永遠停在骨架);
// 資料存取層沒有實作 placeText(訪客版)→ 直接清成 undefined。
describe('usePlanningState:文字查詢旗標 textStatus', () => {
  const placeA: GeoSearchResult = { kind: 'place', placeId: 'place_A', name: '候選 A', address: '地址 A', lat: 25, lng: 121.5 }
  const placeB: GeoSearchResult = { kind: 'place', placeId: 'place_B', name: '候選 B', address: '地址 B', lat: 25.1, lng: 121.6 }
  const textOf = (name: string): GeoPlaceText => ({ name, address: 'x', lat: 0, lng: 0, summary: `${name} 的簡介`, rating: 4.4 })

  function deferredSource() {
    const pending = new Map<string, { resolve: (t: GeoPlaceText) => void; reject: (e: Error) => void }>()
    const placeText = vi.fn(
      (placeId: string) =>
        new Promise<GeoPlaceText>((resolve, reject) => {
          pending.set(placeId, { resolve, reject })
        }),
    )
    const ds = stubSource({ placeText })
    return { ds, pending, placeText }
  }

  it('查詢前為 pending,成功後套用簡介/評分並清成 undefined', async () => {
    const { ds, pending } = deferredSource()
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }))
    act(() => result.current.selectSearchResult(placeA))
    expect(result.current.infoContent?.textStatus).toBe('pending')
    await waitFor(() => expect(pending.has('place_A')).toBe(true))
    await act(async () => pending.get('place_A')!.resolve(textOf('A')))
    expect(result.current.infoContent?.textStatus).toBeUndefined()
    expect(result.current.infoContent?.summary).toBe('A 的簡介')
    expect(result.current.infoContent?.badges).toEqual(['評分 4.4'])
    expect(result.current.infoContent?.placeId).toBe('place_A')
  })

  it('查詢失敗:textStatus 變成 failed', async () => {
    const { ds, pending } = deferredSource()
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }))
    act(() => result.current.selectSearchResult(placeA))
    await waitFor(() => expect(pending.has('place_A')).toBe(true))
    await act(async () => pending.get('place_A')!.reject(new Error('boom')))
    expect(result.current.infoContent?.textStatus).toBe('failed')
    expect(result.current.infoContent?.summary).toBeUndefined()
  })

  it('資料存取層沒有 placeText(訪客版):從開卡第一個畫面起就沒有骨架(textStatus 從未是 pending)', async () => {
    const ds = stubSource({ placeText: undefined })
    const seen: (PlaceInfoContent['textStatus'] | 'no-card')[] = []
    const { result } = renderHook(() => {
      const s = usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' })
      seen.push(s.infoContent ? s.infoContent.textStatus : 'no-card')
      return s
    })
    act(() => result.current.selectSearchResult(placeA))
    await act(async () => {})
    expect(result.current.infoContent?.name).toBe('候選 A')
    expect(seen).not.toContain('pending')
    // 照片查詢照常(placePhoto 有實作),跟文字無關。
    expect(ds.placePhoto).toHaveBeenCalledTimes(1)
  })

  it('A 查詢中切到 B,A 晚到的失敗不會把 B 標成 failed', async () => {
    const { ds, pending } = deferredSource()
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }))
    act(() => result.current.selectSearchResult(placeA))
    await waitFor(() => expect(pending.has('place_A')).toBe(true))
    act(() => result.current.selectSearchResult(placeB))
    await waitFor(() => expect(pending.has('place_B')).toBe(true))
    await act(async () => pending.get('place_A')!.reject(new Error('late')))
    expect(result.current.infoContent?.name).toBe('候選 B')
    expect(result.current.infoContent?.textStatus).toBe('pending')
  })

  it('失敗後重開同一地點:回到 pending 並重新查詢(失敗不記憶)', async () => {
    const { ds, pending, placeText } = deferredSource()
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }))
    act(() => result.current.selectSearchResult(placeA))
    await waitFor(() => expect(pending.has('place_A')).toBe(true))
    await act(async () => pending.get('place_A')!.reject(new Error('boom')))
    expect(result.current.infoContent?.textStatus).toBe('failed')
    act(() => result.current.clearSelection())
    act(() => result.current.selectSearchResult(placeA))
    expect(result.current.infoContent?.textStatus).toBe('pending')
    await waitFor(() => expect(placeText).toHaveBeenCalledTimes(2))
    await act(async () => pending.get('place_A')!.resolve(textOf('A')))
    expect(result.current.infoContent?.summary).toBe('A 的簡介')
  })

  it('重開已查到文字的地點:開卡當下就帶簡介(不經過骨架),也不重打 place-text', async () => {
    const { ds, pending, placeText } = deferredSource()
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }))
    act(() => result.current.selectSearchResult(placeA))
    await waitFor(() => expect(pending.has('place_A')).toBe(true))
    await act(async () => pending.get('place_A')!.resolve(textOf('A')))
    act(() => result.current.clearSelection())
    act(() => result.current.selectSearchResult(placeA))
    expect(result.current.infoContent?.textStatus).toBeUndefined()
    expect(result.current.infoContent?.summary).toBe('A 的簡介')
    expect(result.current.infoContent?.badges).toEqual(['評分 4.4'])
    await act(async () => {})
    expect(placeText).toHaveBeenCalledTimes(1)
  })

  it('查到但沒有任何文字(沒有簡介也沒有評分)不記憶:重開會重新查', async () => {
    const { ds, pending, placeText } = deferredSource()
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }))
    act(() => result.current.selectSearchResult(placeA))
    await waitFor(() => expect(pending.has('place_A')).toBe(true))
    await act(async () => pending.get('place_A')!.resolve({ name: 'A', address: 'x', lat: 0, lng: 0 }))
    act(() => result.current.clearSelection())
    act(() => result.current.selectSearchResult(placeA))
    expect(result.current.infoContent?.textStatus).toBe('pending')
    await waitFor(() => expect(placeText).toHaveBeenCalledTimes(2))
  })

  it('A → B → A 往返、第一次 A 的請求還沒回來:第二次 A 共用同一個請求,結果只套一次且正確', async () => {
    const { ds, pending, placeText } = deferredSource()
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }))
    act(() => result.current.selectSearchResult(placeA))
    await waitFor(() => expect(pending.has('place_A')).toBe(true))
    act(() => result.current.selectSearchResult(placeB))
    act(() => result.current.selectSearchResult(placeA))
    await act(async () => {})
    expect(placeText.mock.calls.filter(([id]) => id === 'place_A')).toHaveLength(1)
    await act(async () => pending.get('place_A')!.resolve(textOf('A')))
    expect(result.current.infoContent?.name).toBe('候選 A')
    expect(result.current.infoContent?.summary).toBe('A 的簡介')
    expect(result.current.infoContent?.textStatus).toBeUndefined()
  })

  it('A → B → A 往返、第一次 A 的請求在 B 期間失敗:第二次 A 重新查,不被第一次的失敗標成 failed', async () => {
    const { ds, pending, placeText } = deferredSource()
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }))
    act(() => result.current.selectSearchResult(placeA))
    await waitFor(() => expect(pending.has('place_A')).toBe(true))
    const firstA = pending.get('place_A')!
    act(() => result.current.selectSearchResult(placeB))
    await act(async () => firstA.reject(new Error('late')))
    act(() => result.current.selectSearchResult(placeA))
    await waitFor(() => expect(placeText.mock.calls.filter(([id]) => id === 'place_A')).toHaveLength(2))
    expect(result.current.infoContent?.textStatus).toBe('pending')
    await act(async () => pending.get('place_A')!.resolve(textOf('A2')))
    expect(result.current.infoContent?.summary).toBe('A2 的簡介')
  })

  it('文字補上後 candidate 仍是開卡時那份(帶 placeId、primaryType);候選籃卡片仍沒有 candidate', async () => {
    const { ds, pending } = deferredSource()
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }))
    const withType: GeoSearchResult = { ...placeA, primaryType: 'museum' } as GeoSearchResult
    act(() => result.current.selectSearchResult(withType))
    const candidateBefore = result.current.infoContent?.candidate
    expect(candidateBefore).toMatchObject({ kind: 'place', placeId: 'place_A' })
    await waitFor(() => expect(pending.has('place_A')).toBe(true))
    await act(async () => pending.get('place_A')!.resolve(textOf('A')))
    expect(result.current.infoContent?.candidate).toBe(candidateBefore)

    act(() =>
      result.current.selectCandidateFromBasket({ kind: 'place', name: 'C', address: 'c', lat: 1, lng: 2, placeId: 'place_C', primaryType: 'cafe' }),
    )
    await waitFor(() => expect(pending.has('place_C')).toBe(true))
    await act(async () => pending.get('place_C')!.resolve(textOf('C')))
    expect(result.current.infoContent?.summary).toBe('C 的簡介')
    expect(result.current.infoContent?.candidate).toBeUndefined()
  })

  it('卸載時查詢中:之後 resolve 不 dispatch、不報 act/卸載警告', async () => {
    const { ds, pending } = deferredSource()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { result, unmount } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }))
      act(() => result.current.selectSearchResult(placeA))
      await waitFor(() => expect(pending.has('place_A')).toBe(true))
      unmount()
      await pending.get('place_A')!.resolve(textOf('A'))
      await Promise.resolve()
      expect(errSpy).not.toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
    }
  })

  it('StrictMode(開發模式 effect 跑兩次)不會多打 place-text/place-photo', async () => {
    const { ds, placeText } = deferredSource()
    const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children)
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }), { wrapper })
    act(() => result.current.selectSearchResult(placeA))
    await act(async () => {})
    expect(placeText).toHaveBeenCalledTimes(1)
    expect(ds.placePhoto).toHaveBeenCalledTimes(1)
  })

  it('patchGeocodeCandidateText 只套用在文字仍 pending 的同一地點卡片(第二道防線)', () => {
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource, tripID: 'trip_1' }))
    act(() => result.current.selectSearchResult(placeA))
    // 同一個 placeId 的卡片被換成同步就有簡介的內容(例如點了同一地點的 POI)。
    act(() =>
      result.current.selectPlaceContent({ name: '候選 A', placeId: 'place_A', summary: '同步簡介', badges: ['評分 4.9'] }),
    )
    act(() => result.current.patchGeocodeCandidateText('place_A', textOf('A')))
    expect(result.current.infoContent?.summary).toBe('同步簡介')
    expect(result.current.infoContent?.badges).toEqual(['評分 4.9'])
  })
  it('A 查詢中切到 B:A 晚到的結果不套到 B,B 自己的結果才清掉旗標', async () => {
    const { ds, pending } = deferredSource()
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }))
    act(() => result.current.selectSearchResult(placeA))
    await waitFor(() => expect(pending.has('place_A')).toBe(true))
    act(() => result.current.selectSearchResult(placeB))
    await waitFor(() => expect(pending.has('place_B')).toBe(true))
    await act(async () => pending.get('place_A')!.resolve(textOf('A')))
    expect(result.current.infoContent?.name).toBe('候選 B')
    expect(result.current.infoContent?.textStatus).toBe('pending')
    await act(async () => pending.get('place_B')!.reject(new Error('x')))
    expect(result.current.infoContent?.textStatus).toBe('failed')
  })

  it('候選籃的 Google 地點也會查文字', async () => {
    const { ds, pending } = deferredSource()
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }))
    act(() =>
      result.current.selectCandidateFromBasket({ kind: 'place', name: 'C', address: 'c', lat: 1, lng: 2, placeId: 'place_C' }),
    )
    expect(result.current.infoContent?.textStatus).toBe('pending')
    await waitFor(() => expect(pending.has('place_C')).toBe(true))
    await act(async () => pending.get('place_C')!.resolve(textOf('C')))
    expect(result.current.infoContent?.summary).toBe('C 的簡介')
    expect(result.current.infoContent?.textStatus).toBeUndefined()
  })
})

// photoStatus 資料流——照片跟文字一樣「由卡片內容驅動」:卡片的 photoStatus 是
// 'pending' 就查 place-photo;查到 → photoUrl + undefined、查到但沒有 → 'none'、
// 失敗 → 'failed'。查到的照片以 placeId 記住,同一地點重開直接帶回。
describe('usePlanningState:照片查詢旗標 photoStatus', () => {
  const placeA: GeoSearchResult = { kind: 'place', placeId: 'place_A', name: '候選 A', address: '地址 A', lat: 25, lng: 121.5 }
  const placeB: GeoSearchResult = { kind: 'place', placeId: 'place_B', name: '候選 B', address: '地址 B', lat: 25.1, lng: 121.6 }

  function deferredPhotoSource() {
    const pending = new Map<string, { resolve: (r: { googlePhotoUrls?: string[] }) => void; reject: (e: Error) => void }>()
    const placePhoto = vi.fn(
      (placeId: string) =>
        new Promise<{ googlePhotoUrls?: string[] }>((resolve, reject) => {
          pending.set(placeId, { resolve, reject })
        }),
    )
    return { ds: stubSource({ placePhoto }), pending, placePhoto }
  }

  it('開卡 pending → 查到照片:photoUrl 補上、photoStatus 清成 undefined', async () => {
    const { ds, pending } = deferredPhotoSource()
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }))
    act(() => result.current.selectSearchResult(placeA))
    expect(result.current.infoContent?.photoStatus).toBe('pending')
    await waitFor(() => expect(pending.has('place_A')).toBe(true))
    await act(async () => pending.get('place_A')!.resolve({ googlePhotoUrls: ['https://example.com/a.jpg'] }))
    expect(result.current.infoContent?.photoUrl).toBe('https://example.com/a.jpg')
    expect(result.current.infoContent?.photoStatus).toBeUndefined()
  })

  it('查到但沒有照片 → none;查詢失敗 → failed', async () => {
    const { ds, pending } = deferredPhotoSource()
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }))
    act(() => result.current.selectSearchResult(placeA))
    await waitFor(() => expect(pending.has('place_A')).toBe(true))
    await act(async () => pending.get('place_A')!.resolve({ googlePhotoUrls: [] }))
    expect(result.current.infoContent?.photoStatus).toBe('none')

    act(() => result.current.selectSearchResult(placeB))
    await waitFor(() => expect(pending.has('place_B')).toBe(true))
    await act(async () => pending.get('place_B')!.reject(new Error('boom')))
    expect(result.current.infoContent?.photoStatus).toBe('failed')
  })

  it('同一地點關卡後重開:照片直接帶回(不是永遠掃光),也不重打 place-photo', async () => {
    const { ds, pending, placePhoto } = deferredPhotoSource()
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }))
    act(() => result.current.selectSearchResult(placeA))
    await waitFor(() => expect(pending.has('place_A')).toBe(true))
    await act(async () => pending.get('place_A')!.resolve({ googlePhotoUrls: ['https://example.com/a.jpg'] }))
    act(() => result.current.clearSelection())
    act(() => result.current.selectSearchResult(placeA))
    expect(result.current.infoContent?.photoUrl).toBe('https://example.com/a.jpg')
    expect(result.current.infoContent?.photoStatus).toBeUndefined()
    await act(async () => {})
    expect(placePhoto).toHaveBeenCalledTimes(1)
  })

  it('同一地點在查到之前就關卡重開:仍會拿到照片(不會因為「查過了」被跳過)', async () => {
    const { ds, pending } = deferredPhotoSource()
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }))
    act(() => result.current.selectSearchResult(placeA))
    await waitFor(() => expect(pending.has('place_A')).toBe(true))
    act(() => result.current.clearSelection())
    act(() => result.current.selectCandidateFromBasket({ kind: 'place', name: '候選 A', address: '地址 A', lat: 25, lng: 121.5, placeId: 'place_A', primaryType: '' }))
    expect(result.current.infoContent?.photoStatus).toBe('pending')
    await act(async () => pending.get('place_A')!.resolve({ googlePhotoUrls: ['https://example.com/a.jpg'] }))
    expect(result.current.infoContent?.photoUrl).toBe('https://example.com/a.jpg')
  })

  it('上次查到沒有照片:重開回到 pending 並重新查(沒照片不記憶,後端可能之後才補到)', async () => {
    const { ds, pending, placePhoto } = deferredPhotoSource()
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }))
    act(() => result.current.selectSearchResult(placeA))
    await waitFor(() => expect(pending.has('place_A')).toBe(true))
    await act(async () => pending.get('place_A')!.resolve({}))
    act(() => result.current.clearSelection())
    act(() => result.current.selectSearchResult(placeA))
    expect(result.current.infoContent?.photoStatus).toBe('pending')
    await waitFor(() => expect(placePhoto).toHaveBeenCalledTimes(2))
  })

  it('A 查詢中切到 B:A 晚到的照片不套到 B', async () => {
    const { ds, pending } = deferredPhotoSource()
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }))
    act(() => result.current.selectSearchResult(placeA))
    await waitFor(() => expect(pending.has('place_A')).toBe(true))
    act(() => result.current.selectSearchResult(placeB))
    await act(async () => pending.get('place_A')!.resolve({ googlePhotoUrls: ['https://example.com/a.jpg'] }))
    expect(result.current.infoContent?.photoUrl).toBeUndefined()
    expect(result.current.infoContent?.photoStatus).toBe('pending')
  })

  it('資料存取層沒有 placePhoto:開卡就是 undefined(靜態佔位),不掃光', () => {
    const ds = stubSource({ placePhoto: undefined })
    const { result } = renderHook(() => usePlanningState({ cfg, dataSource: ds, tripID: 'trip_1' }))
    act(() => result.current.selectSearchResult(placeA))
    expect(result.current.infoContent?.photoStatus).toBeUndefined()
  })

})
