import { useEffect, useRef } from 'react'
import type { PlanStopMarker } from './usePlanStopMarkers'

// usePlanRouteLine——「規劃行程」標頭列路徑開關開啟時,在地圖上依時間軸
// 順序把所有已排入的景點連成一條完整路線(2026-10 新增,使用者明確要求
// 「登入後的介面規劃行程標頭列加上開關路徑的icon,打開時,地圖上顯示
// 所有點的線斷」「按時間軸順序,把所有已排入的景點一条線依序連起來
// (完整路線),不只是相鄰兩點」)。
//
// 跟 usePlanTransitHoverLine(hover 交通膠囊時只畫「這一段」兩點虛線)
// 是兩個獨立的圖層,不合併——一個是使用者主動切換的持續狀態(開關),
// 一個是滑鼠懸停時的暫時提示,觸發時機/生命週期完全不同,合併只會讓
// 單一 hook 要同時處理兩種截然不同的語意,更難讀。兩者的 Polyline
// 也各自是獨立實例,不互相干擾、可以同時存在(例如開啟路徑開關的同時
// 又去 hover 某個交通膠囊,會看到一條實線貫穿全程、一條虛線疊加在局部
// 兩站之間)。
//
// stops 的連線順序就是陣列本身的順序(呼叫端——DesktopLayout.tsx——
// 傳入時已經是依時間軸排列的站點清單,這裡不重新排序,也不需要知道
// 「時間軸順序」這個概念從何而來)。
//
// 用單一 google.maps.Polyline 實例重用,不是每次 stops 變動都新建一個
// ——regenerate 腳本持續生成新站點時這個陣列變動頻繁,重複建立/銷毀
// Polyline 物件沒有必要的開銷。
export function usePlanRouteLine({
  mapRef,
  mapReady,
  stops,
  enabled,
  mapVersion = 0,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  stops: PlanStopMarker[]
  enabled: boolean
  // mapVersion:理由同 usePlanStopMarkers / usePlanTransitHoverLine 的
  // 同名參數——地圖實例重建(明暗模式切換)後,綁在舊實例上的 Polyline
  // 不會自己接到新地圖,不重跑 effect 的話路徑線在切換主題後就消失,
  // 而且因為 enabled/stopsKey 都沒變,使用者不關掉再開就叫不回來。
  mapVersion?: number
}) {
  const polylineRef = useRef<google.maps.Polyline | null>(null)

  // stopsKey——2026-10 修正(code review 發現跟同批次 usePlanStopMarkers.ts
  // 的 stopsKey 寫法不一致):stops 陣列每次父層 render 都是新參照(呼叫端
  // DesktopLayout.tsx 傳入時常是 `chatPopoverVisible ? planStops : []`
  // 這種每次都重新求值的表達式),直接放進下方 effect 的依賴陣列,會讓
  // 小匡關閉期間(stops 固定是 `[]`,內容從未真的改變)每次父層重渲染都
  // 多跑一次這個 effect——雖然 enabled/stops.length<2 的 guard 會讓它
  // 立刻 return、不影響功能正確性,但仍是多餘的執行,改用內容摘要字串
  // 判斷「是否真的變了」,理由同 usePlanStopMarkers.ts stopsKey 的完整
  // 說明。
  const stopsKey = stops.map((s) => `${s.id}|${s.lat}|${s.lng}`).join(',')

  useEffect(() => {
    if (!mapReady || !mapRef.current) return

    if (!enabled || stops.length < 2) {
      // 關閉,或不足兩個點連不成線——隱藏既有的 Polyline(setMap(null)),
      // 不整個銷毀重建,理由同 usePlanTransitHoverLine 的完整說明。
      if (polylineRef.current) polylineRef.current.setMap(null)
      return
    }

    const path = stops.map((s) => ({ lat: s.lat, lng: s.lng }))

    // accentColor——讀法同 usePlanStopMarkers.ts/usePlanTransitHoverLine.ts
    // 的既有慣例:--color-accent 掛在 .app-theme-root 上,必須讀地圖容器
    // (子孫節點)的 computed style 才拿得到主題覆寫後的值,不能寫死
    // 顏色常數。
    const mapDiv = mapRef.current.getDiv()
    const accentColor = getComputedStyle(mapDiv).getPropertyValue('--color-accent').trim() || '#8B3A2F'

    if (!polylineRef.current) {
      // 這裡用實線(不像 usePlanTransitHoverLine 的虛線)——完整路線是
      // 持續開啟的狀態,實線在視覺上更明確表達「這是已確定的路徑」,
      // 虛線通常用來表達暫時性/提示性的連接(hover 當下才看得到的
      // 兩點關係)。strokeWeight/strokeOpacity 用中等粗細與不透明度,
      // 蓋過地圖底圖但不要蓋過上層的 marker 本身。
      polylineRef.current = new google.maps.Polyline({
        strokeColor: accentColor,
        strokeOpacity: 0.85,
        strokeWeight: 3,
        zIndex: 996,
      })
    } else {
      // 既有實例重用時,顏色也要跟著當下的主題重新套用——理由同
      // usePlanTransitHoverLine 的完整說明。
      polylineRef.current.set('strokeColor', accentColor)
    }
    polylineRef.current.setPath(path)
    polylineRef.current.setMap(mapRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mapVersion, enabled, stopsKey])

  useEffect(() => {
    return () => {
      if (polylineRef.current) {
        polylineRef.current.setMap(null)
        polylineRef.current = null
      }
    }
  }, [])
}
