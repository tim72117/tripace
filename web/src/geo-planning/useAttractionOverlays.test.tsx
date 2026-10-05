// useAttractionOverlays——直接用 renderHook 隔離測試這個 hook 自己的
// orchestration 邏輯(哪些景點區域該顯示、overlay 何時重建 vs 只更新既有
// 實例、點擊回呼),不透過完整的 ExploreMap 掛載(那樣的整合測試成本高
// 很多,且會混進地圖建圖/查詢等不相關邏輯,見 ExploreMap.poiClick.test.tsx
// 開頭的說明,選擇的是另一種取捨)。
//
// mock ./geoAttractionOverlay 的 getAttractionOverlayClass,回傳一個純
// 記錄用的 FakeOverlay class,不觸碰真正的 Google Maps OverlayView/DOM
// markup——那是 geoAttractionOverlay.ts 自己的職責,不在這個測試範圍內。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAttractionOverlays } from './useAttractionOverlays'
import { clearPlaceDetailsCacheForTests } from './placeDetailsCache'
import type { ClientConfig, GeoAttraction, GeoPlaceDetails } from '../api'

type FakeOverlayCall = {
  attraction: GeoAttraction
  position: { lat: number; lng: number }
  selected: boolean
  candidate: boolean
  onClick: (attraction: GeoAttraction) => void
}

let constructedOverlays: FakeOverlayCall[] = []
let overlayInstances: FakeOverlay[] = []

class FakeOverlay {
  setMapCalls: (google.maps.Map | null)[] = []
  selectedHistory: boolean[] = []
  candidateHistory: boolean[] = []
  hoveredHistory: boolean[] = []
  photoUrlsHistory: (string[] | undefined)[] = []
  hiddenHistory: boolean[] = []
  constructor(
    public attraction: GeoAttraction,
    position: { lat: number; lng: number },
    selected: boolean,
    candidate: boolean,
    public onClick: (attraction: GeoAttraction) => void,
  ) {
    constructedOverlays.push({ attraction, position, selected, candidate, onClick })
    overlayInstances.push(this)
  }
  setMap(map: google.maps.Map | null) {
    this.setMapCalls.push(map)
  }
  setSelected(selected: boolean) {
    this.selectedHistory.push(selected)
  }
  setCandidate(candidate: boolean) {
    this.candidateHistory.push(candidate)
  }
  setHovered(hovered: boolean) {
    this.hoveredHistory.push(hovered)
  }
  // setPhotoUrls:AttractionOverlayInstance 介面要求的方法(見
  // geoAttractionOverlay.ts 的完整說明),先前這個 FakeOverlay 沒有實作
  // 這個方法——任何一個測試若傳入 cfg 觸發照片查詢 effect,呼叫
  // overlay.setPhotoUrls(...) 就會直接拋出執行期錯誤(不是編譯期,因為
  // FakeOverlay 只是結構性地被當成 AttractionOverlayInstance 使用,沒有
  // 靜態型別檢查會擋下這個缺漏)。補上這個方法,讓下方新增的照片查詢
  // effect 測試組能真正跑起來。2026-10 改成接收完整的 googlePhotoUrls
  // 清單(取代原本單一 photoUrl 字串),對齊 geoAttractionOverlay.ts 的
  // 介面變動。
  setPhotoUrls(photoUrls: string[] | undefined) {
    this.photoUrlsHistory.push(photoUrls)
  }
  // setHidden:比照上方 setPhotoUrls 的說明,AttractionOverlayInstance
  // 介面要求的方法,缺漏會在呼叫 hiddenAttractionName 同步 effect 時
  // 直接拋出執行期錯誤。hiddenState 真的記住最新值(不只是歷史記錄)
  // ,供 isHidden() 回報——resolveLabelCollisions 會呼叫 isHidden() 排除
  // 已經 setHidden(true) 收起的 overlay,若這裡固定回傳 false,無法驗證
  // 該排除邏輯是否真的生效。
  hiddenState = false
  setHidden(hidden: boolean) {
    this.hiddenState = hidden
    this.hiddenHistory.push(hidden)
  }
  isHidden() {
    return this.hiddenState
  }
  // setLabelHidden/getLabelEl/getVisualEl/getLabelPriority:
  // AttractionOverlayInstance 介面要求的方法(標籤避讓機制用,見
  // geoAttractionOverlay.ts 的完整說明)——getLabelEl/getVisualEl 固定
  // 回傳 null(這個 FakeOverlay 不建立真正的 DOM,resolveLabelCollisions
  // 遇到 null 會直接略過,不會對這個 fake 實例做任何碰撞判斷,不影響這份
  // 測試既有的斷言)。
  labelHiddenHistory: boolean[] = []
  setLabelHidden(hidden: boolean) {
    this.labelHiddenHistory.push(hidden)
  }
  getLabelEl() {
    return null
  }
  getVisualEl() {
    return null
  }
  getLabelPriority() {
    return 0
  }
}

