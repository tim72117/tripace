import { useEffect, useRef } from 'react'

// RoutePolylineSegment——一條路徑線段(2026-10 新增,使用者分享一張步道
// 導覽圖參考圖,要求「繪製像這樣的路徑」,先做視覺雛形版本:直線連接
// 站點,不打 Routes API 算真實道路路徑——那部分留待視覺方向確認後再
// 串接,見 pace_route.go 既有的 computeRouteByWaypoints 機制)。
//
// 依「天」分段(day 1 一條、day 2 一條...),不是整趟行程一條單一路徑
// ——多日行程裡,前一天最後一站到隔天第一站之間通常是「回飯店過夜、
// 隔天從飯店重新出發」,不是連續移動的路徑,連一條線容易誤導成「使用者
// 走了這段路」。顏色依 dayIndex 輪替(見 ROUTE_COLORS 的完整說明),呼應
// 使用者分享的參考圖用不同顏色區分路段的做法。
export interface RoutePolylineSegment {
  dayIndex: number
  path: { lat: number; lng: number }[]
}

// ROUTE_COLORS——依 dayIndex 輪替的路徑顏色,固定兩色循環(超過兩天的
// 行程,第三天會重複用回第一色)——這個雛形階段不需要支援任意天數的
// 獨立配色,兩色已經足夠表達「不同天的路段用不同顏色區分」這個核心
// 概念,呼應參考圖的藍/橘雙色路段。色值沿用這個子系統既有的暖色調
// 方向(#d88f45 焦糖橘)搭配一個對比的藍(#4a7fb5),不是參考圖原始的
// 飽和藍橘配色——保持跟卡片/地圖整體配色一致,不是另外發明一套。
const ROUTE_COLORS = ['#d88f45', '#4a7fb5']

// usePlanRoutePolyline——把一組 RoutePolylineSegment 畫成地圖上的
// google.maps.Polyline 圖層。結構比照 usePlanStopMarkers(同一份
// mapRef/mapReady 驅動,segments 內容變動時整批重建,unmount 時清除)
// ——這是純粹的「畫圖層」hook,不處理互動(沒有 hover/click,路徑線
// 本身不是可選取的實體,跟站點 marker 不同)。
export function usePlanRoutePolyline({
  mapRef,
  mapReady,
  mapVersion = 0,
  segments,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  // mapVersion:地圖實例每重建一次(例如明暗模式切換)就遞增,見
  // NativeMapBase MapHandle.mapVersion。必須列進 effect 依賴——重建後
  // mapRef.current 是新實例,舊實例上的圖層隨之失效,但 mapReady 不一定
  // 出現 false→true 的邊緣,只靠 mapReady 會讓路徑/站點不會重畫到新地圖上。
  mapVersion?: number
  segments: RoutePolylineSegment[]
}) {
  const polylinesRef = useRef<google.maps.Polyline[]>([])
  // segmentsKey——同 usePlanStopMarkers 的 stopsKey,segments 陣列本身
  // 每次 render 可能是新參照,用內容摘要當依賴避免不必要的重建。
  const segmentsKey = segments
    .map((seg) => `${seg.dayIndex}:${seg.path.map((p) => `${p.lat},${p.lng}`).join('|')}`)
    .join(';')

  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const map = mapRef.current

    polylinesRef.current.forEach((p) => p.setMap(null))
    polylinesRef.current = []

    for (const seg of segments) {
      if (seg.path.length < 2) continue
      const polyline = new google.maps.Polyline({
        path: seg.path,
        map,
        strokeColor: ROUTE_COLORS[seg.dayIndex % ROUTE_COLORS.length],
        strokeOpacity: 0.85,
        strokeWeight: 4,
        // icons——沿路徑疊箭頭符號表達方向性(呼應參考圖路徑線上的
        // 方向箭頭),repeat 固定間距重複畫出,不需要精確定位。
        icons: [
          {
            icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2.6, strokeColor: '#fff', strokeWeight: 1.2 },
            offset: '50%',
            repeat: '120px',
          },
        ],
      })
      polylinesRef.current.push(polyline)
    }

    return () => {
      polylinesRef.current.forEach((p) => p.setMap(null))
      polylinesRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mapVersion, segmentsKey])
}
