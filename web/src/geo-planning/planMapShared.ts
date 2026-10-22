import { useRef, useState } from 'react'
import { useStableCallback } from '../hooks/useStableCallback'
import type { MapHandle } from './NativeMapBase'
import {
  useSharedDrawLayer,
  type AttractionGlowInput,
  type SearchResultsInput,
  type TripEntriesInput,
} from './mapDrawLayer/useSharedDrawLayer'
import type { LatLng } from './mapDrawLayer/types'
import type { HoverTransitPair } from './mapMarkerLayer/planStops'
import type { PlanStopMarker } from './usePlanStopMarkers'

// planMapShared——兩邊的 PlanMap(/ai-plan 的 home/plan-ai-sim/PlanMap、登入後的 geo-planning/PlanMap)
// 共用的內部接線。兩份 PlanMap 原本各自寫了:接住 NativeMapBase 的 MapHandle、把 prop 轉成統一繪製層
// (useSharedDrawLayer)的輸入,內容幾乎一樣,現在收在這裡。
// 兩份 PlanMap 共用的只有這一層 props 轉換與 MapHandle 接線,其餘行為(查詢、事件、安全區等)各自實作。
//
// 兩邊 PlanMap 對外共同的 prop(名稱與語意一致,見 PlanMapSharedProps)也定義在這裡。

export const INITIAL_MAP_HANDLE: MapHandle = { mapRef: { current: null }, mapReady: false, mapVersion: 0 }

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
  stops?: PlanStopMarker[]
  selectedStopId?: string | null
  hoverStopId?: string | null
  hoverTransitPair?: HoverTransitPair | null
  onStopClick?: (id: string) => void
  showPlanRouteLine?: boolean
  currentPosition?: LatLng | null
  theme?: string | null
}

const NO_STOPS: PlanStopMarker[] = []

// usePlanMapDrawing——把 PlanMap 的共同 prop 轉成統一繪製層的輸入並呼叫它。
//   selectedStopId → selectedId、hoverStopId → hoverId、onStopClick → onPointClick、
//   showPlanRouteLine → routeLine.enabled、沒傳 currentPosition → null(不畫藍點)。
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
  showPlanRouteLine = false,
  tripEntries,
  searchResults,
  attractionGlow,
}: PlanMapSharedProps & {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  mapVersion: number
  tripEntries?: TripEntriesInput
  searchResults?: SearchResultsInput
  attractionGlow?: AttractionGlowInput
}) {
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
    routeLine: { enabled: showPlanRouteLine },
    tripEntries,
    searchResults,
    attractionGlow,
  })
}
