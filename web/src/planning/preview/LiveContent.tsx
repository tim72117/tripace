import { lazy, Suspense, useCallback, useState } from 'react'
import { ROUTE_LINE_ENABLED } from '../../DesktopShared'
import { useThemeToggle } from '../../hooks/useThemeToggle'
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from '../../home/SiteNavButtons'
import { trackEvent } from '../../analytics'
import { getPlanAiPublicDataSource } from '../data/public'
import { PlanDataProvider } from '../data/PlanDataProvider'
import { getPlanAiApiDataSource } from '../data/api'
import { BASE_URL } from '../../AppCommon'
import { PlanMap } from './PlanMap'
import { maskPlanStopsView, usePlanStopsState } from '../timeline/usePlanStopsState'
import { useGuestClientConfig } from '../shared/config'
import { useCurrentLocation } from './useCurrentLocation'
import { LivePlanLayer } from './LivePlanLayer'
import type { ToolCallLogEntry } from '../panel/TripPlanPage'
import { PlanLayout } from './PlanLayout'
import { PlanOverlayLayout as PhonePlanOverlayLayout } from './phone/PlanOverlayLayout'
import { PlanOverlayLayout as DesktopPlanOverlayLayout } from './desktop/PlanOverlayLayout'
import { PlanOverlayLayout as WidePlanOverlayLayout } from './wide/PlanOverlayLayout'
import { useIsDesktop } from '../../hooks/useIsDesktop'
import { useIsWide } from '../../hooks/useIsWide'
import { Lightbox } from '../place/PhotoCarousel'
import type { MapHandle } from '../map/NativeMapBase'
const SafeAreaDebugOverlay = lazy(() =>
  import('./SafeAreaDebugOverlay').then((m) => ({ default: m.SafeAreaDebugOverlay })),
)
const WideLayoutDebugOverlay = lazy(() =>
  import('./WideLayoutDebugOverlay').then((m) => ({ default: m.WideLayoutDebugOverlay })),
)
const ToolCallLogDebugOverlay = lazy(() =>
  import('./ToolCallLogDebugOverlay').then((m) => ({ default: m.ToolCallLogDebugOverlay })),
)
import { useMapSafeArea } from '../map/useMapSafeArea'
import { useDesktopStopPan } from '../map/useStopPan'
import { useFirstStopAutoPan } from '../map/useFirstStopAutoPan'
import { SIMPLE_MAP_ID } from '../map/mapStyleIds'

// CENTER/ZOOM——與播放態 Content.tsx 同一組常數(該檔案的完整說明),
// 推論態初次掛載(使用者從播放態交接過來,或直接開這個網址)時地圖要
// 有個起始構圖,理由同播放態。
const CENTER = { lat: 22.9975, lng: 120.1900 }
const ZOOM = 14

// 地圖安全區除錯疊圖——與播放態 Content.tsx 同一個開關/理由,見該檔案
// 的完整說明。
const DEBUG_SAFE_AREA =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debugSafeArea')
const DEBUG_TARGET = { lat: 23.0009, lng: 120.2024 }

// isEmbedded——與播放態 Content.tsx 同一個參數/理由,見該檔案的完整
// 說明。
function isEmbedded(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('embedded') === '1'
}

// planning/preview/LiveContent — 「AI 安排行程」推論態的獨立頁面,路由
// /ai-plan/live(見 App.tsx)。
//
// 2026-10 從 Content.tsx 拆出來(使用者明確要求「把播放態跟推論態頁面
// 分離乾淨,明確的用不同畫面掛載,不要用條件做切換了」):原本播放態
// 與推論態是同一個元件內部用 handedOver state 以三元運算子切換渲染哪
// 一棵子樹,這裡改成兩個真正獨立的路由,交接時
// (見 Content.tsx handover 的完整說明)用 navigate 真的跳轉過來,不是
// 切換同一個元件的內部 state。
//
// 使用者明確表示「對話跟資料都不用傳遞」——這個頁面掛載後完全重新
// 初始化一份狀態,不接收任何從播放態帶過來的參數。時間軸資料本來就是
// 透過 localStoragePlanTimelineStore 持久化(見 LivePlanLayer.tsx 的
// 完整說明),不是靠記憶體傳遞,所以即使整頁重新掛載,使用者在播放態
// 交接那一刻(若播放態本身也排了真實資料,但實際上播放態是純模擬,不
// 會寫進這份共用 store)看到的內容不會無故消失。
//
// 代價(使用者已確認可接受):交接瞬間整頁卸載重掛,地圖重新初始化一次
// (重新讀 tiles、短暫閃爍/重載),不像先前同一元件內共用一份地圖實例
// 那樣交接前後地圖不重建。
export function LiveContent() {
  const publicDataSource = getPlanAiPublicDataSource(BASE_URL)
  return (
    <PlanDataProvider dataSource={publicDataSource}>
      <LiveContentInner />
    </PlanDataProvider>
  )
}

