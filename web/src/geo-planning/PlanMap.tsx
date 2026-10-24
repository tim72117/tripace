import { useEffect, useMemo, useRef } from 'react'
import type { RouteLineSegment } from './mapDrawLayer/featureLayers/routeLineLayer'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ClientConfig, GeoAttraction, GeoGeocodeCandidate, GeoPlaceDetails, GeoSearchResult, GeoTripEntry } from '../api'
import { geocodeCandidateToSearchResult } from '../api'
import { Hotel, Loader2, MapPin, Search, Sparkles, UtensilsCrossed } from 'lucide-react'
import { ExploreTagButton, SearchThisAreaButton } from './ExploreControls'
import type { GeoSelectedKey } from './geoSelectedKey'
import { isSubmitEnter } from '../AppCommon'
import type { ResolvedTheme } from '../theme'
import { useFitToGeocodeResults } from './useFitToGeocodeResults'
import type { PlanStopMarker } from './usePlanStopMarkers'
import { resolveMapCenter } from './mapCenter'
import { NativeMapBase } from './NativeMapBase'
import { useMapViewport, useMapIdle } from './useMapEvents'
import { resolveControlsPlacement } from './controlsPlacement'
import { EXPLORE_CATEGORY } from './exploreQuery'
import { useExploreQueries } from './useExploreQueries'
import { getPlanAiApiDataSource } from '../home/plan-ai-sim/planAiApiDataSource'
import { useAttractionClickRouting } from './useAttractionClickRouting'
import { usePanTarget } from './usePanTarget'
import { useMapHandle, usePlanMapDrawing } from './planMapShared'
import styles from './PlanMap.module.css'

// 地理輪廓底圖(構想 6,見 docs/TRIP_PLANNING_DESIGN_DISCUSSION.md)。
// 文案界線:只回答「這城市長什麼樣」——光暈只有地名標籤與(可選)圓形地標縮圖,不評分、不排名、不帶推薦語氣。
// 光暈用 OverlayView 疊 HTML、不用 AdvancedMarkerElement:要的是「光暈+標籤」複合視覺,
// 且需跟著地圖縮放/平移自動重新定位。底圖樣式由 mapId 的 Cloud-based Map Style 決定
// (帶 mapId 的地圖會完全忽略行內 styles,所以這裡不設樣式)。

// 類別標籤列的定義;type 同時是 GeoGeocodeCandidate.category 的值域(決定 marker 圖示)。
// 「探索」標籤語意不同,不放進這個陣列,見 JSX。

const CATEGORY_TAGS: { type: string; label: string; Icon: typeof Hotel }[] = [
  { type: 'tourist_attraction', label: '景點', Icon: MapPin },
  { type: 'lodging', label: '飯店', Icon: Hotel },
  { type: 'restaurant', label: '餐廳', Icon: UtensilsCrossed },
]


// 再 export 讓呼叫端(如 PlanPhoneView.tsx)判斷 onActiveCategoryChange 回報的是否為探索,
// 不必自己寫死一份字串。
export { EXPLORE_CATEGORY }