vi.mock('./geoAttractionOverlay', () => ({
  getAttractionOverlayClass: () => FakeOverlay,
}))

const fetchGeoPlaceDetailsMock = vi.fn<(...args: unknown[]) => Promise<GeoPlaceDetails>>()
const fetchPublicGeoPlaceDetailsMock = vi.fn<(...args: unknown[]) => Promise<GeoPlaceDetails>>()
// fetchGeoPlacePhotoAssetsMock/fetchPublicGeoPlacePhotoAssetsMock:2026-10
// 新增,供主題點(isTheme===true)的照片查詢重試機制使用(見
// useAttractionOverlays.ts 查詢 effect 的完整說明——只有主題點會套用
// fetchPlaceDetailsWithPhotoRetry,精選點不帶 fetchPhotoAssets,不會呼叫
// 這兩支 mock)。
const fetchGeoPlacePhotoAssetsMock = vi.fn<(...args: unknown[]) => Promise<{ googlePhotoUrls?: string[] }>>()
const fetchPublicGeoPlacePhotoAssetsMock = vi.fn<(...args: unknown[]) => Promise<{ googlePhotoUrls?: string[] }>>()

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchGeoPlaceDetails: (...args: unknown[]) => fetchGeoPlaceDetailsMock(...args),
    fetchPublicGeoPlaceDetails: (...args: unknown[]) => fetchPublicGeoPlaceDetailsMock(...args),
    fetchGeoPlacePhotoAssets: (...args: unknown[]) => fetchGeoPlacePhotoAssetsMock(...args),
    fetchPublicGeoPlacePhotoAssets: (...args: unknown[]) => fetchPublicGeoPlacePhotoAssetsMock(...args),
  }
})

const fakeCfg = {} as ClientConfig

// global.google.maps:hook 內用 new google.maps.LatLng(...)組座標——這裡
// 補最小可用假實作。
;(globalThis as { google?: unknown }).google = {
  maps: {
    LatLng: class {
      constructor(public lat: number, public lng: number) {}
    },
  },
}

// FakeMap:hook 本身不需要用到地圖實例的大多數方法(見 mapRef 型別要求),
// 但 2026-10 新增的標籤避讓機制(resolveLabelCollisions)會呼叫
// map.addListener('idle'/'bounds_changed'/'zoom_changed', ...)——補一個
// 最小可用的假實作,回傳帶 remove() 的物件(對齊 google.maps.MapsEventListener
// 的介面,effect cleanup 會呼叫它),不實際觸發任何回呼(這份測試不驗證
// 標籤避讓行為本身,只需要讓這個新 effect 不拋錯即可)。
function makeFakeMap(): google.maps.Map {
  return {
    addListener: () => ({ remove: () => {} }),
  } as unknown as google.maps.Map
}

function attraction(overrides: Partial<GeoAttraction> & { name: string; lat: number; lng: number }): GeoAttraction {
  return { isTheme: false, ...overrides }
}

