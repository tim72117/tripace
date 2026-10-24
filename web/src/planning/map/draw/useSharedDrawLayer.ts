import { useMemo } from 'react'
import type { GeoAttraction, GeoPlaceDetails, GeoSearchResult, GeoTripEntry } from '../../../api'
import type { GeoSelectedKey } from '../../explore/selectedKey'
import { useStableCallback } from '../../../hooks/useStableCallback'
import { resolveExpandedThemeId, planStopsToPoints, type HoverTransitPair, type MapMarkerPoint, type PlanStopMarker } from '../marker/planStops'
import { useMapDrawLayer } from './index'
import { useAccentColor } from './useAccentColor'
import { attractionGlowLayer, filterRevealedAttractions } from './layers/attractionGlowLayer'
import { useAttractionGlowEffects, useAttractionGlowRegistry } from './layers/attractionGlowSupport'
import { currentLocationLayer } from './layers/currentLocationLayer'
import { planStopLayer } from './layers/planStopLayer'
import { routeLineLayer, type RouteLineSegment } from './layers/routeLineLayer'
import { searchResultLayer } from './layers/searchResultLayer'
import { tripEntryLayer } from './layers/tripEntryLayer'
import { transitHoverLineLayer } from './layers/transitHoverLineLayer'
import type { FeatureLayer, LatLng } from './types'

// useSharedDrawLayer——兩個接線處(/ai-plan 推論態的 planning/preview/Content、登入後的 PlanMap)
// 「完全相同」的那一部分繪製層,收在這一個子層裡再組合進 useMapDrawLayer。
//
// 目前共用的功能層有七個(行程 entry 旗子與搜尋結果只有登入後有資料,/ai-plan 不傳就不畫):
//   - 目前位置藍點(currentPosition)
//   - 行程站點圓點(stopDots),含主題點展開
//   - 行程 entry 旗子(tripEntries)
//   - 搜尋結果標記(searchResults;fitBounds 鏡頭動作不在這裡)
//   - 轉乘 hover 虛線(同樣由 stopDots 的 hoverTransitPair 驅動)
//   - 站點之間的連線(routeSegments:要畫的段清單,沒傳或空陣列就不畫;2026-10-24 起三個入口統一,
//     段由 planning/timeline/segments.ts 切,顏色是主題強調色、深色主題光暈用黑)
//   - 景點區域光暈(attractionGlow)
// 原本兩邊各自不一樣的功能層用 extraLayers 傳進來;現在全部收進這裡,這個參數已移除。之後要加功能層也加在這裡,
// 兩邊就同時有。
//
// 不放進宿主本身:宿主(useMapDrawLayer)只懂「吃 layers 然後畫」,不該知道哪些功能層是這兩個
// 接線處共有的。itineraries 頁沒有藍點與這種站點互動,所以直接用宿主,不經過這一層。
//
// 回傳 expandedThemeId(目前展開的主題點 id,沒有展開為 null):/ai-plan 的平移判斷會用。
// 它由站點與選取狀態直接算出,和圖層畫不畫無關。
//
// 選取與 hover 完全由外部持有(受控):這一層只依狀態畫,使用者點圓點時回報意圖
// (onPointClick、onSelectedChange)。回呼用穩定參照包起來,呼叫端每次渲染傳新函式不會讓功能層
// 重算,也不會造成圓點重建。
export type StopDotsInput = {
  stops: PlanStopMarker[]
  selectedId?: string | null
  hoverId?: string | null
  hoverTransitPair?: HoverTransitPair | null
  // 手機沒有滑鼠 hover 時傳 false;沒傳就支援 hover。
  supportsHover?: boolean
  onSelectedChange?: (id: string | null) => void
  onPointClick?: (id: string, point: MapMarkerPoint) => void
}

// 行程 entry 與搜尋結果用 selectedKey、hoverKey(GeoSelectedKey,`kind:name:lat:lng` 字串)判斷選取,
// 和站點圓點的 selectedId(站點 id)是兩套選取模型,目前並存,各自由呼叫端持有。
export type TripEntriesInput = {
  entries: GeoTripEntry[]
  selectedKey?: GeoSelectedKey
  hoverKey?: GeoSelectedKey
}

export type SearchResultsInput = {
  results: GeoSearchResult[]
  selectedKey?: GeoSelectedKey
  hoverKey?: GeoSelectedKey
  candidateKeys?: Set<string>
  onSelect?: (result: GeoSearchResult) => void
}

