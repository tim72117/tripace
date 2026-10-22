import { useEffect, type ReactNode } from 'react'
import type { GeoAttraction } from '../../api'
import { NativeMapBase, type MapHandle } from '../../geo-planning/NativeMapBase'
import { useMapHandle, usePlanMapDrawing, type PlanMapSharedProps } from '../../geo-planning/planMapShared'
import type { PlanStopMarker } from '../../geo-planning/usePlanStopMarkers'
import { useStableCallback } from '../../hooks/useStableCallback'
import { ExploreControls } from '../../geo-planning/ExploreControls'
import { EXPLORE_CATEGORY } from '../../geo-planning/exploreQuery'
import { useExploreQueries } from '../../geo-planning/useExploreQueries'
import { useMapIdle, useMapViewport } from '../../geo-planning/useMapEvents'
import { planAiFakeDataSource } from './planAiFakeDataSource'
import { SIDEBAR_TOP } from './planOverlayGeometry'
import type { PlanAiDataSource } from './planAiDataSource'

// PlanMap(/ai-plan 版)——/ai-plan 的「地圖元件」。登入後有同名同層級的 PlanMap(geo-planning/PlanMap.tsx):
//
//   容器 > map-layer > PlanMap > NativeMapBase
//
// 內部用 NativeMapBase 建圖,再掛上這張地圖自己的圖層 hook(統一繪製層的 useSharedDrawLayer、
// 景點區域光暈)。頁面(plan-ai-sim/Content)只管狀態與版面,不直接掛圖層 hook,對齊登入後
// 「頁面傳 prop、地圖元件自己掛圖層」的分工。
//
// 兩邊共用的接線在 geo-planning/planMapShared.ts:useMapHandle(接 NativeMapBase 的 MapHandle)與
// usePlanMapDrawing(把共同 prop 轉成統一繪製層的輸入);共同的 prop 名稱與語意見 PlanMapSharedProps
// (stops / selectedStopId / hoverStopId / hoverTransitPair / onStopClick / showPlanRouteLine /
// currentPosition / theme)。另外 controlsPortalTarget / children / onHandleChange 也與登入後同名。
//
// 目前是「薄實作」:
//   - controlsPortalTarget 收下但不渲染任何控制項(/ai-plan 沒有搜尋框、類別標籤等,是之後可以
//     長出來的位置;登入後的控制項就是經這個 prop portal 進 UI 層的 controls-slot)。
//   - 景點查詢只有「探索」那一支(useExploreQueries 與 ExploreControls,與登入後共用,按鈕才查),沒有類別標籤、搜尋框。
//   - theme 只交給統一繪製層讀強調色,不傳給 NativeMapBase:這頁一向不因主題重建地圖。
//   - 沒有行程 entry 與搜尋結果標記(沒有資料來源),所以不傳 tripEntries、searchResults。
//
// liveLayersEnabled:推論態才有的圖層(光暈)是否啟用,播放態是首頁展示用的劇本,不查資料。
export interface PlanMapProps extends PlanMapSharedProps {
  center: { lat: number; lng: number } | undefined
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

// NO_ATTRACTIONS:光暈沒有資料時的空清單(模組級常數,身分穩定,不會每次 render 都換)。
const NO_ATTRACTIONS: GeoAttraction[] = []

export function PlanMap({
  center,
  zoom,
  mapId,
  theme,
  stops,
  selectedStopId,
  hoverStopId,
  hoverTransitPair,
  onStopClick,
  showPlanRouteLine,
  currentPosition,
  liveLayersEnabled = false,
  attractionDataSource,
  onExpandedThemeIdChange,
  onHandleChange,
  children,
}: PlanMapProps) {
  const { mapRef, mapReady, mapVersion, handleChange } = useMapHandle(onHandleChange)

  // 附近景點區域(推論態才查);光暈由統一繪製層畫,這裡只負責查資料。訪客沒有 token,照片走免登入端點。
  // 景點區域光暈:與登入後的 PlanMap 共用同一套「按鈕才查」(useExploreQueries)與控制項(ExploreControls)——
  // 2026-10 使用者明確要求光暈觸發統一成登入後的做法:按下「探索」才查可視範圍內的景點區域,地圖移動後出現「搜尋這個區域」
  // 重查,不再 idle 後自動重打。只有推論態(liveLayersEnabled)且有資料存取層實例時才有這組控制項;沒有實例時 hook 仍要
  // 呼叫(Hooks 規則),傳不會查詢的假資料版,控制項不渲染。
  const exploreEnabled = liveLayersEnabled && !!attractionDataSource
  const { zoom: viewportZoom } = useMapViewport({ mapRef, mapReady, mapVersion })
  const { attractions, areaSearch, activeCategory, handleCategoryClick, handleSearchThisArea, handleMapIdle } =
    useExploreQueries({ mapRef, dataSource: attractionDataSource ?? planAiFakeDataSource, zoom: viewportZoom })
  useMapIdle({ mapRef, mapReady, mapVersion, onIdle: () => handleMapIdle() })

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
    showPlanRouteLine,
    attractionGlow: {
      attractions: exploreEnabled ? attractions : NO_ATTRACTIONS,
      placeDetails: attractionDataSource?.geoPlaceDetails,
      photoAssets: attractionDataSource?.photoAssets,
    },
  })
  const expandedChange = useStableCallback((id: string | null) => onExpandedThemeIdChange?.(id))
  useEffect(() => {
    expandedChange(expandedThemeId)
  }, [expandedThemeId, expandedChange])

  return (
    <NativeMapBase center={center} zoom={zoom} mapId={mapId} onHandleChange={handleChange}>
      {exploreEnabled && (
        <ExploreControls
          onExplore={() => handleCategoryClick(EXPLORE_CATEGORY)}
          showSearchThisArea={areaSearch.areaDirty && activeCategory === EXPLORE_CATEGORY}
          searching={areaSearch.searching}
          onSearchThisArea={handleSearchThisArea}
          // 漂浮導覽列(SiteNavButtons,fixed)佔掉頂端 SIDEBAR_TOP,控制項往下讓開。
          top={SIDEBAR_TOP + 12}
        />
      )}
      {children}
    </NativeMapBase>
  )
}