beforeEach(() => {
  constructedOverlays = []
  overlayInstances = []
  fetchGeoPlaceDetailsMock.mockReset()
  fetchPublicGeoPlaceDetailsMock.mockReset()
  fetchGeoPlacePhotoAssetsMock.mockReset()
  fetchPublicGeoPlacePhotoAssetsMock.mockReset()
  // 2026-10:查詢地標照片改走 placeDetailsCache.ts 的模組級共用快取(見
  // 該模組開頭的完整說明)——不清空的話,不同測試案例若用了相同的
  // placeId(測試資料常重複使用同一組假字串),後面的測試會誤判成
  // 「已經快取,不會呼叫 mock」,實際上是拿到前一個測試殘留的結果。
  clearPlaceDetailsCacheForTests()
})

describe('useAttractionOverlays — filteredAttractions 分級規則', () => {
  it('level 為 undefined(即時查 Google Places 結果)一律顯示,不受 revealedAttractionNames 限制', () => {
    const mapRef = { current: makeFakeMap() }
    const live = attraction({ name: '即時結果', lat: 1, lng: 1, isTheme: false, level: undefined })
    renderHook(() =>
      useAttractionOverlays({
        mapRef,
        mapReady: true,
        attractions: [live],
        revealedAttractionNames: new Set(),
      }),
    )
    expect(constructedOverlays.map((c) => c.attraction.name)).toEqual(['即時結果'])
  })

  it('isTheme=true(主題點)恆顯示,不受 revealedAttractionNames 限制', () => {
    const mapRef = { current: makeFakeMap() }
    const theme = attraction({ name: '清水寺', lat: 1, lng: 1, isTheme: true, level: 1 })
    renderHook(() =>
      useAttractionOverlays({
        mapRef,
        mapReady: true,
        attractions: [theme],
        revealedAttractionNames: new Set(),
      }),
    )
    expect(constructedOverlays.map((c) => c.attraction.name)).toEqual(['清水寺'])
  })

  it('isTheme=false 且有 level(精選點):只有在 revealedAttractionNames 裡才顯示', () => {
    const mapRef = { current: makeFakeMap() }
    const revealed = attraction({ name: '二年坂', lat: 1, lng: 1, isTheme: false, level: 2 })
    const notRevealed = attraction({ name: '未揭露景點', lat: 2, lng: 2, isTheme: false, level: 2 })
    renderHook(() =>
      useAttractionOverlays({
        mapRef,
        mapReady: true,
        attractions: [revealed, notRevealed],
        revealedAttractionNames: new Set(['二年坂']),
      }),
    )
    expect(constructedOverlays.map((c) => c.attraction.name)).toEqual(['二年坂'])
  })

  it('revealedAttractionNames 為 undefined/null 時,精選點一律不顯示(主題點不受影響)', () => {
    const mapRef = { current: makeFakeMap() }
    const theme = attraction({ name: '八坂神社', lat: 1, lng: 1, isTheme: true, level: 1 })
    const curated = attraction({ name: '圓山公園', lat: 2, lng: 2, isTheme: false, level: 2 })
    renderHook(() =>
      useAttractionOverlays({
        mapRef,
        mapReady: true,
        attractions: [theme, curated],
        revealedAttractionNames: undefined,
      }),
    )
    expect(constructedOverlays.map((c) => c.attraction.name)).toEqual(['八坂神社'])
  })
})