// 概述:探索地圖本體——建圖與主題/縮放處理交給 NativeMapBase,這裡只組合各圖層與互動 hook:
//   useExploreQueries(查詢與「搜尋這個區域」狀態)、useMapViewport/useMapIdle(視野與 idle)、
//   useAttractionClickRouting(點光暈/底圖 POI 後的分流)、usePanTarget(panTarget 平移),
//   以及景點光暈/搜尋結果/旅程/規劃站點/目前位置等圖層 hook。
// 設計決定:搜尋結果(geocodeCandidates)是受控資料,唯一持有者在呼叫端;景點區域的查詢責任在
// 地圖側(只有它知道當下 bounds);控制項(標籤、搜尋框、「搜尋這個區域」)的狀態都留在這裡,
// 只有 DOM 位置可經 controlsPortalTarget 傳送到呼叫端的 UI 層。
export function PlanMap({
  cfg,
  initialCenter,
  currentPosition = null,
  restrictBounds,
  tripEntries = [],
  stops = [],
  selectedStopId,
  hoverStopId,
  hoverTransitPair,
  routeSegments,
  onStopClick,
  onMapReady,
  city,
  onCityChange,
  onSearch,
  searching,
  searchError,
  onOpenChat,
  showZoomControl = true,
  searchRightSlot,
  controlsPortalTarget,
  onAttractionsChange,
  initialAttractions,
  revealedAttractionNames,
  hoveredCuratedId,
  onGeocodeCandidatesChange,
  onSearchStart,
  hideCategoryTags,
  onActiveCategoryChange,
  exploreTrigger,
  hideExploreTag,
  onAttractionSelect,
  onSearchResultSelect,
  onPoiSelect,
  onAttractionOpenPlaceDetails,
  onAttractionOpenPlaceWithoutGoogle,
  onCenterChange,
  panTarget,
  safeAreaRef,
  selectedKey,
  candidateKeys,
  hoverKey,
  geocodeCandidates: geocodeCandidatesProp,
  theme,
  children,
}: {
  cfg: ClientConfig
  // initialCenter:建圖用的初始中心。undefined = 呼叫端還在查旅程有沒有既有地點,建圖要等
  // (先用預設值建、查完再平移,會白查一次舊位置,且平移後的查詢可能被 suppressQuery 抑制,
  // 使用者進頁面看不到資料);null = 確定沒有可用中心,退回預設值;物件 = 直接建在該座標。
  initialCenter?: { lat: number; lng: number } | null
  // currentPosition:定位成功時才有值,用來畫藍色圓點(見 currentLocationLayer)。
  // 與 initialCenter 獨立、不影響建圖時機;undefined/null 都代表不畫。
  currentPosition?: { lat: number; lng: number } | null
  // restrictBounds:限制可拖曳/縮放的範圍(展示頁用,避免拖到空白區域)。strict 鎖死、不彈回;
  // 只在建圖當下讀取,事後改變不會生效。
  restrictBounds?: google.maps.LatLngBoundsLiteral | null
  // tripEntries:旅程本身已有座標的 entry,畫在地圖上讓使用者看到已排入地點與周邊景點的相對位置。
  // 是旅程的固定內容(換旅程才變),不是依地圖範圍查出來的結果。
  tripEntries?: GeoTripEntry[]
  // stops:AI 規劃時間軸上的站點,畫成小圓點;與 tripEntries 的旗子刻意區分——
  // 那是已寫進資料庫的正式項目,這是尚未落進旅程的規劃草稿。預設空陣列(不傳即無此圖層)。
  stops?: PlanStopMarker[]
  // selectedStopId / onStopClick 與時間軸卡片構成「卡片 ↔ 地圖」雙向對應。
  selectedStopId?: string | null
  // hoverStopId:滑鼠懸停的時間軸卡片。與 selected 同一套靶心語彙但視覺較弱(暫時掃過 vs 主動錨定),
  // 兩者指向同一顆時 selected 優先。
  hoverStopId?: string | null
  // hoverTransitPair:懸停在時間軸交通膠囊時,該段交通的兩端站點 id;
  // 兩點顯示 hover 態並以虛線連接(見 mapDrawLayer/featureLayers/transitHoverLineLayer.ts)。
  hoverTransitPair?: { fromId: string; toId: string } | null
  // routeSegments:站點之間要畫的連線段(見 planMapShared 的 PlanMapSharedProps)。登入後桌面由標頭列的路徑開關決定要不要傳;
  // 沒傳就不畫。
  routeSegments?: RouteLineSegment[]
  onStopClick?: (id: string) => void
  // onMapReady:地圖實例建好、可顯示內容時呼叫(mapReady/mapVersion 變動時觸發),
  // 讓呼叫端把「要等地圖畫好才出現」的 UI 延後,避免地圖還是空白時先冒出懸空卡片。
  onMapReady?: () => void
  // city/onCityChange/onSearch/searching/searchError:地圖上方的城市搜尋框,與候選籃側欄的搜尋框
  // 共用同一份輸入值與查詢邏輯(只是多一個入口,不是第二套狀態)。全部 optional,沒接就不渲染搜尋框。
  city?: string
  onCityChange?: (city: string) => void
  onSearch?: () => void
  searching?: boolean
  searchError?: string | null
  // onOpenChat:搜尋框左側 AI 按鈕,打開規劃面板(AI 規劃對話與時間軸)。沒接就不顯示按鈕。
  onOpenChat?: () => void
  // showZoomControl:右下角縮放按鈕,預設 true;手機版可傳 false(本來就能雙指縮放)。
  // 只在建圖當下讀取。
  showZoomControl?: boolean
  // searchRightSlot:搜尋框膠囊最右側的額外內容(手機版放頭像),作為 flex 子元素自動對齊,
  // 不用絕對定位猜座標。
  searchRightSlot?: ReactNode
  // controlsPortalTarget:控制項(類別標籤、搜尋框、錯誤訊息、「搜尋這個區域」)渲染到哪裡。
  // undefined = 原地渲染;null = 要用 UI 層但容器尚未掛載,先不渲染;HTMLElement = 傳送過去。
  // 判斷見 controlsPlacement.ts;狀態與事件仍留在這個元件,只有 DOM 位置不同。
  controlsPortalTarget?: HTMLElement | null
  // onAttractionsChange:查詢到新的景點區域時往上回報。側欄不是地圖的子節點,
  // 且 bounds 只有地圖知道,清單只能靠這個 callback 同步。
  onAttractionsChange?: (attractions: GeoAttraction[]) => void
  // initialAttractions:掛載時就要顯示的景點區域(展示頁等不經使用者查詢的情境),只讀一次當初始值;
  // 之後真正的查詢仍會覆蓋它,不是鎖定。
  initialAttractions?: GeoAttraction[]
  // revealedAttractionNames / hoveredCuratedId:原封不動轉傳給 useSharedDrawLayer 的 attractionGlow 輸入(attractionGlowLayer.ts)。
  revealedAttractionNames?: Set<string> | null
  hoveredCuratedId?: string | null
  // onGeocodeCandidatesChange:類別標籤或「搜尋這個區域」的 Places 查詢完成時通知呼叫端。
  // 搜尋結果由呼叫端唯一持有(受控),這裡不再另存一份,
  // 呼叫端才能乾淨地實作「搜尋框清空時連動清空地圖結果」。
  onGeocodeCandidatesChange?: (candidates: GeoGeocodeCandidate[]) => void
  // onSearchStart:Places 查詢真正發出前呼叫。標籤與「搜尋這個區域」共用同一個查詢匯合點,
  // 在那裡呼叫就不會漏;城市搜尋框走另一條路徑,不經過它。手機版用它在按下查詢時立刻打開結果抽屜。
  onSearchStart?: () => void
  // hideCategoryTags:是否隱藏類別標籤列,由呼叫端依 geoCategoryTagsState.ts 狀態機算出
  // (開始搜尋立刻隱藏,不等結果)。未傳 = 一律顯示。
  hideCategoryTags?: boolean
  // onActiveCategoryChange:目前選中的類別往上回報(null = 無),讓側欄標題/空狀態能反映
  // 結果屬於哪個類別,不必自己猜。
  onActiveCategoryChange?: (category: string | null) => void
  // exploreTrigger:讓呼叫端從外部觸發「探索」標籤點擊(手機版探索按鈕在 phone/Nav,
  // 與地圖是分開掛載的 sibling)。用遞增計數器而非布林,連續點擊才每次都會被 effect 偵測到。
  // 選取狀態仍由這個元件持有、經 onActiveCategoryChange 回報,不往上提升。
  exploreTrigger?: number
  // hideExploreTag:隱藏疊在地圖上的「探索」標籤(手機版改由 exploreTrigger 從底部功能列觸發)。
  hideExploreTag?: boolean
  // onAttractionSelect:使用者直接點地圖上的景點區域地標時往上回報,供側欄同步選取與顯示介紹
  // (側欄是分開掛載的 sibling)。由 handleAttractionClick 的分流呼叫,不是另一條點擊路徑。
  onAttractionSelect?: (attraction: GeoAttraction) => void
  // onSearchResultSelect:使用者直接點飯店/推薦/搜尋結果 marker 時觸發;
  // 呼叫端依 GeoSearchResult.kind 判斷來源。
  onSearchResultSelect?: (result: GeoSearchResult) => void
  // onPoiSelect:使用者點 Google 底圖原生 POI 時觸發。click 事件只給 placeId,
  // 所以由 useAttractionClickRouting 用 cfg 查完詳細資訊才回報,不把查詢責任推給呼叫端。
  onPoiSelect?: (details: GeoPlaceDetails) => void
  // onAttractionOpenPlaceDetails:非主題點地標點擊時,以「並存」方式開地點卡(桌面版疊在主題卡左側、
  // 不關掉主題卡);onPoiSelect 則會經 geoSelection 互斥而取代當前卡片。手機版是單一 sheet 堆疊,
  // 不傳此 prop 時退回 onPoiSelect。第二個參數 attraction 僅在點景點區域地標時帶,
  // 讓呼叫端把人工整理的 summary 附加到 Google 詳細資訊上;點底圖 POI 時不帶。
  onAttractionOpenPlaceDetails?: (details: GeoPlaceDetails, attraction?: GeoAttraction) => void
  // onAttractionOpenPlaceWithoutGoogle:非主題點地標點擊但沒有 placeId 或查詢失敗時,
  // 用 attraction 自己的資料組地點卡(不查 Google),並存規則同上。非主題點一律開地點卡,
  // 不退回開 attraction 介紹卡。沒提供時(手機版)退回 onAttractionSelect。
  onAttractionOpenPlaceWithoutGoogle?: (attraction: GeoAttraction) => void
  // onCenterChange:idle 時回報地圖中心,供城市搜尋框的泛用關鍵字(如「甜點」)當 locationBias,
  // 優先偏向目前區域而非全球最知名的結果。
  onCenterChange?: (center: { lat: number; lng: number }) => void
  // panTarget:要把地圖移動到的目標。每次請求都是新物件參照,所以直接放進 effect 依賴即可偵測,
  // 不需序號。移動由 usePanTarget 處理。
  // level:只有點「地點」才帶;帶時會把 zoom 拉到能顯示該地點的最小層級,否則可能移到一片空白。
  // radiusMeters:有值時改用 fitBounds 框住該半徑,並忽略 level;目前沒有呼叫端傳,保留給未來入口。
  // suppressQuery:移動後的 idle 不要冒出「搜尋這個區域」。true = 只是對齊/選中已知項目;
  //   false/不帶 = 使用者想換地方看(搜尋城市),該提示可查詢新範圍。由呼叫端決定,因為只有它知道意圖。
  // onlyIfOutOfView:true 時座標已在可視範圍內就不移動(側欄清單點擊用);bounds 為 null 時
  //   無法判斷,保守地仍然移動。
  // safeAreaRef:選填。有的話 panTarget 的平移改成讓目標落在安全區中心(見 usePanTarget);登入後手機傳疊加層的 safe-area 節點。
  safeAreaRef?: React.RefObject<Element | null>
  panTarget?: {
    lat: number
    lng: number
    level?: number
    radiusMeters?: number
    suppressQuery?: boolean
    onlyIfOutOfView?: boolean
  } | null
  // selectedKey:目前選中的飯店/地點識別鍵(geoItemKey),驅動各圖層的選取樣式,與側欄同步。
  selectedKey?: GeoSelectedKey
  // candidateKeys:候選籃中項目的識別鍵,用 Set 以便每個 marker 建立時 O(1) 檢查。
  // 只涵蓋手動加入的飯店/景點區域/附近推薦;tripEntries 有自己的旗子語意,刻意不比對。
  candidateKeys?: Set<string>
  // hoverKey:滑鼠移到側欄項目時的臨時識別鍵。與 selectedKey 獨立(各處以 || 合併),
  // 移開後回到 null 但不能清掉 selectedKey。
  hoverKey?: GeoSelectedKey
  // geocodeCandidates:搜尋結果的唯一持有者在呼叫端(城市搜尋框、類別標籤、「搜尋這個區域」
  // 三個入口都收斂到此);畫成可點擊 marker 並 fitBounds。空陣列 = 沒有待確認候選。
  geocodeCandidates?: GeoGeocodeCandidate[]
  // theme:深色/淺色偏好,建圖時決定 colorScheme(只能在建圖當下設定)。
  // 這裡傳 rebuildOnThemeChange={false},建圖後主題改變不重建地圖。預設跟隨系統。
  theme?: ResolvedTheme
  // children:附掛在地圖容器內的浮動 UI(主題卡/地點卡等),由呼叫端組裝;對齊 NativeMapBase 的 children。
  children?: ReactNode
}) {
  // 接住 NativeMapBase 回報的 MapHandle,同步成身分不變的本地 mapRef 與 mapReady、mapVersion、error。
  // 兩邊的 PlanMap(/ai-plan 與登入後)共用這段(見 planMapShared.ts)。
  const { mapRef, mapReady, mapVersion, error: err, handleChange: handleMapHandleChange } = useMapHandle()
  // 以 ref 讀最新 callback,避免呼叫端每次 render 的新閉包重新觸發 effect。
  const onMapReadyRef = useRef(onMapReady)
  onMapReadyRef.current = onMapReady
  // 同上:idle 回呼用 ref 讀最新的 onCenterChange。
  const onCenterChangeRef = useRef(onCenterChange)
  onCenterChangeRef.current = onCenterChange
  // zoom:供查詢半徑換算與 panTarget 判斷是否要拉近;bounds:供 panTarget 的 onlyIfOutOfView 判斷,
  // 初始 null 代表尚未收到第一次 bounds_changed。
  const { zoom, bounds } = useMapViewport({ mapRef, mapReady })
  // searchResults:受控的 geocodeCandidates 轉成 GeoSearchResult;用 useMemo 派生而非另存 state,
  // 避免兩份資料不同步。結果是查詢完成時的靜態快照,不隨 bounds 即時篩選
  // (否則拖曳地圖清單會瘦身,清單點擊的移動邏輯形同虛設)。
  const searchResults = useMemo<GeoSearchResult[]>(
    () => (geocodeCandidatesProp ?? []).map(geocodeCandidateToSearchResult),
    [geocodeCandidatesProp],
  )
  // 查詢與搜尋區域狀態(attractions、areaSearch、activeCategory 與三個查詢入口)見 useExploreQueries。
  // exploreDataSource:登入後的資料存取層實例(2026-10,使用者明確要求「光暈查詢共用,端點應該是有不同的資料
  // 存取層實例」)。登入後的 PlanMap 永遠是登入狀態,用登入版(打 /internal);/ai-plan 的 PlanMap 由頁面
  // 依登入狀態挑登入版或訪客版傳進來。同一組 baseURL + token 共用同一個實例(見 getPlanAiApiDataSource)。
  const exploreDataSource = getPlanAiApiDataSource(cfg)

  const {
    attractions,
    areaSearch,
    activeCategory,
    handleCategoryClick,
    handleSearchThisArea,
    handleMapIdle,
    suppressNextIdle,
  } = useExploreQueries({
    mapRef,
    dataSource: exploreDataSource,
    zoom,
    city,
    exploreTrigger,
    initialAttractions,
    onSearchStart,
    onGeocodeCandidatesChange,
    onAttractionsChange,
    onCityChange,
    onActiveCategoryChange,
  })

  // idle:拖曳/縮放動畫「結束」時才觸發一次。回報地圖中心,其餘(要不要冒出「搜尋這個區域」按鈕、
  // 程式化平移造成的 idle 要抑制)交給 useExploreQueries 的 handleMapIdle。
  useMapIdle({
    mapRef,
    mapReady,
    onIdle: (center) => {
      if (center) onCenterChangeRef.current?.(center)
      handleMapIdle()
    },
  })

  // 點到地點之後要走哪條路(景點區域光暈、底圖 POI)已抽成 useAttractionClickRouting。
  // handlePoiClick 交給 NativeMapBase 的 onPoiClick;handleAttractionClick 傳給光暈圖層。
  const { handleAttractionClick: handleAttractionClickRouted, handlePoiClick } = useAttractionClickRouting({
    dataSource: exploreDataSource,
    onPoiSelect,
    onAttractionSelect,
    onAttractionOpenPlaceDetails,
    onAttractionOpenPlaceWithoutGoogle,
  })

  // 地圖建好時通知呼叫端(見 onMapReady prop)。
  useEffect(() => {
    if (mapReady) onMapReadyRef.current?.()
  }, [mapReady, mapVersion])

  // 縮放/移動地圖不會自動重查景點區域:一律由探索標籤或「搜尋這個區域」觸發,
  // 與類別標籤的語意一致(使用者要求)。

  // 搜尋結果的鏡頭動作(有定位結果時 fitBounds)不是繪製,留在這裡;結果標記本身由共用子層畫。
  useFitToGeocodeResults({ mapRef, mapReady, results: searchResults })

  // 把地圖移動到呼叫端指定的目標(panTarget)已抽成 usePanTarget,見該檔案的說明。
  usePanTarget({ mapRef, mapReady, panTarget, bounds, zoom, onSuppressIdle: suppressNextIdle, safeAreaRef })

  // 統一繪製層(見 mapDrawLayer/types.ts)。與 /ai-plan 完全相同的部分(目前位置藍點、行程站點圓點、轉乘 hover 虛線、
  // 整條路線,加宿主呼叫)收在 useSharedDrawLayer;登入後另有行程 entry 旗子與搜尋結果標記(只有登入後有資料)
  // 也由共用子層畫;強調色由共用子層自己讀。景點區域光暈(自訂 DOM 疊圖)同樣由共用子層畫,登入後不再有額外的 extraLayers。
  usePlanMapDrawing({
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
    // 行程 entry 旗子與搜尋結果標記只有登入後有資料,/ai-plan 不傳。
    tripEntries: { entries: tripEntries, selectedKey, hoverKey },
    searchResults: { results: searchResults, selectedKey, hoverKey, candidateKeys, onSelect: onSearchResultSelect },
    // 景點區域光暈:詳情與照片走 exploreDataSource(登入版實例,打 /internal)。
    attractionGlow: {
      attractions,
      revealedAttractionNames,
      selectedKey,
      hoverKey,
      candidateKeys,
      hoveredCuratedId,
      onSelect: handleAttractionClickRouted,
      placeDetails: exploreDataSource.geoPlaceDetails,
      photoAssets: exploreDataSource.photoAssets,
    },
  })

  // 控制項渲染位置見 controlsPlacement.ts:inline 原地、hidden 不渲染、否則 portal 到呼叫端 UI 層。
  const controlsPlacement = resolveControlsPlacement(controlsPortalTarget)
  const renderControls = (node: ReactNode): ReactNode => {
    if (controlsPlacement === 'inline') return node
    if (controlsPlacement === 'hidden' || !controlsPortalTarget) return null
    return createPortal(node, controlsPortalTarget)
  }

  return (
    <NativeMapBase
      center={resolveMapCenter(initialCenter)}
      theme={theme}
      restrictBounds={restrictBounds}
      showZoomControl={showZoomControl}
      rebuildOnThemeChange={false}
      preserveViewOnResize
      strictRestriction
      onHandleChange={handleMapHandleChange}
      onPoiClick={handlePoiClick}
    >
      {/* 該範圍查無景點時刻意不蓋遮罩:查無資料是拖到未建檔區域的正常情況,不是搜尋失敗。 */}
      {renderControls(
        <>
      {/* 類別標籤列:疊在左上角,與置中的「搜尋這個區域」分開排版。三顆標籤點下去把標籤文字寫入
          搜尋框並查詢(見 useExploreQueries 的 handleCategoryClick),沒有選取/取消。
          err 存在時不顯示;hideCategoryTags 由呼叫端依 geoCategoryTagsState 算好傳入。 */}
      {!err && !(hideCategoryTags ?? false) && (
        <div className={styles.categoryTags}>
          {CATEGORY_TAGS.map(({ type, label, Icon }) => (
            <button
              key={type}
              type="button"
              className={styles.categoryTag}
              onClick={() => handleCategoryClick(type)}
              title={label}
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          ))}
          {/* 探索標籤:唯一保留 activeCategory「點下去查、再點取消」語意的標籤,查的是自建景點區域
              而非搜尋框路徑,所以不放進 CATEGORY_TAGS。刻意不顯示選取視覺(使用者要求),
              選取邏輯仍在 useExploreQueries。手機版入口改在 phone/Nav,由呼叫端傳 hideExploreTag 隱藏。 */}
          {!hideExploreTag && <ExploreTagButton onClick={() => handleCategoryClick(EXPLORE_CATEGORY)} />}
        </div>
      )}
      {/* 城市搜尋框:疊在右上角,與候選籃側欄的搜尋框共用輸入值與查詢邏輯(見 city/onCityChange prop)。
          PlacePanel/AttractionInfoPanel 往下避開它,因為搜尋框是常駐 UI。呼叫端有接這組 prop 才顯示。 */}
      {!err && onCityChange && onSearch && (
        <div className={styles.citySearch}>
          {onOpenChat && (
            <button
              type="button"
              className={styles.citySearchAiBtn}
              onClick={onOpenChat}
              title="開啟對話(Beta)"
              aria-label="開啟對話(Beta)"
            >
              <Sparkles size={16} aria-hidden="true" />
              {/* BETA 標示:同 desktop/Nav 的 plan-ai 按鈕,功能仍在測試中。 */}
              <span className={styles.citySearchAiBtnBetaTag}>BETA</span>
            </button>
          )}
          <input
            className={styles.citySearchInput}
            type="text"
            inputMode="search"
            enterKeyHint="search"
            placeholder="輸入目的地城市,如「東京」"
            value={city ?? ''}
            onChange={(e) => onCityChange(e.target.value)}
            onKeyDown={(e) => { if (isSubmitEnter(e)) onSearch() }}
          />
          <button
            type="button"
            className={styles.citySearchBtn}
            onClick={onSearch}
            disabled={searching || !(city ?? '').trim()}
            title={searching ? '查詢中…' : '搜尋'}
            aria-label={searching ? '查詢中' : '搜尋'}
          >
            {searching ? (
              <Loader2 size={16} className={styles.citySearchBtnIconLoading} aria-hidden="true" />
            ) : (
              <Search size={16} aria-hidden="true" />
            )}
          </button>
          {searchRightSlot}
        </div>
      )}
      {!err && searchError && <div className={styles.citySearchError}>{searchError}</div>}
      {/* 「搜尋這個區域」:areaDirty(拖曳/縮放過但尚未查新範圍)時顯示,疊在上方置中。
          條件是搜尋框有文字,或探索標籤選中——它同時是兩種查詢的重查入口;
          只看 city 的話,選了探索但搜尋框為空時拖曳地圖就沒有入口能重查景點區域。
          err 存在時不顯示。 */}
      {!err && areaSearch.areaDirty && (!!(city ?? '').trim() || activeCategory === EXPLORE_CATEGORY) && (
        <SearchThisAreaButton onClick={handleSearchThisArea} searching={areaSearch.searching} />
      )}
        </>,
      )}
      {children}
    </NativeMapBase>
  )
}
