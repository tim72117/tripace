import { useEffect, type ReactNode } from 'react'
import { resolveMapCenter } from '../map/mapCenter'
import { NativeMapBase, type MapHandle } from '../map/NativeMapBase'
import { useMapHandle, usePlanMapDrawing, type PlanMapSharedProps } from '../map/planMapShared'
import type { PlanStopMarker } from '../map/marker/planStops'
import { useStableCallback } from '../../hooks/useStableCallback'
import type { PlanAiDataSource } from '../data/source'
import { useAttractionGlow } from '../explore/useAttractionGlow'

// PlanMap(/ai-plan 版)——/ai-plan 的「地圖元件」。登入後有同名同層級的 PlanMap(planning/map/PlanMap.tsx):
//
//   容器 > map-layer > PlanMap > NativeMapBase
//
// 內部用 NativeMapBase 建圖,再掛上這張地圖自己的圖層 hook(統一繪製層的 useSharedDrawLayer、
// 景點區域光暈)。頁面(planning/preview/Content)只管狀態與版面,不直接掛圖層 hook,對齊登入後
// 「頁面傳 prop、地圖元件自己掛圖層」的分工。
//
// 兩邊共用的接線在 planning/map/planMapShared.ts:useMapHandle(接 NativeMapBase 的 MapHandle)與
// usePlanMapDrawing(把共同 prop 轉成統一繪製層的輸入);共同的 prop 名稱與語意見 PlanMapSharedProps
// (stops / selectedStopId / hoverStopId / hoverTransitPair / onStopClick / routeSegments /
// currentPosition / theme)。另外 controlsPortalTarget / children / onHandleChange 也與登入後同名。
//
// 目前是「薄實作」:
//   - controlsPortalTarget 收下但不渲染任何控制項(/ai-plan 沒有搜尋框、類別標籤等,是之後可以
//     長出來的位置;登入後的控制項就是經這個 prop portal 進 UI 層的 controls-slot)。
//   - 光暈資料(景點區域加「探索」控制項)來自獨立 hook useAttractionGlow(useExploreQueries 與 ExploreControls,與登入後共用,按鈕才查),沒有類別標籤、搜尋框。
//   - theme(只收明確的 'dark' | 'light',與另外兩份 PlanMap 同一種):傳給 NativeMapBase(日夜切換時重建地圖,colorScheme 只能在建圖時設定)與統一繪製層(讀強調色)。
//   - 沒有行程 entry 與搜尋結果標記(沒有資料來源),所以不傳 tripEntries、searchResults。
//
// liveLayersEnabled:推論態才有的圖層(光暈)是否啟用,播放態是首頁展示用的劇本,不查資料。
export interface PlanMapProps extends PlanMapSharedProps {
  zoom?: number
  mapId?: string
  // /ai-plan 一定有站點(模擬或真實來源),所以必填。
  stops: PlanStopMarker[]
  liveLayersEnabled?: boolean
  // attractionDataSource:光暈查附近景點區域用的資料存取層實例(登入版或訪客版,由頁面依登入狀態挑;
  // 見 PlanAiDataSource.nearbyAttractionAreas)。沒傳時不查光暈。
  attractionDataSource?: PlanAiDataSource
  controlsPortalTarget?: HTMLElement | null
  // 目前展開的主題點 id(選中有 children 的站點時),沒有展開為 null。頁面的平移判斷用得到。
  onExpandedThemeIdChange?: (id: string | null) => void
  onHandleChange?: (handle: MapHandle) => void
  children?: ReactNode
}

export function PlanMap({
  initialCenter,
  zoom,
  mapId,
  theme,
  stops,
  selectedStopId,
  hoverStopId,
  hoverTransitPair,
  onStopClick,
  routeSegments,
  currentPosition,
  liveLayersEnabled = false,
  attractionDataSource,
  onExpandedThemeIdChange,
  onHandleChange,
  children,
}: PlanMapProps) {
  const { mapRef, mapReady, mapVersion, handleChange } = useMapHandle(onHandleChange)

  // 光暈資料(景點區域加探索控制項)來自獨立 hook,見 useAttractionGlow.ts。
  const { attractionGlow, controls } = useAttractionGlow({ mapRef, mapReady, mapVersion, liveLayersEnabled, attractionDataSource })

  const { expandedThemeId } = usePlanMapDrawing({
    mapRef,
    mapReady,
    mapVersion,
    theme,
    currentPosition,
    stops,
    selectedStopId,
    hoverStopId,
    hoverTransitPair,
    onStopClick,
    routeSegments,
    attractionGlow,
  })
  const expandedChange = useStableCallback((id: string | null) => onExpandedThemeIdChange?.(id))
  useEffect(() => {
    expandedChange(expandedThemeId)
  }, [expandedThemeId, expandedChange])

  return (
    <NativeMapBase center={resolveMapCenter(initialCenter)} zoom={zoom} theme={theme} mapId={mapId} onHandleChange={handleChange}>
      {controls}
      {children}
    </NativeMapBase>
  )
}
