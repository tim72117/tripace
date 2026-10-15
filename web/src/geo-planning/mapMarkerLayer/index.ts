// index.ts——useMapMarkerLayer 本體。取代 usePlanStopMarkers.ts +
// useThemeRadiusCircle.ts 兩個原本獨立的 hook,見 types.ts 開頭的完整
// 設計說明(完全受控、supportsHover 開關、雙向事件、pauseAutoPan 防護)。
//
// 2026-10 改版(無限重渲染迴圈修正,見 types.ts 開頭的完整說明):拿掉
// 原本的 useReducer 內部狀態機,selectedId/hoverId 完全由外部 props
// 决定,這個 hook 内部不再持有任何「選取/hover 結果」的 state——只剩
// expandedThemeId 是用 useMemo 從 selectedId+points 算出的純衍生值。
// 使用者點擊/hover 地圖上的點時,只呼叫 onPointClick/onSelectedChange/
// onHoverChange 把意圖往外送,不自己改變任何內部狀態,因此這個 hook
// 內部完全沒有「狀態改變→通知外部→外部寫回→又變成新輸入」這個環的
// 任何一個環節存在的空間。
//
// 內部繪圖邏輯(planStopMarkerContent/svgStringToElement)直接複用
// mapMarkers.ts 既有的純函式,這次重構的範圍是「狀態怎麼管理、各種點的
// 行為怎麼收斂成一致介面」,不是重寫繪圖本身——繪圖邏輯本身沒有已知
// 問題,不需要動。
//
// 範圍圓圈/子景點小點(PlanStopOverlay 不支援的部分)仍然固定用
// google.maps.Circle + AdvancedMarkerElement,對齊 useThemeRadiusCircle.ts
// 原本的既有限制(見該檔案開頭「無法在 hand-drawn 地圖上使用」的完整
// 說明)——這是本次重構盤點時列出的已知功能缺口,不在這次的修正範圍,
// 等真的有 hand-drawn 地圖需要主題點功能時再處理 PlanStopOverlay 等效
// 版本的範圍圓圈/子景點小點繪製。

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { planStopMarkerContent, type PlanStopMarkerState } from '../mapMarkers'
import { getPlanStopOverlayClass, type PlanStopOverlayInstance } from '../planStopOverlay'
import { resolveExpandedThemeId } from './reducer'
import type { MapMarkerLayerProps } from './types'

export type { MapMarkerLayerProps, MapMarkerPoint, MapPointKind, MapMarkerChildPoint, HoverTransitPair } from './types'

const THEME_RADIUS_METERS = 200

type AnyMarker = google.maps.marker.AdvancedMarkerElement | PlanStopOverlayInstance

function zIndexForState(state: PlanStopMarkerState): number | null {
  if (state === 'hover') return 999
  if (state === 'selected') return 998
  return null
}

function setMarkerZIndex(marker: AnyMarker, zIndex: number | null) {
  if ('setZIndex' in marker) {
    ;(marker as PlanStopOverlayInstance).setZIndex(zIndex)
  } else {
    ;(marker as google.maps.marker.AdvancedMarkerElement).zIndex = zIndex ?? undefined
  }
}