// 景點區域光暈的輸入(兩邊共用)。attractions 是查到的全部景點區域;有等級的要在 revealedAttractionNames 內才畫
// (沒傳視為都沒揭露);照片所需的地點詳情與照片查詢走資料存取層實例(placeDetails、photoAssets,端點由實例決定)。
export type AttractionGlowInput = {
  attractions: GeoAttraction[]
  revealedAttractionNames?: Set<string> | null
  selectedKey?: GeoSelectedKey
  hoverKey?: GeoSelectedKey
  candidateKeys?: Set<string>
  hoveredCuratedId?: string | null
  // 手機主題卡開啟時隱藏、ScrollTimeline 聚焦與主題照片收起:只有 InteractiveExploreMap 傳,見 attractionGlowLayer 的說明。
  hiddenAttractionId?: string | null
  focusedAttractionId?: string | null
  themePhotoOnlyWhenFocused?: boolean
  focusedThemeId?: string | null
  onSelect?: (attraction: GeoAttraction) => void
  // placeDetails、photoAssets:走資料存取層實例(登入版 /internal、訪客版 /public,由呼叫端挑實例)。
  placeDetails?: (placeId: string) => Promise<GeoPlaceDetails>
  photoAssets?: (placeId: string) => Promise<{ googlePhotoUrls?: string[] }>
}

const NO_ATTRACTIONS: GeoAttraction[] = []
// 沒傳 routeSegments 時用同一個空陣列(身分穩定,layers 的 useMemo 不會因此重算)。
const NO_SEGMENTS: RouteLineSegment[] = []

export function sharedFeatureLayers({ currentPosition }: { currentPosition: LatLng | null }): FeatureLayer[] {
  return [currentLocationLayer({ position: currentPosition })]
}

