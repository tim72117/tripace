import { useCallback, useEffect, useRef, useState } from 'react'
import type { GeoAttraction, GeoGeocodeCandidate } from '../api'
import { requireGeocode, type PlanAiDataSource } from '../home/plan-ai-sim/planAiDataSource'
import { initialAreaSearchState, reduceAreaSearchState, CATEGORY_QUERY_RADIUS_METERS, EXPLORE_CATEGORY, SEARCH_BOX_CATEGORY_LABELS, sameAttractionsContent, radiusForZoom } from './exploreQuery'
// useExploreQueries——PlanMap 的「查詢與搜尋區域狀態」,從元件原樣抽出(2026-10),不含任何
// UI。負責:
//   - 三份 state:attractions(自建景點區域)、areaSearch(「搜尋這個區域」按鈕的顯示/查詢中)、
//     activeCategory(目前選中的類別,只有探索標籤有選取態)
//   - 三個查詢入口:類別標籤(handleCategoryClick)、探索(同一個入口,類別為 EXPLORE_CATEGORY)、
//     搜尋這個區域(handleSearchThisArea)
//   - idle 與程式化平移之間的抑制旗標(handleMapIdle / suppressNextIdle)
//
// 查詢政策(2026-08 起):景點區域、類別標籤、「搜尋這個區域」三者統一都「按下才查」,地圖移動
// 本身只標記「這個範圍還沒查過」(handleMapIdle),不自動重打——地圖移動時不該無論查詢種類是否
// 計費都自動重打。suppressNextIdle:panTarget 造成的 idle 不是使用者主動拖曳探索新範圍,不該冒出
// 搜尋按鈕,由 usePanTarget 在平移前通知。
//
// 地圖中心與 zoom 在查詢當下才讀取(mapRef.current.getCenter()、zoom 參數),查詢政策是使用者操作
// 當下的畫面,不是建圖時的畫面。
export function useExploreQueries({
  mapRef,
  dataSource,
  zoom,
  city,
  exploreTrigger,
  initialAttractions,
  onSearchStart,
  onGeocodeCandidatesChange,
  onAttractionsChange,
  onCityChange,
  onActiveCategoryChange,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  // dataSource:資料存取層實例,「查附近景點區域」走 nearbyAttractionAreas(2026-10,使用者明確要求
  // 「光暈查詢共用」:/ai-plan 的 PlanMap 也用這個 hook,端點由實例決定);
  // 類別標籤的 Google 文字搜尋走 geocode。
  dataSource: PlanAiDataSource
  zoom: number
  city?: string
  exploreTrigger?: number
  initialAttractions?: GeoAttraction[]
  onSearchStart?: () => void
  onGeocodeCandidatesChange?: (candidates: GeoGeocodeCandidate[]) => void
  onAttractionsChange?: (attractions: GeoAttraction[]) => void
  onCityChange?: (city: string) => void
  onActiveCategoryChange?: (category: string | null) => void
}) {
  const [attractions, setAttractions] = useState<GeoAttraction[]>(() => initialAttractions ?? [])
  const [areaSearch, setAreaSearch] = useState(initialAreaSearchState)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const suppressNextIdleQueryRef = useRef(false)

  // 地圖 idle:標記「這個範圍還沒查過」。被抑制時消耗掉旗標、這次不標記。
  const handleMapIdle = useCallback(() => {
    if (suppressNextIdleQueryRef.current) {
      suppressNextIdleQueryRef.current = false
      return
    }
    setAreaSearch((s) => reduceAreaSearchState(s, { type: 'map-idle' }))
  }, [])

  const suppressNextIdle = useCallback(() => {
    suppressNextIdleQueryRef.current = true
  }, [])

  // placesQueryRequestIdRef:類別標籤連點、或標籤與「搜尋這個區域」交錯時,先發出的請求可能比後
  // 發出的晚回來。每次查詢遞增編號,回來時編號不是最新的就丟棄,避免舊結果蓋掉新結果。
  const placesQueryRequestIdRef = useRef(0)

  // runPlacesQuery:類別標籤與「搜尋這個區域」共用的 Google 文字搜尋。固定用 restrict 模式、
  // 目前地圖中心、固定半徑(不是查詢文字本身指涉的地點)。
  const runPlacesQuery = useCallback(
    (query: string, category?: string) => {
      if (!mapRef.current || !query.trim()) return
      const center = mapRef.current.getCenter()
      if (!center) return
      onSearchStart?.()
      const requestId = ++placesQueryRequestIdRef.current
      requireGeocode(dataSource, query, { lat: center.lat(), lng: center.lng() }, 'restrict', CATEGORY_QUERY_RADIUS_METERS)
        .then((result) => {
          if (requestId !== placesQueryRequestIdRef.current) return
          onGeocodeCandidatesChange?.(
            result.candidates.map((c) => ({
              name: c.name,
              address: c.address,
              lat: c.lat,
              lng: c.lng,
              category,
              placeId: c.placeId,
            })),
          )
          setAreaSearch((s) => reduceAreaSearchState(s, { type: 'query-succeeded' }))
        })
        .catch(() => {
          if (requestId !== placesQueryRequestIdRef.current) return
          setAreaSearch((s) => reduceAreaSearchState(s, { type: 'query-failed' }))
          onGeocodeCandidatesChange?.([])
        })
    },
    [dataSource, onGeocodeCandidatesChange, onSearchStart, mapRef],
  )

  // runExploreQuery:查目前地圖範圍內的自建景點區域(免費,只查自家資料庫)。半徑隨 zoom 放大,
  // 上限 50 公里。內容相同就沿用舊陣列參照,避免光暈整批重畫。
  const exploreRequestIdRef = useRef(0)
  const runExploreQuery = useCallback(() => {
    if (!mapRef.current) return
    const center = mapRef.current.getCenter()
    if (!center) return
    const radiusMeters = radiusForZoom(zoom)
    // 請求編號:取消(再點一次探索)或重新查詢之後,先發出的回應晚到要丟掉,否則已取消的景點會復活
    // (runPlacesQuery 早就有同樣的保護)。
    const requestId = ++exploreRequestIdRef.current
    const fetchAreas = dataSource.nearbyAttractionAreas
      ? dataSource.nearbyAttractionAreas(center.lat(), center.lng(), radiusMeters)
      : Promise.reject(new Error('這個資料存取層沒有實作 nearbyAttractionAreas'))
    fetchAreas
      .then((list) => {
        if (requestId !== exploreRequestIdRef.current) return
        setAttractions((prev) => (sameAttractionsContent(prev, list) ? prev : list))
        onAttractionsChange?.(list)
        setAreaSearch((s) => reduceAreaSearchState(s, { type: 'query-succeeded' }))
      })
      .catch(() => {
        if (requestId !== exploreRequestIdRef.current) return
        setAreaSearch((s) => reduceAreaSearchState(s, { type: 'query-failed' }))
      })
  }, [dataSource, zoom, onAttractionsChange, mapRef])

  // 類別標籤:景點/飯店/餐廳把標籤文字寫進搜尋框並走 Google 文字搜尋(沒有選取態,每次都查);
  // 探索是唯一保留「點下去查、再點一次取消」選取態的標籤,查的是自建景點區域。
  const handleCategoryClick = useCallback(
    (type: string) => {
      if (!mapRef.current) return
      const searchBoxLabel = SEARCH_BOX_CATEGORY_LABELS[type]
      if (searchBoxLabel) {
        onCityChange?.(searchBoxLabel)
        runPlacesQuery(searchBoxLabel, type)
        return
      }
      if (activeCategory === type) {
        exploreRequestIdRef.current++
        setActiveCategory(null)
        onActiveCategoryChange?.(null)
        setAttractions([])
        onAttractionsChange?.([])
        return
      }
      setActiveCategory(type)
      onActiveCategoryChange?.(type)
      runExploreQuery()
    },
    [activeCategory, onActiveCategoryChange, runExploreQuery, runPlacesQuery, onAttractionsChange, onCityChange, mapRef],
  )

  // exploreTrigger:外部(手機版底部功能列的「探索」按鈕)遞增它,等同點一次探索標籤。用 ref 讀最新的
  // handleCategoryClick,effect 只依賴 exploreTrigger 本身;為 0(未觸發)時不做事。
  const handleCategoryClickRef = useRef(handleCategoryClick)
  handleCategoryClickRef.current = handleCategoryClick
  useEffect(() => {
    if (!exploreTrigger) return
    handleCategoryClickRef.current(EXPLORE_CATEGORY)
  }, [exploreTrigger])

  // 「搜尋這個區域」:身兼兩種查詢的重新觸發入口——沿用搜尋框文字重查 Google 文字搜尋(文字剛好是
  // 類別標籤時帶回該類別)、或重查景點區域(目前選中探索時)。
  const handleSearchThisArea = useCallback(() => {
    setAreaSearch((s) => reduceAreaSearchState(s, { type: 'search-pressed' }))
    if (activeCategory === EXPLORE_CATEGORY) {
      runExploreQuery()
    }
    const trimmedCity = (city ?? '').trim()
    if (!trimmedCity) return
    const matchedCategory = Object.entries(SEARCH_BOX_CATEGORY_LABELS).find(([, label]) => label === trimmedCity)?.[0]
    runPlacesQuery(trimmedCity, matchedCategory)
  }, [activeCategory, runExploreQuery, runPlacesQuery, city])

  return {
    attractions,
    areaSearch,
    activeCategory,
    handleCategoryClick,
    handleSearchThisArea,
    handleMapIdle,
    suppressNextIdle,
  }
}