describe('useAttractionOverlays — overlay 生命週期', () => {
  it('mapReady=false 時不建立任何 overlay', () => {
    const mapRef = { current: makeFakeMap() }
    renderHook(() =>
      useAttractionOverlays({
        mapRef,
        mapReady: false,
        attractions: [attraction({ name: 'A', lat: 1, lng: 1, isTheme: true })],
      }),
    )
    expect(constructedOverlays).toHaveLength(0)
  })

  it('mapRef.current 為 null 時不建立任何 overlay', () => {
    const mapRef = { current: null }
    renderHook(() =>
      useAttractionOverlays({
        mapRef,
        mapReady: true,
        attractions: [attraction({ name: 'A', lat: 1, lng: 1, isTheme: true })],
      }),
    )
    expect(constructedOverlays).toHaveLength(0)
  })

  it('filteredAttractions 變動時,重建整批 overlay(先清舊的 setMap(null),再建新的)', () => {
    const mapRef = { current: makeFakeMap() }
    const a = attraction({ name: 'A', lat: 1, lng: 1, isTheme: true })
    const b = attraction({ name: 'B', lat: 2, lng: 2, isTheme: true })
    const { rerender } = renderHook(
      ({ attractions }: { attractions: GeoAttraction[] }) =>
        useAttractionOverlays({ mapRef, mapReady: true, attractions }),
      { initialProps: { attractions: [a] } },
    )
    expect(constructedOverlays.map((c) => c.attraction.name)).toEqual(['A'])
    const firstOverlay = overlayInstances[0]

    rerender({ attractions: [a, b] })

    // 舊的那顆(A)在重建前應該被 setMap(null)清掉一次
    expect(firstOverlay.setMapCalls).toContain(null)
    // 重建後總共呼叫過 3 次建構子(第一輪 A、第二輪 A+B)
    expect(constructedOverlays).toHaveLength(3)
    expect(constructedOverlays.slice(1).map((c) => c.attraction.name)).toEqual(['A', 'B'])
  })

  it('點擊 overlay(觸發建構時傳入的 onClick)會呼叫 onAttractionSelect', () => {
    const mapRef = { current: makeFakeMap() }
    const onAttractionSelect = vi.fn()
    const a = attraction({ name: 'A', lat: 1, lng: 1, isTheme: true })
    renderHook(() =>
      useAttractionOverlays({ mapRef, mapReady: true, attractions: [a], onAttractionSelect }),
    )
    constructedOverlays[0].onClick(a)
    expect(onAttractionSelect).toHaveBeenCalledWith(a)
  })
})

describe('useAttractionOverlays — 選取/候選籃/hover 狀態只更新既有實例,不重建 DOM', () => {
  it('selectedKey/hoverKey 變動時呼叫既有 overlay 的 setSelected,不觸發重建', () => {
    const mapRef = { current: makeFakeMap() }
    const a = attraction({ name: 'A', lat: 1, lng: 1, isTheme: true })
    // attractions 陣列參照提到 renderHook 呼叫之外、固定不變——若在
    // render callback 內直接寫 `attractions: [a]`,每次 rerender 都會
    // 是新的陣列參照,filteredAttractions 的 useMemo 會誤判資料真的變了
    // 而觸發整批重建,蓋掉這裡真正要驗證的「只更新既有實例」路徑。
    const attractions = [a]
    const { rerender } = renderHook(
      ({ selectedKey }: { selectedKey?: string | null }) =>
        useAttractionOverlays({ mapRef, mapReady: true, attractions, selectedKey }),
      { initialProps: { selectedKey: undefined as string | null | undefined } },
    )
    const overlay = overlayInstances[0]
    const constructCountBefore = constructedOverlays.length

    rerender({ selectedKey: 'attraction:A:1:1' })

    expect(overlay.selectedHistory).toContain(true)
    // 沒有新的建構呼叫(重建只發生在 filteredAttractions 變動時)
    expect(constructedOverlays).toHaveLength(constructCountBefore)
  })

  it('candidateKeys 變動時呼叫既有 overlay 的 setCandidate,不觸發重建', () => {
    const mapRef = { current: makeFakeMap() }
    const a = attraction({ name: 'A', lat: 1, lng: 1, isTheme: true })
    const attractions = [a]
    const { rerender } = renderHook(
      ({ candidateKeys }: { candidateKeys?: Set<string> }) =>
        useAttractionOverlays({ mapRef, mapReady: true, attractions, candidateKeys }),
      { initialProps: { candidateKeys: undefined as Set<string> | undefined } },
    )
    const overlay = overlayInstances[0]
    const constructCountBefore = constructedOverlays.length

    rerender({ candidateKeys: new Set(['attraction:A:1:1']) })

    expect(overlay.candidateHistory).toContain(true)
    expect(constructedOverlays).toHaveLength(constructCountBefore)
  })

  it('hoveredCuratedId 變動時呼叫既有 overlay 的 setHovered,不觸發重建', () => {
    const mapRef = { current: makeFakeMap() }
    const a = attraction({ id: 'lmk_nenzaka', name: '二年坂', lat: 1, lng: 1, isTheme: false, level: 2 })
    const attractions = [a]
    // revealedAttractionNames 同理也要提到外層固定——它也是
    // filteredAttractions useMemo 的依賴之一。
    const revealedAttractionNames = new Set(['二年坂'])
    const { rerender } = renderHook(
      ({ hoveredCuratedId }: { hoveredCuratedId?: string | null }) =>
        useAttractionOverlays({
          mapRef,
          mapReady: true,
          attractions,
          revealedAttractionNames,
          hoveredCuratedId,
        }),
      { initialProps: { hoveredCuratedId: undefined as string | null | undefined } },
    )
    const overlay = overlayInstances[0]
    const constructCountBefore = constructedOverlays.length

    rerender({ hoveredCuratedId: 'lmk_nenzaka' })

    expect(overlay.hoveredHistory).toContain(true)
    expect(constructedOverlays).toHaveLength(constructCountBefore)
  })
})

