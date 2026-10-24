import type { ReactNode } from 'react'
import { resolveMapCenter } from '../planning/map/mapCenter'
import { NativeMapBase, type MapHandle } from '../planning/map/NativeMapBase'
import { useMapHandle, usePlanMapDrawing, type PlanMapSharedProps } from '../planning/map/planMapShared'
import type { AttractionGlowInput } from '../planning/map/draw/useSharedDrawLayer'
import type { PlanStopMarker } from '../planning/map/marker/planStops'

// PlanMap(行程詳情頁版)——行程詳情頁的「地圖元件」,與 /ai-plan(planning/preview/PlanMap)、登入後
// (planning/map/PlanMap)同名同層級:
//
//   容器 > map-layer > PlanMap > NativeMapBase
//
// 內部用 NativeMapBase 建圖,再經 planMapShared 的 useMapHandle(接 MapHandle)與 usePlanMapDrawing(把共同 prop 轉成
// 統一繪製層的輸入)掛上圖層;頁面只管狀態與版面,不直接掛圖層 hook。共同的 prop 名稱與語意見 PlanMapSharedProps。
//
// 這頁特有的:
//   - 地圖一律帶 mapId(AdvancedMarkerElement 需要),由頁面傳入。
//   - attractionGlow:主題點光暈(資料由頁面查好傳進來)。
//   - children:疊在地圖畫布上的裝飾(暈影),放在地圖外框之內。
// 連線(routeSegments)走共同 prop,與 /ai-plan、登入後同一個 routeLineLayer(2026-10-24 統一;原本這頁另掛
// 依天換色的 routePolylineLayer,已移除)。
export interface PlanMapProps extends PlanMapSharedProps {
  zoom?: number
  mapId?: string
  stops: PlanStopMarker[]
  attractionGlow?: AttractionGlowInput
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
  routeSegments,
  attractionGlow,
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
    routeSegments,
    attractionGlow,
  })
  return (
    <>
      <NativeMapBase center={resolveMapCenter(initialCenter)} zoom={zoom} theme={theme} mapId={mapId} onHandleChange={handleChange} />
      {children}
    </>
  )
}