function LiveContentInner() {
  const embedded = isEmbedded()
  const { theme, dark, toggleTheme } = useThemeToggle()
  const isDesktop = useIsDesktop()
  const isWide = useIsWide()

  const live = usePlanStopsState()
  const { selectedStopId, hoverStopId, setSelectedStopId } = live

  const [mapHandle, setMapHandle] = useState<MapHandle>({ mapRef: { current: null }, mapReady: false, mapVersion: 0 })
  const handleMapHandleChange = useCallback((handle: MapHandle) => {
    setMapHandle(handle)
  }, [])
  const mapSafeArea = useMapSafeArea(mapHandle.mapRef)

  const { currentPosition } = useCurrentLocation({ wanted: true })
  const stopsVisible = true
  const visibleStopsView = maskPlanStopsView(
    { stops: live.stops, selectedStopId, hoverStopId, hoverTransitPair: live.hoverTransitPair },
    stopsVisible,
  )
  // expandedThemeId——PlanMap 回報目前展開的主題點,這個頁面目前沒有
  // 消費端讀取它(主題點展開的子景點平移是播放態 Content.tsx 專屬的
  // 概念,見該檔案 expandedThemeChildren 的完整說明),只是 PlanMap
  // 的 onExpandedThemeIdChange prop 需要一個 setter 接住回報。
  const [, setExpandedThemeId] = useState<string | null>(null)

  const layerCfg = useGuestClientConfig()
  const attractionDataSource = layerCfg.token ? getPlanAiApiDataSource(layerCfg) : getPlanAiPublicDataSource(layerCfg.baseURL)

  const firstStopPanAllowed = !isDesktop
  const OverlayLayout = isWide ? WidePlanOverlayLayout : isDesktop ? DesktopPlanOverlayLayout : PhonePlanOverlayLayout
  const mapPanReady = mapHandle.mapReady && !!mapHandle.mapRef.current
  useFirstStopAutoPan({
    stops: live.stops,
    enabled: firstStopPanAllowed,
    ready: mapPanReady,
    pan: mapSafeArea.panToWithinSafeArea,
  })
  const [toolCallLog, setToolCallLog] = useState<ToolCallLogEntry[]>([])

  // panDesktopToStop——桌面版點時間軸站點卡時平移地圖到該站,交給下方
  // LivePlanLayer 的 onPanToStop(座標簽名)。手機版的「移動到此」改走
  // TripPlanPage.tsx 內部自己的 panToStopId(用 mapStops 查座標再呼叫
  // 同一個 onPanToStop,見該處的完整說明),這個頁面不需要像播放態
  // Content.tsx 那樣另外呼叫 usePhoneStopPan/useStopCardClick——那兩個
  // 是播放態「點卡片=選取+平移合一」「手機也要能單獨平移」的機制,推論
  // 態的選取不搶鏡頭(見 TripPlanPage.tsx 既有說明),不適用這裡。
  const { panToStop: panDesktopToStop } = useDesktopStopPan({
    enabled: isDesktop,
    pan: mapSafeArea.panToWithinSafeArea,
  })

  const [lightboxPhotos, setLightboxPhotos] = useState<{ photos: string[]; alt: string } | null>(null)

  const askPageDataSource = getPlanAiPublicDataSource(BASE_URL)

  const navButtons = (
    <>
    <SiteNavBrand pageLabel={undefined} />
    <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
    <SiteNavCta href="/app" onClick={() => trackEvent('landing_cta_click', { page: 'plan-ai-sim', position: 'nav' })}>登入</SiteNavCta>
    </>
  )

  const mapBackground = (
    <>
      <PlanMap
        initialCenter={CENTER}
        zoom={ZOOM}
        mapId={SIMPLE_MAP_ID}
        theme={dark ? 'dark' : 'light'}
        {...visibleStopsView}
        routeSegments={ROUTE_LINE_ENABLED ? live.routeSegments : undefined}
        onStopClick={setSelectedStopId}
        currentPosition={currentPosition}
        liveLayersEnabled
        attractionDataSource={attractionDataSource}
        onExpandedThemeIdChange={setExpandedThemeId}
        onHandleChange={handleMapHandleChange}
      />
      {DEBUG_SAFE_AREA && (
        <Suspense fallback={null}>
          <SafeAreaDebugOverlay
            target={DEBUG_TARGET}
            safeAreaElRef={mapSafeArea.safeAreaElRef}
            mapRef={mapHandle.mapRef}
            mapReady={mapHandle.mapReady}
            onPan={mapSafeArea.panToWithinSafeArea}
            resetView={{ center: CENTER, zoom: ZOOM }}
          />
          <ToolCallLogDebugOverlay log={toolCallLog} />
        </Suspense>
      )}
    </>
  )

  const wideDebugOverlay = DEBUG_SAFE_AREA && isWide ? (
    <Suspense fallback={null}>
      <WideLayoutDebugOverlay />
    </Suspense>
  ) : undefined

  return (
    <>
    <PlanLayout embedded={embedded} theme={theme} nav={navButtons} debugOverlay={wideDebugOverlay}>
    <OverlayLayout
      mapBackground={mapBackground}
      safeAreaRef={mapSafeArea.safeAreaElRef}
      passThrough
    >
      <PlanDataProvider dataSource={askPageDataSource}>
        <LivePlanLayer
          selectedStopId={selectedStopId}
          tripPlanProps={live.tripPlanProps}
          onPanToStop={isDesktop ? panDesktopToStop : mapSafeArea.panToWithinSafeArea}
          onToolCallLogChange={DEBUG_SAFE_AREA ? setToolCallLog : undefined}
        />
      </PlanDataProvider>
    </OverlayLayout>
    </PlanLayout>
    {lightboxPhotos && (
      <Lightbox
        photos={lightboxPhotos.photos}
        alt={lightboxPhotos.alt}
        onClose={() => setLightboxPhotos(null)}
      />
    )}
    </>
  )
}