// 查詢地圖上地標圖示的實際照片(見 hook 內該 useEffect 的完整說明)——
// 2026-09 新增,使用者明確要求「不再使用 landmarkPhotoUrl,如果有
// place id 則使用 photo_assets 第一張圖」。這裡驗證的重點放在觸發條件
// (沒有 cfg/沒有 placeId 時完全不查詢)、cfg/usePublicPlaceDetails 切換
// 對應到哪支 fetch 函式、查到結果後正確呼叫 setPhotoUrls、快取避免重複
// 查詢、以及查詢失敗時靜默處理(不拋錯、不快取失敗結果)。2026-10 改成
// mock 回應帶 googlePhotoUrls 清單(取代原本只帶單一 photoUrl 字串),
// 對齊 overlay 判斷「有沒有圖」改用清單長度而非 photoUrl 真假值的變動
// (見 geoAttractionOverlay.ts 的完整說明)。
describe('useAttractionOverlays — 查詢地標圖示照片(cfg/usePublicPlaceDetails)', () => {
  it('沒有傳入 cfg 時,完全不查詢照片(即使景點有 placeId)', async () => {
    const mapRef = { current: makeFakeMap() }
    const a = attraction({ name: 'A', lat: 1, lng: 1, isTheme: true, placeId: 'place-1' })
    renderHook(() =>
      useAttractionOverlays({ mapRef, mapReady: true, attractions: [a] }),
    )

    await Promise.resolve()
    expect(fetchGeoPlaceDetailsMock).not.toHaveBeenCalled()
    expect(fetchPublicGeoPlaceDetailsMock).not.toHaveBeenCalled()
  })

  it('景點沒有 placeId 時,跳過查詢,overlay 維持沒有照片', async () => {
    const mapRef = { current: makeFakeMap() }
    const a = attraction({ name: 'A', lat: 1, lng: 1, isTheme: true })
    renderHook(() =>
      useAttractionOverlays({ mapRef, mapReady: true, attractions: [a], cfg: fakeCfg }),
    )

    await Promise.resolve()
    expect(fetchGeoPlaceDetailsMock).not.toHaveBeenCalled()
    expect(overlayInstances[0].photoUrlsHistory).toHaveLength(0)
  })

  it('usePublicPlaceDetails 未傳(預設 false)時,打 fetchGeoPlaceDetails(登入版端點)', async () => {
    fetchGeoPlaceDetailsMock.mockResolvedValue({
      name: 'A', address: '', lat: 1, lng: 1, googlePhotoUrls: ['https://example.com/a.jpg'],
    })
    const mapRef = { current: makeFakeMap() }
    const a = attraction({ name: 'A', lat: 1, lng: 1, isTheme: true, placeId: 'place-1' })
    renderHook(() =>
      useAttractionOverlays({ mapRef, mapReady: true, attractions: [a], cfg: fakeCfg }),
    )

    await waitFor(() => expect(overlayInstances[0].photoUrlsHistory).toContainEqual(['https://example.com/a.jpg']))
    expect(fetchGeoPlaceDetailsMock).toHaveBeenCalledWith(fakeCfg, 'place-1')
    expect(fetchPublicGeoPlaceDetailsMock).not.toHaveBeenCalled()
  })

  it('usePublicPlaceDetails=true 時,改打 fetchPublicGeoPlaceDetails(免登入版端點)', async () => {
    fetchPublicGeoPlaceDetailsMock.mockResolvedValue({
      name: 'A', address: '', lat: 1, lng: 1, googlePhotoUrls: ['https://example.com/a.jpg'],
    })
    const mapRef = { current: makeFakeMap() }
    const a = attraction({ name: 'A', lat: 1, lng: 1, isTheme: true, placeId: 'place-1' })
    renderHook(() =>
      useAttractionOverlays({
        mapRef, mapReady: true, attractions: [a], cfg: fakeCfg, usePublicPlaceDetails: true,
      }),
    )

    await waitFor(() => expect(overlayInstances[0].photoUrlsHistory).toContainEqual(['https://example.com/a.jpg']))
    expect(fetchPublicGeoPlaceDetailsMock).toHaveBeenCalledWith(fakeCfg, 'place-1')
    expect(fetchGeoPlaceDetailsMock).not.toHaveBeenCalled()
  })

  it('同一個 placeId 查過一次後寫入快取,重新渲染(例如 selectedKey 變動)不重複查詢', async () => {
    fetchGeoPlaceDetailsMock.mockResolvedValue({
      name: 'A', address: '', lat: 1, lng: 1, googlePhotoUrls: ['https://example.com/a.jpg'],
    })
    const mapRef = { current: makeFakeMap() }
    const a = attraction({ name: 'A', lat: 1, lng: 1, isTheme: true, placeId: 'place-1' })
    const attractions = [a]
    const { rerender } = renderHook(
      ({ selectedKey }: { selectedKey?: string | null }) =>
        useAttractionOverlays({ mapRef, mapReady: true, attractions, cfg: fakeCfg, selectedKey }),
      { initialProps: { selectedKey: undefined as string | null | undefined } },
    )
    await waitFor(() => expect(fetchGeoPlaceDetailsMock).toHaveBeenCalledTimes(1))

    // filteredAttractions 沒有變(同一個陣列參照),但 selectedKey 變動會
    // 觸發這個 hook 重新 render——照片查詢 effect 的依賴陣列雖然包含
    // filteredAttractions(參照不變不會重新觸發整個 effect),這裡改用
    // 直接呼叫 rerender 兩次確認快取真的生效,不是依賴 effect 沒有重新
    // 執行這個間接證據。
    rerender({ selectedKey: 'attraction:A:1:1' })
    await Promise.resolve()

    expect(fetchGeoPlaceDetailsMock).toHaveBeenCalledTimes(1)
  })

  it('查詢失敗時,靜默處理(overlay 維持沒有照片,不拋出未捕捉的 rejection)', async () => {
    fetchGeoPlaceDetailsMock.mockRejectedValue(new Error('network error'))
    const mapRef = { current: makeFakeMap() }
    const a = attraction({ name: 'A', lat: 1, lng: 1, isTheme: true, placeId: 'place-1' })
    renderHook(() =>
      useAttractionOverlays({ mapRef, mapReady: true, attractions: [a], cfg: fakeCfg }),
    )

    await waitFor(() => expect(fetchGeoPlaceDetailsMock).toHaveBeenCalledTimes(1))
    // 沒有拋出的話這裡會自然往下走;額外確認 overlay 沒有被誤呼叫
    // setPhotoUrls(undefined 以外的值都不該出現)。
    expect(overlayInstances[0].photoUrlsHistory).toHaveLength(0)
  })

  it('多個景點各自查詢自己的 placeId,互不干擾', async () => {
    fetchGeoPlaceDetailsMock.mockImplementation((...args: unknown[]) => {
      const placeId = args[1] as string
      return Promise.resolve({ name: placeId, address: '', lat: 1, lng: 1, googlePhotoUrls: [`https://example.com/${placeId}.jpg`] })
    })
    const mapRef = { current: makeFakeMap() }
    const a = attraction({ name: 'A', lat: 1, lng: 1, isTheme: true, placeId: 'place-a' })
    const b = attraction({ name: 'B', lat: 2, lng: 2, isTheme: true, placeId: 'place-b' })
    renderHook(() =>
      useAttractionOverlays({ mapRef, mapReady: true, attractions: [a, b], cfg: fakeCfg }),
    )

    await waitFor(() => {
      expect(overlayInstances[0].photoUrlsHistory).toContainEqual(['https://example.com/place-a.jpg'])
      expect(overlayInstances[1].photoUrlsHistory).toContainEqual(['https://example.com/place-b.jpg'])
    })
  })

  // 2026-10 使用者明確要求:主題點(isTheme===true)查無照片時,改套用跟
  // AttractionInfoPanel.tsx/fetchPoiContent 一致的主動重試機制(見查詢
  // effect 開頭的完整說明)——精選點刻意不套用,維持查一次、失敗/查無圖
  // 就靜默的既有行為,避免揭露一整批精選點時疊加大量背景重試。
  it('主題點查無照片時,改用 fetchGeoPlacePhotoAssets 主動重試,查到圖後停止', async () => {
    vi.useFakeTimers()
    try {
      fetchGeoPlaceDetailsMock.mockResolvedValue({
        name: 'A', address: '', lat: 1, lng: 1, googlePhotoUrls: [],
      })
      fetchGeoPlacePhotoAssetsMock
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ googlePhotoUrls: ['https://example.com/theme.jpg'] })

      const mapRef = { current: makeFakeMap() }
      const a = attraction({ name: 'A', lat: 1, lng: 1, isTheme: true, placeId: 'place-theme' })
      renderHook(() =>
        useAttractionOverlays({ mapRef, mapReady: true, attractions: [a], cfg: fakeCfg }),
      )

      await vi.advanceTimersByTimeAsync(0)
      expect(fetchGeoPlaceDetailsMock).toHaveBeenCalledTimes(1)
      expect(fetchGeoPlacePhotoAssetsMock).not.toHaveBeenCalled()
      expect(overlayInstances[0].photoUrlsHistory).toContainEqual([])

      // 等滿重試延遲,第一次重試仍沒圖。
      await vi.advanceTimersByTimeAsync(2000)
      expect(fetchGeoPlacePhotoAssetsMock).toHaveBeenCalledTimes(1)

      // 第二次重試查到圖。
      await vi.advanceTimersByTimeAsync(2000)
      expect(fetchGeoPlacePhotoAssetsMock).toHaveBeenCalledTimes(2)
      expect(overlayInstances[0].photoUrlsHistory).toContainEqual(['https://example.com/theme.jpg'])

      // 查到圖後不再繼續重試,fetchGeoPlaceDetails 全程只查一次。
      await vi.advanceTimersByTimeAsync(10000)
      expect(fetchGeoPlacePhotoAssetsMock).toHaveBeenCalledTimes(2)
      expect(fetchGeoPlaceDetailsMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('精選點(isTheme=false)查無照片時,不會呼叫 fetchGeoPlacePhotoAssets 重試', async () => {
    vi.useFakeTimers()
    try {
      fetchGeoPlaceDetailsMock.mockResolvedValue({
        name: 'B', address: '', lat: 2, lng: 2, googlePhotoUrls: [],
      })

      const mapRef = { current: makeFakeMap() }
      const b = attraction({ name: 'B', lat: 2, lng: 2, isTheme: false, placeId: 'place-curated' })
      renderHook(() =>
        useAttractionOverlays({ mapRef, mapReady: true, attractions: [b], cfg: fakeCfg }),
      )

      await vi.advanceTimersByTimeAsync(0)
      expect(fetchGeoPlaceDetailsMock).toHaveBeenCalledTimes(1)
      expect(overlayInstances[0].photoUrlsHistory).toContainEqual([])

      // 精選點沒有 fetchPhotoAssets,即使時間經過也不該觸發任何重試查詢。
      await vi.advanceTimersByTimeAsync(10000)
      expect(fetchGeoPlacePhotoAssetsMock).not.toHaveBeenCalled()
      expect(fetchGeoPlaceDetailsMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
