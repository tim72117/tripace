import { useEffect, useRef } from 'react'
import type { PlanStopMarker } from './usePlanStopMarkers'

// usePlanTransitHoverLine——滑鼠懸停在時間軸「交通膠囊」上時,在地圖上
// 畫一條連接這段交通兩端站點的虛線(2026-10 新增,使用者明確要求「移動
// 到交通的膠囊上,地圖上讓連接的兩個點都顯示 hover 狀態,並用虛線做
// 連線」)。兩端點本身的 hover 強調態由 usePlanStopMarkers 的
// hoverTransitPair 參數負責(同一個 pair 來源,兩個 hook 各自畫各自的
// 圖層,不合併成一個——理由同這個資料夾一貫的做法:marker 圖層跟線段
// 圖層是不同種類的 Google Maps 物件,職責分開比塞進同一個 hook 清楚)。
//
// 用單一 google.maps.Polyline 實例重用,不是每次 hover 變動都新建一個
// ——hover 進出的頻率可能很高(滑鼠快速掃過多個交通膠囊),重複
// 建立/銷毀 Polyline 物件沒有必要的開銷。
export function usePlanTransitHoverLine({
  mapRef,
  mapReady,
  stops,
  hoverTransitPair,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  stops: PlanStopMarker[]
  hoverTransitPair?: { fromId: string; toId: string } | null
}) {
  const polylineRef = useRef<google.maps.Polyline | null>(null)

  useEffect(() => {
    if (!mapReady || !mapRef.current) return

    if (!hoverTransitPair) {
      // 沒有 hover 中的交通段——隱藏既有的 Polyline(setMap(null)),不
      // 整個銷毀重建。放開/移出交通膠囊的頻率可能很高,留著實例重用
      // 比每次都 new 一個再丟棄更省。注意 Polyline 是用 setMap()
      // 方法,不是 AdvancedMarkerElement 那種 .map 屬性賦值(兩者是
      // Maps JS API 裡不同世代的物件,API 形狀不同)。
      if (polylineRef.current) polylineRef.current.setMap(null)
      return
    }

    const fromStop = stops.find((s) => s.id === hoverTransitPair.fromId)
    const toStop = stops.find((s) => s.id === hoverTransitPair.toId)
    // 找不到任一端的座標——理論上不該發生(呼叫端只會對畫面上正在渲染、
    // 已經有座標的站點觸發 hover),防禦性地隱藏線段而非畫一條接到
    // (0,0) 的錯誤線段。
    if (!fromStop || !toStop) {
      if (polylineRef.current) polylineRef.current.setMap(null)
      return
    }

    const path = [
      { lat: fromStop.lat, lng: fromStop.lng },
      { lat: toStop.lat, lng: toStop.lng },
    ]

    // accentColor——讀法同 usePlanStopMarkers.ts 的既有慣例:
    // --color-accent 掛在 .app-theme-root 上,必須讀地圖容器(子孫節點)
    // 的 computed style 才拿得到主題覆寫後的值,不能寫死顏色常數。
    const mapDiv = mapRef.current.getDiv()
    const accentColor = getComputedStyle(mapDiv).getPropertyValue('--color-accent').trim() || '#8B3A2F'

    if (!polylineRef.current) {
      // icons 搭配 strokeOpacity:0 畫出虛線效果——Google Maps 的
      // Polyline 本身沒有原生的「dashed」線型選項,官方文件記載的標準
      // 做法就是把實際的 stroke 關閉透明度、改用沿路徑重複鋪 icon
      // (這裡用一個很短的實線 symbol 當「虛線的一截」)達成視覺上的
      // 虛線,這是業界/官方範例的既有慣例寫法,不是這裡自創的技巧。
      polylineRef.current = new google.maps.Polyline({
        strokeOpacity: 0,
        icons: [
          {
            icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: accentColor, scale: 3 },
            offset: '0',
            repeat: '12px',
          },
        ],
        zIndex: 997,
      })
    } else {
      // 既有實例重用時,顏色也要跟著當下的主題重新套用——深色/淺色模式
      // 切換時 --color-accent 的值會不同,若不更新,已經建立過一次的
      // Polyline 會停留在建立當下的舊顏色。
      polylineRef.current.set('icons', [
        {
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: accentColor, scale: 3 },
          offset: '0',
          repeat: '12px',
        },
      ])
    }
    polylineRef.current.setPath(path)
    polylineRef.current.setMap(mapRef.current)
  }, [mapReady, hoverTransitPair?.fromId, hoverTransitPair?.toId, stops])

  useEffect(() => {
    return () => {
      if (polylineRef.current) {
        polylineRef.current.setMap(null)
        polylineRef.current = null
      }
    }
  }, [])
}
