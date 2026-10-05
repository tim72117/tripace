import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GeoAttraction, GeoPlaceDetails } from '../api'
import { fetchPoiContent, useThemeAttractionSelection } from './useThemeAttractionSelection'

// useThemeAttractionSelection.test.ts——驗證這支 hook 要解決的核心問題:
// 主題卡切換(themeKey 變動)時,poiContent/hoveredAttraction/
// categoryFilter 三者都要一併清空(見該檔案開頭的完整說明:這是
// DesktopLayout.tsx/InteractiveExploreMap.tsx 兩邊原本各自手寫、容易漏寫其中
// 一個 reset 的部分),以及 openPoiContent 的查詢/fallback 流程。
function attraction(overrides: Partial<GeoAttraction> = {}): GeoAttraction {
  return { name: '忠僕茶屋', lat: 34.99, lng: 135.78, isTheme: false, ...overrides }
}

describe('useThemeAttractionSelection', () => {
  it('themeKey 變動時清空 poiContent/hoveredAttraction/categoryFilter', () => {
    const fetchPlaceDetails = vi.fn()
    const { result, rerender } = renderHook(
      ({ themeKey }) => useThemeAttractionSelection(themeKey, fetchPlaceDetails),
      { initialProps: { themeKey: '清水寺' } },
    )

    act(() => {
      result.current.setPoiContent({ name: '忠僕茶屋', badges: [] })
      result.current.setHoveredAttraction(attraction())
      result.current.setCategoryFilter('tea')
    })
    expect(result.current.poiContent).not.toBeNull()
    expect(result.current.hoveredAttraction).not.toBeNull()
    expect(result.current.categoryFilter).toBe('tea')

    rerender({ themeKey: '八坂神社' })

    expect(result.current.poiContent).toBeNull()
    expect(result.current.hoveredAttraction).toBeNull()
    expect(result.current.categoryFilter).toBeNull()
  })

  it('themeKey 是物件參照時,同一個物件重新傳入不觸發 reset(值不變)', () => {
    const fetchPlaceDetails = vi.fn()
    const theme = { name: '清水寺' }
    const { result, rerender } = renderHook(
      ({ themeKey }) => useThemeAttractionSelection(themeKey, fetchPlaceDetails),
      { initialProps: { themeKey: theme } },
    )

    act(() => {
      result.current.setHoveredAttraction(attraction())
    })
    expect(result.current.hoveredAttraction).not.toBeNull()

    // 同一個物件參照重新傳入(例如單純重新 render,不是真的換了主題)
    // ——不應該觸發 reset。
    rerender({ themeKey: theme })

    expect(result.current.hoveredAttraction).not.toBeNull()
  })

  it('themeKey 是物件參照時,重複點擊同一主題點(新物件、內容相同)仍會觸發 reset——這是 DesktopLayout.tsx 需要的行為:使用者重新點擊已開啟的主題點地標,要清空並存卡回到乾淨狀態', () => {
    const fetchPlaceDetails = vi.fn()
    const { result, rerender } = renderHook(
      ({ themeKey }) => useThemeAttractionSelection(themeKey, fetchPlaceDetails),
      { initialProps: { themeKey: { name: '清水寺' } } },
    )

    act(() => {
      result.current.setHoveredAttraction(attraction())
    })
    expect(result.current.hoveredAttraction).not.toBeNull()

    // geoSelection reducer 每次 SELECT_ATTRACTION 都會 dispatch 一個新
    // 物件,即使內容(name)相同——模擬使用者重新點擊同一個主題點地標。
    rerender({ themeKey: { name: '清水寺' } })

    expect(result.current.hoveredAttraction).toBeNull()
  })

  it('themeKey 是物件參照時,兩個不同地點但同名不會被誤判成同一個主題', () => {
    const fetchPlaceDetails = vi.fn()
    const themeA = { name: '城隍廟', lat: 25.0 }
    const themeB = { name: '城隍廟', lat: 22.6 }
    const { result, rerender } = renderHook(
      ({ themeKey }) => useThemeAttractionSelection(themeKey, fetchPlaceDetails),
      { initialProps: { themeKey: themeA } },
    )

    act(() => {
      result.current.setPoiContent({ name: 'A 附近的精選點', badges: [] })
    })
    expect(result.current.poiContent?.name).toBe('A 附近的精選點')

    // 換到同名但不同物件(不同地點)的主題點——即使 .name 相同,也要被
    // 視為換了一個主題,清空 A 底下殘留的 poiContent。
    rerender({ themeKey: themeB })

    expect(result.current.poiContent).toBeNull()
  })

  it('themeKey 變回 null(關閉主題卡)時同樣清空三者', () => {
    const fetchPlaceDetails = vi.fn()
    const { result, rerender } = renderHook(
      ({ themeKey }) => useThemeAttractionSelection(themeKey, fetchPlaceDetails),
      { initialProps: { themeKey: '清水寺' as string | null } },
    )

    act(() => {
      result.current.setHoveredAttraction(attraction())
    })
    expect(result.current.hoveredAttraction).not.toBeNull()

    rerender({ themeKey: null })

    expect(result.current.hoveredAttraction).toBeNull()
  })

  it('openPoiContent 有 placeId 時查 fetchPlaceDetails,成功後附加 attractionSummary', async () => {
    // googlePhotoUrls 給值,避免觸發 fetchPoiContent 的沒圖重試機制(見該
    // 函式 PHOTO_RETRY_* 的完整說明)——這個測試只關心 attractionSummary
    // 有沒有正確附加,不是在測重試,給張圖讓它第一次查詢就直接 resolve。
    const details: GeoPlaceDetails = {
      name: '忠僕茶屋',
      address: '清水寺境內',
      lat: 34.99,
      lng: 135.78,
      rating: 4.3,
      googlePhotoUrls: ['https://example.com/photo.jpg'],
    }
    const fetchPlaceDetails = vi.fn().mockResolvedValue(details)
    const { result } = renderHook(() => useThemeAttractionSelection('清水寺', fetchPlaceDetails))

    act(() => {
      result.current.openPoiContent(attraction({ placeId: 'ChIJ123', summary: '百年茶屋' }))
    })

    await waitFor(() => expect(result.current.poiContent).not.toBeNull())
    expect(fetchPlaceDetails).toHaveBeenCalledWith('ChIJ123')
    expect(result.current.poiContent?.attractionSummary).toBe('百年茶屋')
  })

  it('openPoiContent 查詢失敗時退回 attractionToInfoContent', async () => {
    const fetchPlaceDetails = vi.fn().mockRejectedValue(new Error('network error'))
    const { result } = renderHook(() => useThemeAttractionSelection('清水寺', fetchPlaceDetails))

    act(() => {
      result.current.openPoiContent(attraction({ placeId: 'ChIJ123' }))
    })

    await waitFor(() => expect(result.current.poiContent).not.toBeNull())
    expect(result.current.poiContent?.name).toBe('忠僕茶屋')
  })

  it('openPoiContent 沒有 placeId 時不查詢,直接用 attractionToInfoContent', async () => {
    const fetchPlaceDetails = vi.fn()
    const { result } = renderHook(() => useThemeAttractionSelection('清水寺', fetchPlaceDetails))

    act(() => {
      result.current.openPoiContent(attraction())
    })

    // fetchPoiContent 內部即使沒有 placeId 也是 Promise.resolve(...)
    // (見該函式的完整說明:統一回傳 Promise,不依賴 React state,讓
    // 有/沒有 placeId 兩條路徑對呼叫端而言是同一種非同步介面),故這裡
    // 仍要 await 一個微任務週期才能讀到更新後的 poiContent。
    await waitFor(() => expect(result.current.poiContent).not.toBeNull())
    expect(fetchPlaceDetails).not.toHaveBeenCalled()
    expect(result.current.poiContent?.name).toBe('忠僕茶屋')
  })

  it('infoCardStack 依 themeKey/poiContent 登記 attraction(0,exclusive)/nearbyPlace(1,stacked)', async () => {
    const fetchPlaceDetails = vi.fn()
    const { result } = renderHook(() => useThemeAttractionSelection('清水寺', fetchPlaceDetails))

    expect(result.current.infoCardStack.isPresent('attraction')).toBe(true)
    expect(result.current.infoCardStack.isPresent('nearbyPlace')).toBe(false)

    act(() => {
      result.current.openPoiContent(attraction())
    })

    await waitFor(() => expect(result.current.infoCardStack.isPresent('nearbyPlace')).toBe(true))
  })

  it('extraAttractionPresent 為 true 時,即使 themeKey 是 null,attraction 仍登記為 present——涵蓋呼叫端 geoInfoContent(PlacePanel)這個額外分支(見該參數的完整說明)', () => {
    const fetchPlaceDetails = vi.fn()
    const { result } = renderHook(
      ({ extra }) => useThemeAttractionSelection(null, fetchPlaceDetails, undefined, extra),
      { initialProps: { extra: false } },
    )

    expect(result.current.infoCardStack.isPresent('attraction')).toBe(false)

    const { result: result2 } = renderHook(() =>
      useThemeAttractionSelection(null, fetchPlaceDetails, undefined, true),
    )
    expect(result2.current.infoCardStack.isPresent('attraction')).toBe(true)
  })

  it('onAttractionPresent 只在 attraction 從不存在轉為存在時呼叫一次,不是每次重渲染都呼叫', () => {
    const fetchPlaceDetails = vi.fn()
    const onAttractionPresent = vi.fn()
    const { rerender } = renderHook(
      ({ themeKey }) => useThemeAttractionSelection(themeKey, fetchPlaceDetails, undefined, false, onAttractionPresent),
      { initialProps: { themeKey: null as string | null } },
    )

    expect(onAttractionPresent).not.toHaveBeenCalled()

    rerender({ themeKey: '清水寺' })
    expect(onAttractionPresent).toHaveBeenCalledTimes(1)

    // 同一個主題卡持續存在時重新 render,不應該重複觸發。
    rerender({ themeKey: '清水寺' })
    expect(onAttractionPresent).toHaveBeenCalledTimes(1)
  })
})

