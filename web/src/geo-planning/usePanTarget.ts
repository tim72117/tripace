import { useEffect } from 'react'
import { minZoomForLevel } from './geoAttractionOverlay'
import { panMapTo } from './panMapTo'

// usePanTarget——掛載式 hook:把地圖移動到呼叫端指定的目標(panTarget)。
// 從 PlanMap 的 panTarget effect 原樣抽出(2026-10)。
//
// 點擊飯店/地點側欄的項目時,把地圖移動到該座標。panTo 一律執行(平移);只有點擊「地點」
// 帶了 level(飯店沒有 level 概念)、且目前 zoom 太小、看不到該分級的地點時,才額外把 zoom
// 拉到 minZoomForLevel(level)——用 setZoom 而非動畫方法,是因為只需要跳到剛好能顯示的最小
// 尺度;若目前 zoom 已經足夠(使用者已經拉近在瀏覽細節),不動 zoom、只平移,尊重使用者當下的
// 瀏覽尺度。panTarget 為 null 時不做任何事。
//
// onSuppressIdle:帶 suppressQuery 的目標,在移動前通知呼叫端「下一次 idle 是程式化平移造成的,
// 不要冒出搜尋這個區域按鈕」。這裡是唯一主動呼叫 panTo/fitBounds 的地方,由這裡負責通知最直接,
// 不需要在 idle 那端猜測「這次移動是不是由 panTarget 造成的」。
//
// 依賴 panTarget 的物件參照(而非拆開比較 lat/lng)判斷「是否為新的移動請求」,前提是呼叫端已
// 用 useMemo 依實際座標值快取、座標沒變時不會產生新物件。否則任何造成重渲染的動作都會被誤判成新
// 的移動請求,曾經因此形成「渲染 → panTo → idle → 查詢 → 渲染」的無限迴圈。bounds、zoom 只在
// effect 執行當下讀取最新值,刻意不列進依賴。
export type PanTarget = {
  lat: number
  lng: number
  level?: number
  radiusMeters?: number
  suppressQuery?: boolean
  onlyIfOutOfView?: boolean
}

export function usePanTarget({
  mapRef,
  mapReady,
  panTarget,
  bounds,
  zoom,
  onSuppressIdle,
  safeAreaRef,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  panTarget: PanTarget | null | undefined
  bounds: google.maps.LatLngBounds | null
  zoom: number
  onSuppressIdle: () => void
  // safeAreaRef:選填。有的話,「移到目標點」改成移到讓目標落在安全區(UI 層配出的看不見的主顯示區洞,
  // 見 plan-core/overlayDom.ts 的 safe-area)中心,與 /ai-plan 的 useMapSafeArea 走同一個 panMapTo;
  // 沒傳就是直接 map.panTo,行為與原本完全相同。fitBounds(帶 radiusMeters)不受影響。
  safeAreaRef?: React.RefObject<Element | null>
}) {
  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map || !panTarget) return
    // onlyIfOutOfView:bounds 為 null 時視為無法判斷,不跳過,保守起見仍執行後續的 panTo。
    if (panTarget.onlyIfOutOfView && bounds && bounds.contains({ lat: panTarget.lat, lng: panTarget.lng })) {
      return
    }
    if (panTarget.suppressQuery) {
      onSuppressIdle()
    }
    if (panTarget.radiusMeters != null && panTarget.radiusMeters > 0) {
      const circle = new google.maps.Circle({
        center: { lat: panTarget.lat, lng: panTarget.lng },
        radius: panTarget.radiusMeters,
      })
      // circleBounds:刻意不叫 bounds,避免跟參數的 bounds(可視範圍)混淆——這裡是暫時算出來、
      // 只為了這次 fitBounds 呼叫用的局部值。
      const circleBounds = circle.getBounds()
      if (circleBounds) {
        map.fitBounds(circleBounds, 48)
        return
      }
    }
    panMapTo(map, panTarget, safeAreaRef?.current)
    if (panTarget.level != null) {
      const needed = minZoomForLevel(panTarget.level)
      if (zoom < needed) {
        map.setZoom(needed)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, panTarget])
}
