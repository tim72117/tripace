import type { RefObject } from 'react'
import type { GeoAttraction } from '../../api'
import { ExploreControls } from '../../geo-planning/ExploreControls'
import { EXPLORE_CATEGORY } from '../../geo-planning/exploreQuery'
import type { AttractionGlowSource } from '../../geo-planning/planMapShared'
import { useExploreQueries } from '../../geo-planning/useExploreQueries'
import { useMapIdle, useMapViewport } from '../../geo-planning/useMapEvents'
import { planAiFakeDataSource } from './planAiFakeDataSource'
import { SIDEBAR_TOP } from './planOverlayGeometry'
import type { PlanAiDataSource } from './planAiDataSource'

// NO_ATTRACTIONS:光暈沒有資料時的空清單(模組級常數,身分穩定,不會每次 render 都換)。
const NO_ATTRACTIONS: GeoAttraction[] = []

// useAttractionGlow——/ai-plan 的光暈資料來源(AttractionGlowSource 的 /ai-plan 實作,見 geo-planning/planMapShared.ts):
// 從 PlanMap 內搬出來的獨立 hook,實作原樣不變。
//
// 附近景點區域(推論態才查);光暈由統一繪製層畫,這裡只負責查資料。訪客沒有 token,照片走免登入端點。
// 與登入後的 PlanMap 共用同一套「按鈕才查」(useExploreQueries)與控制項(ExploreControls)——2026-10 使用者明確要求光暈觸發
// 統一成登入後的做法:按下「探索」才查可視範圍內的景點區域,地圖移動後出現「搜尋這個區域」重查,不再 idle 後自動重打。
// 只有推論態(liveLayersEnabled)且有資料存取層實例時才有這組控制項;沒有實例時 hook 仍要呼叫(Hooks 規則),傳不會查詢的
// 假資料版,控制項不渲染。
export function useAttractionGlow({
  mapRef,
  mapReady,
  mapVersion,
  liveLayersEnabled,
  attractionDataSource,
}: {
  mapRef: RefObject<google.maps.Map | null>
  mapReady: boolean
  mapVersion: number
  liveLayersEnabled: boolean
  attractionDataSource?: PlanAiDataSource
}): AttractionGlowSource {
  const exploreEnabled = liveLayersEnabled && !!attractionDataSource
  const { zoom: viewportZoom } = useMapViewport({ mapRef, mapReady, mapVersion })
  const { attractions, areaSearch, activeCategory, handleCategoryClick, handleSearchThisArea, handleMapIdle } =
    useExploreQueries({ mapRef, dataSource: attractionDataSource ?? planAiFakeDataSource, zoom: viewportZoom })
  useMapIdle({ mapRef, mapReady, mapVersion, onIdle: () => handleMapIdle() })

  return {
    attractionGlow: {
      attractions: exploreEnabled ? attractions : NO_ATTRACTIONS,
      placeDetails: attractionDataSource?.geoPlaceDetails,
      photoAssets: attractionDataSource?.photoAssets,
    },
    controls: exploreEnabled ? (
      <ExploreControls
        onExplore={() => handleCategoryClick(EXPLORE_CATEGORY)}
        showSearchThisArea={areaSearch.areaDirty && activeCategory === EXPLORE_CATEGORY}
        searching={areaSearch.searching}
        onSearchThisArea={handleSearchThisArea}
        // 漂浮導覽列(SiteNavButtons,fixed)佔掉頂端 SIDEBAR_TOP,控制項往下讓開。
        top={SIDEBAR_TOP + 12}
      />
    ) : undefined,
  }
}
