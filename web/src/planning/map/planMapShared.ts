import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStableCallback } from '../../hooks/useStableCallback'
import type { MapHandle } from './NativeMapBase'
import type { ResolvedTheme } from '../../theme'
import {
  useSharedDrawLayer,
  type AttractionGlowInput,
  type SearchResultsInput,
  type TripEntriesInput,
} from './draw/useSharedDrawLayer'
import type { LatLng } from './draw/types'
import type { RouteLineSegment } from './draw/layers/routeLineLayer'
import type { GeoSearchResult } from '../../api'
import { itemKey } from '../explore/selectedKey'
import type { AskMapView } from '../conversation/askMapView'
import type { HoverTransitPair } from './marker/planStops'
import type { PlanStopMarker } from './marker/planStops'

// planMapShared——兩邊的 PlanMap(/ai-plan 的 planning/preview/PlanMap、登入後的 planning/map/PlanMap)
// 共用的內部接線。兩份 PlanMap 原本各自寫了:接住 NativeMapBase 的 MapHandle、把 prop 轉成統一繪製層
// (useSharedDrawLayer)的輸入,內容幾乎一樣,現在收在這裡。
// 兩份 PlanMap 共用的只有這一層 props 轉換與 MapHandle 接線,其餘行為(查詢、事件、安全區等)各自實作。
//
// 兩邊 PlanMap 對外共同的 prop(名稱與語意一致,見 PlanMapSharedProps)也定義在這裡。

const INITIAL_MAP_HANDLE: MapHandle = { mapRef: { current: null }, mapReady: false, mapVersion: 0 }

// useMapHandle——接住 NativeMapBase 回報的 MapHandle。
//
// 回傳一個「身分不變的本地 mapRef」:許多 useCallback/useEffect 沒把 mapRef 列入依賴,直接用
// handle.mapRef(交接前是佔位物件)會捕獲到永遠是 null 的值,所以在 handle 回報時把內容同步進本地
// ref;地圖因主題等原因重建(新實例、mapVersion 加 1)時再同步一次,ref 物件本身不變。
// handleChange 身分穩定,呼叫端每次渲染傳新的 onHandleChange 也不會讓 NativeMapBase 重新觸發。
export function useMapHandle(onHandleChange?: (handle: MapHandle) => void) {
  const [handle, setHandle] = useState<MapHandle>(INITIAL_MAP_HANDLE)
  const mapRef = useRef<google.maps.Map | null>(null)
  const handleChange = useStableCallback((h: MapHandle) => {
    mapRef.current = h.mapRef.current
    setHandle(h)
    onHandleChange?.(h)
  })
  return {
    handle,
    mapRef,
    mapReady: handle.mapReady,
    mapVersion: handle.mapVersion,
    error: handle.error ?? null,
    handleChange,
  }
}

// 兩邊 PlanMap 共同的 prop。站點的選取與 hover 完全由呼叫端持有(受控),地圖只依狀態畫,點圓點時用
// onStopClick 回報。
export interface PlanMapSharedProps {
  // initialCenter——建圖用的初始中心,三份 PlanMap 同一個名字、同一種語意(登入後的 planning/map/PlanMap 自己宣告同名 prop):
  //   - undefined:呼叫端還在決定(例如登入後在查旅程有沒有既有地點),地圖先不建;
  //   - null:沒有可用座標,退回預設起點(mapCenter.ts 的 DEFAULT_MAP_CENTER);
  //   - 座標:直接使用。
  // 都經 resolveMapCenter 轉成 NativeMapBase 吃的 center(只接受座標或 undefined)。初始中心由各入口的 Content(或它的狀態
  // hook)決定,不經第 4 層:登入後是 useMapState 的 tripCenter,/ai-plan 是固定的台南座標,行程詳情頁是依站點算的中心。
  initialCenter?: LatLng | null
  stops?: PlanStopMarker[]
  selectedStopId?: string | null
  hoverStopId?: string | null
  hoverTransitPair?: HoverTransitPair | null
  onStopClick?: (id: string) => void
  // routeSegments:地圖上站點之間要畫的連線段(planning/timeline/segments.ts 的 routeSegmentsFromTimeline 切出來的;
  // RouteSegment 結構相容 RouteLineSegment)。沒傳或空陣列就不畫。2026-10-24 取代原本的 showPlanRouteLine 布林:
  // 規劃入口的功能開關(ROUTE_LINE_ENABLED / 桌面的路徑開關)語意保留在各入口——開關關閉時不傳段;行程詳情頁一律傳。
  routeSegments?: RouteLineSegment[]
  currentPosition?: LatLng | null
  // theme:只收明確的 'dark' | 'light'(傳給 NativeMapBase 的 colorScheme 只能在建圖時設定,預設日夜切換時重建;登入後的 PlanMap 傳 rebuildOnThemeChange=false 不重建);三態的 Theme 先經 hooks/useResolvedTheme 解析。
  theme?: ResolvedTheme
  // askMapView:詢問頁(選擇感興趣景點/更換地點)的候選點,畫成搜尋結果標記(見 conversation/askMapView.ts)。沒傳或空就不畫。
  askMapView?: AskMapView
}

