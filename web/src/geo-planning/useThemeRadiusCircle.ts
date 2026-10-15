import { useEffect, useRef } from 'react'

// useThemeRadiusCircle——2026-10 新增(使用者明確要求「主題點」概念:
// 「點選聚合點時,原本的點變成一個範圍圈圈,顯示圈圈內的地點小點」)。
//
// 跟 usePlanStopMarkers(一般站點的強調圓點圖層)刻意分成獨立的 hook,
// 不是塞進同一套 marker 清單——子景點不應該跟其他真正獨立佔用時間軸
// 時間點的站點共用同一套「強調圓點」視覺語言,而是要清楚傳達「這是
// 主題點展開後的範圍,圈圈內是它涵蓋的小地方」,視覺層級跟一般站點不同
// (範圍圓圈本身就是一個新的視覺元素,一般站點圓點沒有)。
//
// 半徑用固定數值(見 THEME_RADIUS_METERS),不是動態涵蓋子景點實際座標
// 算出的最小外接圓——使用者明確要求「圓心用主題卡坐標,半徑固定數值」
// ,理由是這些子景點本身步行距離都在 5 分鐘內(模擬腳本敘述),固定
// 半徑已經足夠表達「這是一小片緊鄰範圍」的語意,不需要動態計算的複雜度
// 。
//
// 用原生 google.maps.Circle(而非 useAttractionOverlays.ts 那套自製
// OverlayView 類別)——使用者明確要求用原生元件,這個展示頁本身也沒有
// 主題介紹頁那麼複雜的「縮圖疊層+hover/selected 多態切換」需求,原生
// Circle 內建、不需要額外的 overlay 類別就能滿足「畫一個半透明範圍圈」
// 這個單純需求。

// THEME_RADIUS_METERS——範圍圓圈的固定半徑(公尺)。
const THEME_RADIUS_METERS = 200

export interface ThemeChildPoint {
  id: string
  lat: number
  lng: number
  name?: string
}

export function useThemeRadiusCircle({
  mapRef,
  mapReady,
  // center——目前展開中的主題點座標,null 代表沒有任何主題點展開,整個
  // 圖層(範圍圓圈+子景點小點)都不畫。
  center,
  children,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  center: { lat: number; lng: number } | null
  children: ThemeChildPoint[]
}) {
  const circleRef = useRef<google.maps.Circle | null>(null)
  const childMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([])

  // centerKey/childrenKey——center 物件跟 children 陣列每次呼叫端 render
  // 都可能是新參照(即使內容相同),直接放進依賴陣列會讓這個 effect 在
  // 每次 render 都重畫一次圓圈/小點,理由同 usePlanStopMarkers.ts
  // stopsKey 的既有說明。
  const centerKey = center ? `${center.lat}|${center.lng}` : ''
  const childrenKey = children.map((c) => `${c.id}|${c.lat}|${c.lng}`).join(',')

  useEffect(() => {
    if (!mapReady || !mapRef.current) return

    // 先清掉上一輪的圓圈與小點,理由同 usePlanStopMarkers.ts 的既有做法
    // ——重建頻率高(展開/收合、捲動切換不同主題點都會觸發),不清乾淨
    // 會累積棄置但仍附著在地圖上的實例。
    circleRef.current?.setMap(null)
    circleRef.current = null
    childMarkersRef.current.forEach((m) => {
      google.maps.event.clearInstanceListeners(m)
      m.map = null
    })
    childMarkersRef.current = []

    if (!center) return

    const mapDiv = mapRef.current.getDiv()
    const accentColor = getComputedStyle(mapDiv).getPropertyValue('--color-accent').trim() || '#8B3A2F'

    circleRef.current = new google.maps.Circle({
      map: mapRef.current,
      center,
      radius: THEME_RADIUS_METERS,
      strokeColor: accentColor,
      strokeOpacity: 0.5,
      strokeWeight: 1.5,
      fillColor: accentColor,
      fillOpacity: 0.12,
      // clickable: false——這個圓圈本身是純視覺的範圍提示,不該攔截底下
      // 子景點小點或地圖本身的點擊事件。
      clickable: false,
    })

    childMarkersRef.current = children.map((child) => {
      const dot = document.createElement('div')
      // 子景點小點——比一般站點的強調圓點更小更簡化(6px 實心點+白色
      // 描邊),對齊「圈圈內的地點小點」這個語意:它們是範圍圓圈附屬的
      // 次要資訊,不該搶過主題點本身或圓圈的視覺重量。
      dot.style.width = '10px'
      dot.style.height = '10px'
      dot.style.borderRadius = '50%'
      dot.style.background = accentColor
      dot.style.border = '2px solid #FDFCFA'
      dot.style.boxShadow = '0 1px 3px rgba(0,0,0,0.25)'
      return new google.maps.marker.AdvancedMarkerElement({
        position: { lat: child.lat, lng: child.lng },
        map: mapRef.current!,
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
}
