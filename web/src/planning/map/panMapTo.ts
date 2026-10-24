import { solveSafeAreaCenter } from './solveSafeAreaCenter'

// panMapTo——把地圖移到某個點;有「安全區」元素就移到讓目標落在安全區中心。
//
// 從 useMapSafeArea 抽出來:/ai-plan 的 useMapSafeArea(panToWithinSafeArea)與登入後的 usePanTarget
// 原本是「把某個點移進使用者看得到的範圍」的兩套機制,現在都走這一個函式。
//
// 安全區是 UI 層配出來、看不見的「地圖主顯示區」洞(見 planning/shared/overlayDom.ts 的 safe-area):
// Google Maps JS API 沒有任何原生的「偏移中心」支援(沒有 padding 設定,panToBounds 只是最小必要移動
// 量、無法精準置中),所以由 solveSafeAreaCenter 手算「新的地圖中心」,使目標點落在安全區中心,再 panTo
// 過去——不使用 fitBounds(會視情況改 zoom,連續點 pin 會一直 zoom out)。
//
// 任何一步拿不到資料(沒有安全區元素、地圖還沒有投影或縮放或中心、solver 解不出來)都退回
// map.panTo(target)——沒有安全區時行為與直接呼叫 map.panTo 完全相同(傳同一個 target 物件)。
export function panMapTo(map: google.maps.Map, target: { lat: number; lng: number }, safeAreaEl?: Element | null) {
  if (!safeAreaEl) {
    map.panTo(target)
    return
  }
  // 安全區沒有面積(例如疊加層用 hidden 收起、display: none)時等於沒有安全區,直接 panTo,不拿零大小的矩形去解。
  const safeRect = safeAreaEl.getBoundingClientRect()
  if (safeRect.width <= 0 || safeRect.height <= 0) {
    map.panTo(target)
    return
  }
  const projection = map.getProjection()
  const zoom = map.getZoom()
  const center = map.getCenter()
  if (!projection || zoom == null || !center) {
    map.panTo(target)
    return
  }
  const solution = solveSafeAreaCenter({
    target,
    currentCenter: { lat: center.lat(), lng: center.lng() },
    zoom,
    mapRect: map.getDiv().getBoundingClientRect(),
    safeRect,
    projectToPoint: (latLng) => projection.fromLatLngToPoint(new google.maps.LatLng(latLng.lat, latLng.lng)),
    projectToLatLng: (point) => {
      const latLng = projection.fromPointToLatLng(new google.maps.Point(point.x, point.y))
      return latLng ? { lat: latLng.lat(), lng: latLng.lng() } : null
    },
  })
  if (!solution) {
    map.panTo(target)
    return
  }
  map.panTo(solution.newCenter)
}