// AttractionGlowSource——各入口「光暈資料從哪來」的獨立 hook 共同的回傳形狀(2026-10-23):
//   attractionGlow:交給統一繪製層的光暈輸入(景點區域清單、placeDetails、photoAssets);
//   controls:這個來源需要的地圖控制項(例如「探索」按鈕),沒有就不傳,由 PlanMap 放進地圖容器。
// 三個入口的實作各自放在獨立 hook(行程詳情頁 itineraries/useCityAttractionGlow、/ai-plan planning/explore/useAttractionGlow;
// 登入後的來源目前仍內建在 planning/map/PlanMap),入口與形狀一致,實作各自維持原樣。
export interface AttractionGlowSource {
  attractionGlow: AttractionGlowInput
  controls?: ReactNode
}

// mergeAskMapView——把詢問頁候選點(askMapView,見 conversation/askMapView.ts)併進搜尋結果標記的輸入:
// 候選是 kind 'place' 的結果,已勾選的併進 candidateKeys(畫勾選徽章),點標記切換勾選(onToggle)。
// 沒有候選點時原樣回傳 searchResults(不改身分)。
export function mergeAskMapView(searchResults: SearchResultsInput | undefined, ask: AskMapView | undefined): SearchResultsInput | undefined {
  if (!ask || ask.results.length === 0) return searchResults
  const selected = new Set(ask.selectedPlaceIds)
  const candidateKeys = new Set(searchResults?.candidateKeys)
  for (const r of ask.results) {
    if (r.placeId && selected.has(r.placeId)) candidateKeys.add(itemKey('place', r))
  }
  const askSet = new Set<GeoSearchResult>(ask.results)
  return {
    results: [...(searchResults?.results ?? []), ...ask.results],
    selectedKey: searchResults?.selectedKey,
    hoverKey: searchResults?.hoverKey,
    candidateKeys,
    onSelect: (r) => {
      if (askSet.has(r)) {
        if (r.placeId) ask.onToggle?.(r.placeId)
        return
      }
      searchResults?.onSelect?.(r)
    },
  }
}

// ASK_FIT_DEBOUNCE_MS——候選點座標常是陸續查到的(沒自帶座標的要等詳細資料),點集合每變動一次就立刻對焦會讓鏡頭連跳好幾下;
// 等這段時間內沒有新變動再對焦一次。
export const ASK_FIT_DEBOUNCE_MS = 300

// useFitToAskPoints——詢問頁候選點出現(或換了一批)時把鏡頭調到能看見全部;只有勾選變動不動鏡頭。單點只平移不縮放。
// 點集合穩定 ASK_FIT_DEBOUNCE_MS 後才動作(見該常數)。
export function useFitToAskPoints(mapRef: React.RefObject<google.maps.Map | null>, mapReady: boolean, results: GeoSearchResult[]) {
  const pointsKey = results.map((r) => `${r.placeId}|${r.lat}|${r.lng}`).join(',')
  useEffect(() => {
    if (!mapReady || results.length === 0) return
    const timer = window.setTimeout(() => {
      const map = mapRef.current
      if (!map) return
      if (results.length === 1) {
        map.panTo({ lat: results[0].lat, lng: results[0].lng })
        return
      }
      const bounds = new google.maps.LatLngBounds()
      results.forEach((r) => bounds.extend({ lat: r.lat, lng: r.lng }))
      map.fitBounds(bounds, 64)
    }, ASK_FIT_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, pointsKey])
}

const NO_STOPS: PlanStopMarker[] = []

// usePlanMapDrawing——把 PlanMap 的共同 prop 轉成統一繪製層的輸入並呼叫它。
//   selectedStopId → selectedId、hoverStopId → hoverId、onStopClick → onPointClick、
//   routeSegments 原樣轉給統一繪製層(沒傳就不畫線)、沒傳 currentPosition → null(不畫藍點)。
// tripEntries、searchResults 只有登入後有資料,傳了才交給統一繪製層。
// 回傳 expandedThemeId:目前展開的主題點 id(選中有 children 的站點時),沒有展開為 null。
export function usePlanMapDrawing({
  mapRef,
  mapReady,
  mapVersion,
  theme,
  currentPosition,
  stops = NO_STOPS,
  selectedStopId,
  hoverStopId,
  hoverTransitPair,
  onStopClick,
  routeSegments,
  tripEntries,
  searchResults,
  attractionGlow,
  askMapView,
}: PlanMapSharedProps & {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  mapVersion: number
  tripEntries?: TripEntriesInput
  searchResults?: SearchResultsInput
  attractionGlow?: AttractionGlowInput
}) {
  // 依賴拆開寫:searchResults 在呼叫端是每次渲染新建的物件,身分不穩,但裡面的 results/鍵值才是穩定的;
  // 以它整個物件當依賴會讓併入後的結果每次渲染都換新、統一繪製層跟著重算。
  const srResults = searchResults?.results
  const srSelectedKey = searchResults?.selectedKey
  const srHoverKey = searchResults?.hoverKey
  const srCandidateKeys = searchResults?.candidateKeys
  const srOnSelect = searchResults?.onSelect
  const mergedSearchResults = useMemo(
    () => mergeAskMapView(
      searchResults ?? (srResults ? { results: srResults } : undefined),
      askMapView,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [srResults, srSelectedKey, srHoverKey, srCandidateKeys, srOnSelect, askMapView],
  )
  useFitToAskPoints(mapRef, mapReady, askMapView?.results ?? [])
  return useSharedDrawLayer({
    mapRef,
    mapReady,
    mapVersion,
    theme,
    currentPosition: currentPosition ?? null,
    stopDots: {
      stops,
      selectedId: selectedStopId,
      hoverId: hoverStopId,
      hoverTransitPair,
      onPointClick: onStopClick,
    },
    routeSegments,
    tripEntries,
    searchResults: mergedSearchResults,
    attractionGlow,
  })
}