export function useMapMarkerLayer({
  mapRef,
  mapReady,
  points,
  useAdvancedMarkers = true,
  selectedId: selectedIdProp,
  hoverId: hoverIdProp,
  hoverTransitPair,
  supportsHover = true,
  autoPanOnSelect = false,
  pauseAutoPan = false,
  onPointClick,
  onSelectedChange,
  onHoverChange,
}: MapMarkerLayerProps) {
  // 完全受控——selectedId/hoverId 直接讀 props,省略視同 null。
  // supportsHover:false 時 hoverId 恆為 null(見 types.ts supportsHover
  // 的完整說明),不依賴呼叫端省略 hoverId prop。
  const selectedId = selectedIdProp ?? null
  const hoverId = supportsHover ? (hoverIdProp ?? null) : null

  // 只取 kind !== 'themeChild' 的點建立一般 marker——子景點完全由
  // circleRef/childMarkersRef(下方範圍圓圈區塊)另外處理,不混進這份
  // 清單(對齊 useThemeRadiusCircle.ts 原本「子景點不再混進這份清單跟
  // 主題點用同一套圓點樣式」的既有設計決定,見 AIPlanTimelinePage.tsx
  // stops useMemo 的完整說明)。
  const markerPoints = points.filter((p) => p.kind !== 'themeChild')

  const markersRef = useRef<Map<string, AnyMarker>>(new Map())
  const stateRef = useRef<Map<string, PlanStopMarkerState>>(new Map())
  const circleRef = useRef<google.maps.Circle | null>(null)
  const childMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([])

  // pointsKey——陣列/物件每次呼叫端 render 都可能是新參照,直接放進
  // 依賴陣列會讓 effect 每次 render 都重跑,對齊 usePlanStopMarkers.ts
  // stopsKey 的既有慣例。含 children 內容(id/lat/lng),children 非同步
  // 晚到補上時也能被偵測到。
  const pointsKey = markerPoints
    .map((p) => `${p.id}|${p.lat}|${p.lng}|${p.name ?? ''}|${p.kind}|${(p.children ?? []).map((c) => `${c.id}:${c.lat}:${c.lng}`).join(';')}`)
    .join(',')
  const hoverTransitKey = hoverTransitPair ? `${hoverTransitPair.fromId}|${hoverTransitPair.toId}` : ''

  // expandedThemeId——純衍生值(見 reducer.ts resolveExpandedThemeId 的
  // 完整說明),不是 state,每次 selectedId/points 內容真的變動時才重算。
  const expandedThemeId = useMemo(() => resolveExpandedThemeId(selectedId, markerPoints), [selectedId, pointsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // handleMarkerClick——使用者點擊地圖上的一個點:只呼叫
  // onPointClick/onSelectedChange 把意圖往外送(2026-10 改版,見 types.ts
  // 開頭的完整說明:不再自己 dispatch 任何內部狀態,selectedId 完全由
  // 呼叫端決定要不要更新、傳回來)。
  const handleMarkerClick = useCallback(
    (id: string) => {
      const point = markerPoints.find((p) => p.id === id)
      if (point) onPointClick?.(id, point)
      onSelectedChange?.(id)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pointsKey, onPointClick, onSelectedChange],
  )

  // handleMarkerClickRef——marker 建立 effect 的依賴陣列只有
  // [mapReady, pointsKey, useAdvancedMarkers],不含 handleMarkerClick
  // 本身(刻意,否則 onPointClick/onSelectedChange 參照每次改變就會
  // 導致整批 marker 重建閃爍)。但 addListener('gmp-click', () =>
  // handleMarkerClick(p.id)) 這一行若直接閉包捕捉建立當下的
  // handleMarkerClick,之後回調變新版時,已經建立好的 marker 監聽器
  // 仍然呼叫得到舊版——若呼叫端用 inline arrow function 當
  // onPointClick(每次 render 都是新參照、內部讀最新 state),點擊
  // 永遠讀到舊的閉包值。改成透過 ref 間接呼叫,監聽器本身不用重新
  // 綁定,但永遠執行的是最新一次 render 產生的 handleMarkerClick。
  const handleMarkerClickRef = useRef(handleMarkerClick)
  handleMarkerClickRef.current = handleMarkerClick

  // resolveState——把「這一點在當下是什麼視覺狀態」的規則收斂成一處,
  // 建立 effect 與同步 effect 共用,對齊 usePlanStopMarkers.ts
  // resolveState 的既有設計(避免兩邊各寫一次 selected 優先的判斷而
  // 漂移)。supportsHover 為 false 時,hoverId 已經在上方被強制收斂成
  // null,這裡維持單純查值即可,不需要再判斷一次 supportsHover。
  const resolveState = useCallback(
    (id: string): PlanStopMarkerState => {
      if (id === selectedId) return 'selected'
      const viaTransitPair = supportsHover && (hoverTransitPair?.fromId === id || hoverTransitPair?.toId === id)
      return id === hoverId || viaTransitPair ? 'hover' : 'base'
    },
    [selectedId, hoverId, supportsHover, hoverTransitPair],
  )

  // 建立 effect——pointsKey/useAdvancedMarkers 改變時整批重建,對齊
  // usePlanStopMarkers.ts 的既有做法(含 zIndex 建立時就帶上、
  // gmpClickable 固定開啟、entering=false 避免重建誤播進場動畫等細節,
  // 完整理由見該檔案對應段落——這裡行為對齊,不重新論證)。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const map = mapRef.current

    markersRef.current.forEach((m) => {
      google.maps.event.clearInstanceListeners(m)
      if ('setMap' in m) m.setMap(null)
      else (m as google.maps.marker.AdvancedMarkerElement).map = null
    })
    markersRef.current = new Map()
    stateRef.current = new Map()

    const mapDiv = map.getDiv()
    const accentColor = getComputedStyle(mapDiv).getPropertyValue('--color-accent').trim() || '#8B3A2F'

    const nextMarkers = new Map<string, AnyMarker>()
    const nextStates = new Map<string, PlanStopMarkerState>()

    for (const p of markerPoints) {
      const initialState = resolveState(p.id)
      nextStates.set(p.id, initialState)
      if (useAdvancedMarkers) {
        const marker = new google.maps.marker.AdvancedMarkerElement({
          position: { lat: p.lat, lng: p.lng },
          map,
          title: p.name,
          content: planStopMarkerContent(initialState, accentColor, false, p.glyph, p.size),
          zIndex: zIndexForState(initialState) ?? undefined,
          gmpClickable: true,
        })
        marker.addListener('gmp-click', () => handleMarkerClickRef.current(p.id))
        nextMarkers.set(p.id, marker)
      } else {
        const OverlayClass = getPlanStopOverlayClass()
        const marker = new OverlayClass(new google.maps.LatLng(p.lat, p.lng), p.name, () => handleMarkerClickRef.current(p.id))
        marker.setState(initialState, false, accentColor, p.glyph, p.size ?? 14)
        marker.setZIndex(zIndexForState(initialState))
        marker.setMap(map)
        nextMarkers.set(p.id, marker)
      }
    }

    markersRef.current = nextMarkers
    stateRef.current = nextStates

    return () => {
      nextMarkers.forEach((m) => {
        google.maps.event.clearInstanceListeners(m)
        if ('setMap' in m) m.setMap(null)
        else (m as google.maps.marker.AdvancedMarkerElement).map = null
      })
      markersRef.current = new Map()
      stateRef.current = new Map()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, pointsKey, useAdvancedMarkers])

  // 同步 effect——選取/hover 狀態變動時只切換已存在 marker 的視覺,不
  // 重建整批(避免閃爍),對齊 usePlanStopMarkers.ts 的既有做法。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const map = mapRef.current
    const mapDiv = map.getDiv()
    const accentColor = getComputedStyle(mapDiv).getPropertyValue('--color-accent').trim() || '#8B3A2F'

    for (const p of markerPoints) {
      const marker = markersRef.current.get(p.id)
      if (!marker) continue
      const next = resolveState(p.id)
      const prev = stateRef.current.get(p.id) ?? 'base'
      if (prev === next) continue
      stateRef.current.set(p.id, next)
      const entering = prev === 'base'
      if ('content' in marker) {
        ;(marker as google.maps.marker.AdvancedMarkerElement).content = planStopMarkerContent(next, accentColor, entering, p.glyph, p.size)
      } else {
        ;(marker as PlanStopOverlayInstance).setState(next, entering, accentColor, p.glyph, p.size ?? 14)
      }
      setMarkerZIndex(marker, zIndexForState(next))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, selectedId, hoverId, hoverTransitKey, pointsKey])

  // 範圍圓圈+子景點小點——對齊 useThemeRadiusCircle.ts 的既有做法(固定
  // 半徑、原生 google.maps.Circle、子景點純展示無點擊),差異只在
  // center/children 不再由外部算好傳入,改由 expandedThemeId 從 points
  // 本身查出對應的主題點(見 reducer.ts resolveExpandedThemeId 的完整
  // 說明)。
  const expandedThemePoint = expandedThemeId != null ? points.find((p) => p.id === expandedThemeId) : undefined
  const centerKey = expandedThemePoint ? `${expandedThemePoint.lat}|${expandedThemePoint.lng}` : ''
  const childrenKey = (expandedThemePoint?.children ?? []).map((c) => `${c.id}|${c.lat}|${c.lng}`).join(',')

  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const map = mapRef.current

    circleRef.current?.setMap(null)
    circleRef.current = null
    childMarkersRef.current.forEach((m) => {
      google.maps.event.clearInstanceListeners(m)
      m.map = null
    })
    childMarkersRef.current = []

    if (!expandedThemePoint) return

    const mapDiv = map.getDiv()
    const accentColor = getComputedStyle(mapDiv).getPropertyValue('--color-accent').trim() || '#8B3A2F'

    circleRef.current = new google.maps.Circle({
      map,
      center: { lat: expandedThemePoint.lat, lng: expandedThemePoint.lng },
      radius: THEME_RADIUS_METERS,
      strokeColor: accentColor,
      strokeOpacity: 0.5,
      strokeWeight: 1.5,
      fillColor: accentColor,
      fillOpacity: 0.12,
      clickable: false,
    })

    childMarkersRef.current = (expandedThemePoint.children ?? []).map((child) => {
      const dot = document.createElement('div')
      dot.style.width = '10px'
      dot.style.height = '10px'
      dot.style.borderRadius = '50%'
      dot.style.background = accentColor
      dot.style.border = '2px solid #FDFCFA'
      dot.style.boxShadow = '0 1px 3px rgba(0,0,0,0.25)'
      return new google.maps.marker.AdvancedMarkerElement({
        position: { lat: child.lat, lng: child.lng },
        map,
        title: child.name,
        content: dot,
      })
    })

    return () => {
      circleRef.current?.setMap(null)
      circleRef.current = null
      childMarkersRef.current.forEach((m) => {
        google.maps.event.clearInstanceListeners(m)
        m.map = null
      })
      childMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, centerKey, childrenKey])

  // panTo——selectedId 改變時移動地圖中心過去,只在 autoPanOnSelect 為
  // true 時啟用,且 pauseAutoPan 為 true 時整個跳過(不搶走使用者正在
  // 手動操作的畫面)。見 types.ts pauseAutoPan 的完整說明:取代原本
  // AIPlanTimelinePage.tsx panTo effect 完全沒有這道防護的狀態——這正是
  // 「選擇群組卡片時被自動捲走」「使用者拉動到其他卡片時不該被搶回
  // 最新」這類問題的根治處,不是個別頁面各自補一塊 ref 判斷。
  useEffect(() => {
    if (!autoPanOnSelect) return
    if (pauseAutoPan) return
    if (!mapReady || !mapRef.current) return
    if (selectedId == null) return
    // 先查一般點,查不到再查展開中主題點的子景點(對齊
    // AIPlanTimelinePage.tsx 原本 panTo effect 的既有查詢順序,涵蓋
    // selectedId 剛好是子景點 id 的情況)。
    const point = points.find((p) => p.id === selectedId)
    const target = point
      ? { lat: point.lat, lng: point.lng }
      : (() => {
          const child = expandedThemePoint?.children?.find((c) => c.id === selectedId)
          return child ? { lat: child.lat, lng: child.lng } : null
        })()
    if (!target) return
    mapRef.current.panTo(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPanOnSelect, pauseAutoPan, mapReady, selectedId, pointsKey, centerKey])

  return {
    selectedId,
    hoverId,
    expandedThemeId,
    /** select/hover/clearSelection——供呼叫端用程式化方式(非使用者點擊
     *  marker 本身)觸發「意圖通知」,例如使用者捲動手機版橫向卡片列
     *  置中新卡片時,呼叫端要主動把這個選取意圖餵進來(對齊
     *  HorizontalPlanTimeline.tsx handleScroll「捲動置中即等同選取」的
     *  既有語意)。
     *
     *  2026-10 改版:這三個方法本身不再直接改變任何內部狀態(因為已經
     *  沒有內部狀態可以改了),純粹是 onSelectedChange/onHoverChange
     *  的語意化捷徑——select(id) 等同呼叫 onSelectedChange?.(id),
     *  clearSelection() 等同 onSelectedChange?.(null)。保留這三個
     *  方法是為了讓呼叫端寫「捲動置中→select(id)」時語意清楚,不用
     *  自己想「這個情境該呼叫哪個 on 開頭的回調」。 */
    select: useCallback((id: string) => onSelectedChange?.(id), [onSelectedChange]),
    hover: useCallback(
      (id: string | null) => {
        if (!supportsHover) return
        onHoverChange?.(id)
      },
      [supportsHover, onHoverChange],
    ),
    clearSelection: useCallback(() => onSelectedChange?.(null), [onSelectedChange]),
  }
}
