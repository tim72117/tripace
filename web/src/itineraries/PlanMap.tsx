import type { ReactNode } from 'react'
import { resolveMapCenter } from '../geo-planning/mapCenter'
import { NativeMapBase, type MapHandle } from '../geo-planning/NativeMapBase'
import { useMapHandle, usePlanMapDrawing, type PlanMapSharedProps } from '../geo-planning/planMapShared'
import type { AttractionGlowInput } from '../geo-planning/mapDrawLayer/useSharedDrawLayer'
import type { FeatureLayer } from '../geo-planning/mapDrawLayer/types'
import type { PlanStopMarker } from '../geo-planning/usePlanStopMarkers'

// PlanMap(行程詳情頁版)——行程詳情頁的「地圖元件」,與 /ai-plan(home/plan-ai-sim/PlanMap)、登入後
// (geo-planning/PlanMap)同名同層級:
//
//   容器 > map-layer > PlanMap > NativeMapBase
//
// 內部用 NativeMapBase 建圖,再經 planMapShared 的 useMapHandle(接 MapHandle)與 usePlanMapDrawing(把共同 prop 轉成
// 統一繪製層的輸入)掛上圖層;頁面只管狀態與版面,不直接掛圖層 hook。共同的 prop 名稱與語意見 PlanMapSharedProps。
//
// 這頁特有的:
//   - 地圖一律帶 mapId(AdvancedMarkerElement 需要),由頁面傳入。
//   - attractionGlow:主題點光暈(資料由頁面查好傳進來)。
//   - extraLayers:每天一條的手繪路線(routePolylineLayer)。
//   - children:疊在地圖畫布上的裝飾(暈影),放在地圖外框之內。
export interface PlanMapProps extends PlanMapSharedProps {
  zoom?: number
  mapId?: string
  stops: PlanStopMarker[]
  attractionGlow?: AttractionGlowInput
  extraLayers?: FeatureLayer[]
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
  onStopClick,
  attractionGlow,
  extraLayers,
  onHandleChange,
  children,
}: PlanMapProps) {
  const { mapRef, mapReady, mapVersion, handleChange } = useMapHandle(onHandleChange)
  usePlanMapDrawing({
    mapRef,
    mapReady,
    mapVersion,
    theme,
    stops,
    selectedStopId,
    hoverStopId,
    onStopClick,
    attractionGlow,
    extraLayers,
  })
  return (
    <>
      <NativeMapBase center={resolveMapCenter(initialCenter)} zoom={zoom} theme={theme} mapId={mapId} onHandleChange={handleChange} />
      {children}
    </>
  )
}