export function useSharedDrawLayer({
  mapRef,
  mapReady,
  mapVersion = 0,
  theme,
  currentPosition,
  stopDots,
  routeSegments = NO_SEGMENTS,
  tripEntries,
  searchResults,
  attractionGlow,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  mapVersion?: number
  // 主題:改變時重新讀強調色(useAccentColor);沒傳就只在地圖就緒、重建時讀。
  theme?: string | null
  // 目前位置:/ai-plan 來自推論態才取得的定位,登入後來自 PlanMap 的 currentPosition prop;
  // null 代表不畫藍點。
  currentPosition: LatLng | null
  // 行程站點圓點。沒傳就不畫站點。
  stopDots?: StopDotsInput
  // 站點之間的連線:要畫的段(planning/timeline/segments.ts 切出來的),沒傳或空陣列就不畫。
  // 與 stopDots 一起畫(hover 虛線要疊在同一段上),沒有 stopDots 時也不畫線。
  routeSegments?: RouteLineSegment[]
  // 行程 entry 旗子。沒傳就不畫。
  tripEntries?: TripEntriesInput
  // 搜尋結果標記。沒傳就不畫。
  searchResults?: SearchResultsInput
  // 景點區域光暈。沒傳就不畫。
  attractionGlow?: AttractionGlowInput
}) {
  const stops = stopDots?.stops
  // points 用站點內容算 key 再 useMemo:TripPlanPage 的站點陣列常常內容沒變、身分卻每次換新。
  const stopsKey = (stops ?? [])
    .map((s) => {
      const children = (s.children ?? []).map((c) => `${c.id}:${c.lat}:${c.lng}:${c.name ?? ''}`).join(';')
      return `${s.id}|${s.lat}|${s.lng}|${s.name ?? ''}|${s.glyph ?? ''}|${s.size ?? ''}|${children}`
    })
    .join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const points = useMemo(() => planStopsToPoints(stops ?? []), [stopsKey])

  const onSelectedChange = useStableCallback((id: string | null) => stopDots?.onSelectedChange?.(id))
  const onPointClick = useStableCallback((id: string, point: MapMarkerPoint) => stopDots?.onPointClick?.(id, point))

  const onResultSelect = useStableCallback((r: GeoSearchResult) => searchResults?.onSelect?.(r))
  const entries = tripEntries?.entries
  const entrySelectedKey = tripEntries?.selectedKey
  const entryHoverKey = tripEntries?.hoverKey
  const results = searchResults?.results
  const resultSelectedKey = searchResults?.selectedKey
  const resultHoverKey = searchResults?.hoverKey
  const resultCandidateKeys = searchResults?.candidateKeys

  const onGlowSelect = useStableCallback((a: GeoAttraction) => attractionGlow?.onSelect?.(a))
  const glowRegistry = useAttractionGlowRegistry()
  const glowAttractions = attractionGlow?.attractions
  const glowRevealed = attractionGlow?.revealedAttractionNames
  const glowShown = useMemo(
    () => (glowAttractions ? filterRevealedAttractions(glowAttractions, glowRevealed) : undefined),
    [glowAttractions, glowRevealed],
  )
  const glowSelectedKey = attractionGlow?.selectedKey
  const glowHoverKey = attractionGlow?.hoverKey
  const glowCandidateKeys = attractionGlow?.candidateKeys
  const glowHoveredCuratedId = attractionGlow?.hoveredCuratedId
  const glowHiddenId = attractionGlow?.hiddenAttractionId
  const glowFocusedId = attractionGlow?.focusedAttractionId
  const glowThemePhotoOnlyWhenFocused = attractionGlow?.themePhotoOnlyWhenFocused
  const glowFocusedThemeId = attractionGlow?.focusedThemeId

  const selectedId = stopDots?.selectedId ?? null
  const hoverId = stopDots?.hoverId ?? null
  const hoverTransitPair = stopDots?.hoverTransitPair ?? null
  const supportsHover = stopDots?.supportsHover
  // 強調色由這一層自己讀(站點選中色、主題點圓圈、路線、虛線都用),接線處不用再傳。
  const accentColor = useAccentColor({ mapRef, mapReady, theme, mapVersion })
  // 連線光暈的顏色跟主題走(淺色白、深色黑,見 routeStyle.ts);theme 沒傳或非 'dark' 視為淺色。
  const dark = theme === 'dark'
  const hasStopDots = stopDots != null

  const layers = useMemo(
    () => [
      ...sharedFeatureLayers({ currentPosition }),
      ...(hasStopDots
        ? [
            planStopLayer({
              points,
              selectedId,
              hoverId,
              hoverTransitPair,
              supportsHover,
              accentColor,
              onPointClick,
              onSelectedChange,
            }),
            // 轉乘 hover 虛線與站點圓點同一組資料(站點、轉乘配對、強調色),跟著 stopDots 一起畫。
            transitHoverLineLayer({ stops: points, hoverTransitPair, accentColor }),
            routeLineLayer({ segments: routeSegments, accentColor, dark }),
          ]
        : []),
      ...(entries ? [tripEntryLayer({ entries, selectedKey: entrySelectedKey, hoverKey: entryHoverKey, accentColor })] : []),
      ...(results
        ? [
            searchResultLayer({
              results,
              selectedKey: resultSelectedKey,
              hoverKey: resultHoverKey,
              candidateKeys: resultCandidateKeys,
              onSelect: onResultSelect,
            }),
          ]
        : []),
      ...(glowShown
        ? [
            attractionGlowLayer({
              attractions: glowShown,
              selectedKey: glowSelectedKey,
              hoverKey: glowHoverKey,
              candidateKeys: glowCandidateKeys,
              hoveredCuratedId: glowHoveredCuratedId,
              hiddenAttractionId: glowHiddenId,
              focusedAttractionId: glowFocusedId,
              themePhotoOnlyWhenFocused: glowThemePhotoOnlyWhenFocused,
              focusedThemeId: glowFocusedThemeId,
              onSelect: onGlowSelect,
              onCreate: glowRegistry.onCreate,
              onDispose: glowRegistry.onDispose,
            }),
          ]
        : []),
    ],
    [
      currentPosition,
      hasStopDots,
      points,
      selectedId,
      hoverId,
      hoverTransitPair,
      supportsHover,
      accentColor,
      dark,
      routeSegments,
      onPointClick,
      onSelectedChange,
      entries,
      entrySelectedKey,
      entryHoverKey,
      results,
      resultSelectedKey,
      resultHoverKey,
      resultCandidateKeys,
      onResultSelect,
      glowShown,
      glowSelectedKey,
      glowHoverKey,
      glowCandidateKeys,
      glowHoveredCuratedId,
      glowHiddenId,
      glowFocusedId,
      glowThemePhotoOnlyWhenFocused,
      glowFocusedThemeId,
      onGlowSelect,
      glowRegistry.onCreate,
      glowRegistry.onDispose,
    ],
  )
  useMapDrawLayer({ mapRef, mapReady, mapVersion, layers })
  // 光暈的照片查詢與標籤避讓要操作引擎剛建好的實例,必須宣告在 useMapDrawLayer 之後(同一次 commit 內依序執行)。
  useAttractionGlowEffects({
    mapRef,
    mapReady,
    mapVersion,
    registry: glowRegistry.registry,
    attractions: glowShown ?? NO_ATTRACTIONS,
    selectedKey: glowSelectedKey,
    hoverKey: glowHoverKey,
    candidateKeys: glowCandidateKeys,
    hoveredCuratedId: glowHoveredCuratedId,
    hiddenAttractionId: glowHiddenId,
    focusedAttractionId: glowFocusedId,
    themePhotoOnlyWhenFocused: glowThemePhotoOnlyWhenFocused,
    focusedThemeId: glowFocusedThemeId,
    placeDetails: attractionGlow?.placeDetails,
    photoAssets: attractionGlow?.photoAssets,
  })

  return { expandedThemeId: hasStopDots ? resolveExpandedThemeId(selectedId, points) : null }
}