// fetchPoiContent——GeoOutlinePhoneView.tsx(手機版附近景點清單)直接
// 共用這支函式本身,不接整支 useThemeAttractionSelection(見該函式的
// 完整說明),故獨立驗證它的查詢/fallback 規則。
describe('fetchPoiContent', () => {
  it('有 placeId 時查 fetchPlaceDetails,成功後附加 attractionSummary', async () => {
    // googlePhotoUrls 給值,避免觸發沒圖時的重試機制(見下方「沒有任何
    // 照片時」那組測試)——這裡只關心 attractionSummary 有沒有附加。
    const details: GeoPlaceDetails = {
      name: '忠僕茶屋',
      address: '清水寺境內',
      lat: 34.99,
      lng: 135.78,
      rating: 4.3,
      googlePhotoUrls: ['https://example.com/photo.jpg'],
    }
    const fetchPlaceDetails = vi.fn().mockResolvedValue(details)

    const content = await fetchPoiContent(attraction({ placeId: 'ChIJ123', summary: '百年茶屋' }), fetchPlaceDetails)

    expect(fetchPlaceDetails).toHaveBeenCalledWith('ChIJ123')
    expect(content.attractionSummary).toBe('百年茶屋')
  })

  it('查詢失敗時退回 attractionToInfoContent', async () => {
    const fetchPlaceDetails = vi.fn().mockRejectedValue(new Error('network error'))

    const content = await fetchPoiContent(attraction({ placeId: 'ChIJ123' }), fetchPlaceDetails)

    expect(content.name).toBe('忠僕茶屋')
  })

  it('沒有 placeId 時不查詢,直接用 attractionToInfoContent', async () => {
    const fetchPlaceDetails = vi.fn()

    const content = await fetchPoiContent(attraction(), fetchPlaceDetails)

    expect(fetchPlaceDetails).not.toHaveBeenCalled()
    expect(content.name).toBe('忠僕茶屋')
  })

  // 沒有帶 fetchPhotoAssets 時,完全不重試——2026-09 使用者明確要求「重試
  // 時只能取圖,不能觸發補圖」,fetchPlaceDetails 對應的後端每次呼叫都會
  // 觸發點擊計數/漸進補圖決策,不是純讀,不能拿來當重試對象(見
  // fetchPoiContent 上方 PHOTO_RETRY_* 的完整說明)。
  it('沒有帶 fetchPhotoAssets 時,沒圖也不重試,只查一次 fetchPlaceDetails', async () => {
    const noPhoto: GeoPlaceDetails = { name: '忠僕茶屋', address: '清水寺境內', lat: 34.99, lng: 135.78 }
    const fetchPlaceDetails = vi.fn().mockResolvedValue(noPhoto)

    const content = await fetchPoiContent(attraction({ placeId: 'ChIJ123' }), fetchPlaceDetails)

    expect(fetchPlaceDetails).toHaveBeenCalledTimes(1)
    expect(content.googlePhotoUrls).toBeUndefined()
  })

  // 帶 fetchPhotoAssets 時的重試機制——後端漸進補圖是背景 goroutine,這次
  // 回應不保證帶圖(見 fetchPoiContent 上方 PHOTO_RETRY_* 的完整說明),
  // 故這裡用假的計時器驗證「每隔 2 秒重查一次、最多重試 3 次、查到圖就
  // 停止」的行為,且重試只呼叫 fetchPhotoAssets,不重複呼叫
  // fetchPlaceDetails。
  it('有 fetchPhotoAssets 時,沒圖每隔 2 秒重查一次,查到圖就停止重試,且不重複呼叫 fetchPlaceDetails', async () => {
    vi.useFakeTimers()
    try {
      const noPhoto: GeoPlaceDetails = { name: '忠僕茶屋', address: '清水寺境內', lat: 34.99, lng: 135.78 }
      const fetchPlaceDetails = vi.fn().mockResolvedValue(noPhoto)
      const fetchPhotoAssets = vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ googlePhotoUrls: ['https://example.com/photo.jpg'] })

      const onUpdate = vi.fn()
      const contentPromise = fetchPoiContent(
        attraction({ placeId: 'ChIJ123' }),
        fetchPlaceDetails,
        onUpdate,
        fetchPhotoAssets,
      )

      // 第一次查詢(同步 microtask,不需要推進計時器)——沒圖,立刻透過
      // onUpdate 顯示卡片(文字內容),不等重試。
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchPlaceDetails).toHaveBeenCalledTimes(1)
      expect(fetchPhotoAssets).not.toHaveBeenCalled()
      expect(onUpdate).toHaveBeenCalledTimes(1)
      expect(onUpdate.mock.calls[0][0].googlePhotoUrls).toBeUndefined()

      // 等滿 2 秒觸發第一次重試(改打 fetchPhotoAssets,不是 fetchPlaceDetails)。
      await vi.advanceTimersByTimeAsync(2000)
      expect(fetchPhotoAssets).toHaveBeenCalledTimes(1)
      expect(fetchPlaceDetails).toHaveBeenCalledTimes(1)

      // 仍沒圖,再等滿 2 秒觸發第二次重試,這次查到圖。
      await vi.advanceTimersByTimeAsync(2000)
      expect(fetchPhotoAssets).toHaveBeenCalledTimes(2)

      const content = await contentPromise
      expect(content.googlePhotoUrls).toEqual(['https://example.com/photo.jpg'])
      expect(onUpdate).toHaveBeenCalledTimes(2)
      // 查到圖後不應該再繼續重試,fetchPlaceDetails 全程只被呼叫一次。
      await vi.advanceTimersByTimeAsync(10000)
      expect(fetchPhotoAssets).toHaveBeenCalledTimes(2)
      expect(fetchPlaceDetails).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('重試 3 次後仍沒有照片,維持顯示無圖內容(不再繼續重試,不觸發第 4 次補圖查詢)', async () => {
    vi.useFakeTimers()
    try {
      const noPhoto: GeoPlaceDetails = { name: '忠僕茶屋', address: '清水寺境內', lat: 34.99, lng: 135.78 }
      const fetchPlaceDetails = vi.fn().mockResolvedValue(noPhoto)
      const fetchPhotoAssets = vi.fn().mockResolvedValue({})

      const contentPromise = fetchPoiContent(
        attraction({ placeId: 'ChIJ123' }),
        fetchPlaceDetails,
        undefined,
        fetchPhotoAssets,
      )

      await vi.runAllTimersAsync()

      const content = await contentPromise
      // 首次查詢一次(fetchPlaceDetails)+ 最多重試 3 次(fetchPhotoAssets)。
      expect(fetchPlaceDetails).toHaveBeenCalledTimes(1)
      expect(fetchPhotoAssets).toHaveBeenCalledTimes(3)
      expect(content.googlePhotoUrls).toBeUndefined()

      // 用完重試次數後不再繼續等待/查詢。
      await vi.advanceTimersByTimeAsync(10000)
      expect(fetchPhotoAssets).toHaveBeenCalledTimes(3)
      expect(fetchPlaceDetails).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('fetchPhotoAssets 單次查詢失敗時,視同這次沒查到圖,繼續剩餘重試次數', async () => {
    vi.useFakeTimers()
    try {
      const noPhoto: GeoPlaceDetails = { name: '忠僕茶屋', address: '清水寺境內', lat: 34.99, lng: 135.78 }
      const fetchPlaceDetails = vi.fn().mockResolvedValue(noPhoto)
      const fetchPhotoAssets = vi
        .fn()
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce({ googlePhotoUrls: ['https://example.com/photo.jpg'] })

      const contentPromise = fetchPoiContent(
        attraction({ placeId: 'ChIJ123' }),
        fetchPlaceDetails,
        undefined,
        fetchPhotoAssets,
      )

      await vi.runAllTimersAsync()
      const content = await contentPromise

      expect(fetchPhotoAssets).toHaveBeenCalledTimes(2)
      expect(content.googlePhotoUrls).toEqual(['https://example.com/photo.jpg'])
      expect(content.name).toBe('忠僕茶屋')
    } finally {
      vi.useRealTimers()
    }
  })
})
