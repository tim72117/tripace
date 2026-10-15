// solveSafeAreaCenter——「要把某個座標移到安全區塊的幾何中心,地圖中心
// 該移到哪裡」這個計算本身,抽成不碰 DOM、不碰 google.maps 的純函式。
//
// 為什麼抽出來(2026-10,使用者構想「當成開發工具可以分拆乾淨,需要時
// 才組合嗎」):原本計算寫在 useMapSafeArea 的 panToWithinSafeArea 裡,
// 跟「讀 DOM 尺寸」「呼叫 map.panTo」這些副作用糊在一起,導致
//   1. 沒辦法測——要測就得準備真實的 google.maps.Map 與排版好的 DOM
//   2. 除錯疊圖拿不到中間結果,只能在 hook 上多開一個 debug 專用的
//      回傳值(debugSafeAreaPan),等於讓正式介面為除錯工具讓路
// 拆出來之後這兩件事都解決:測試直接餵數字,除錯疊圖自己呼叫同一個
// 函式拿完整中間結果,useMapSafeArea 的公開介面完全不需要知道除錯
// 工具存在。
//
// 不直接依賴 google.maps 的型別與全域物件——投影轉換用 callback 傳進
// 來。這不只是為了好測(測試可以餵一個假的線性投影,不需要載入 Maps
// JS API),也讓這個函式的職責更誠實:它要的其實只是「經緯度↔平面座標
// 的雙向轉換」這個抽象能力,不是 Google Maps 這個特定實作。
//
// 座標系說明(這三種很容易混淆,出錯時先確認是哪一種):
//   - 世界座標(world point):投影後、未經縮放的平面座標。Google Maps
//     的 fromLatLngToPoint 回傳這個,整個世界是 256×256。
//   - 像素座標(pixel):世界座標乘上 2^zoom。這是螢幕上的實際距離。
//   - 容器座標:相對地圖容器左上角的像素位置。本函式的輸入/輸出裡
//     所有 rect 與回傳的像素位置都是這一種。

export interface Point {
  x: number
  y: number
}

export interface LatLng {
  lat: number
  lng: number
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface SolveSafeAreaCenterArgs {
  // target——要被移動到安全區中心的那個地理座標。
  target: LatLng
  // currentCenter——地圖目前的中心。
  currentCenter: LatLng
  // zoom——地圖目前的縮放層級。像素與世界座標的換算比例是 2^zoom。
  // Google Maps 允許小數 zoom(isFractionalZoomEnabled),所以這裡
  // 不假設整數。
  zoom: number
  // mapRect/safeRect——兩者都是 getBoundingClientRect() 的結果,也就是
  // 相對「瀏覽器視窗」的座標。函式內部會把 safeRect 換算成相對 mapRect
  // 的容器座標,呼叫端不需要自己先減。
  mapRect: Rect
  safeRect: Rect
  // projectToPoint/projectToLatLng——經緯度與世界座標的雙向轉換。
  // 正式路徑傳 google.maps 的 projection 方法,測試傳假的。
  // 回傳 null 代表轉換失敗(超出投影有效範圍等),本函式會跟著回傳 null。
  projectToPoint: (latLng: LatLng) => Point | null
  projectToLatLng: (point: Point) => LatLng | null
}

export interface SafeAreaCenterSolution {
  // newCenter——結論:地圖中心移到這裡,target 就會落在安全區中心。
  newCenter: LatLng
  // 以下都是中間結果,正式路徑用不到,除錯疊圖靠它們畫標記。
  // 全部是「相對地圖容器左上角」的像素座標。
  targetPixel: Point
  safeCenterPixel: Point
  mapCenterPixel: Point
  // delta——地圖中心需要平移的像素量(targetPixel - safeCenterPixel)。
  delta: Point
  // safeRectInMap——安全區塊換算成容器座標後的範圍,疊圖用它畫綠框。
  safeRectInMap: Rect
}

// solveSafeAreaCenter——回傳 null 代表「算不出來」,呼叫端應該退化成
// 直接 panTo(target)。兩種情況:安全區塊沒有有效尺寸(還沒排版出來),
// 或投影轉換失敗。
export function solveSafeAreaCenter(args: SolveSafeAreaCenterArgs): SafeAreaCenterSolution | null {
  const { target, currentCenter, zoom, mapRect, safeRect, projectToPoint, projectToLatLng } = args

  // 安全區塊還沒排版出尺寸(例如初次掛載那一瞬間)時寬高會是 0——
  // 一個退化成單點的「安全區」算出來的中心沒有意義,不如讓呼叫端
  // 退回無條件 panTo。
  if (safeRect.width === 0 || safeRect.height === 0) return null

  const scale = 2 ** zoom
  const targetWorld = projectToPoint(target)
  const centerWorld = projectToPoint(currentCenter)
  if (!targetWorld || !centerWorld) return null

  // targetPixel——target 相對地圖容器左上角的目前像素位置。地圖中心
  // 永遠畫在容器正中央,target 與地圖中心在世界座標系裡的差值乘上
  // 縮放比例,就是 target 相對容器中心的像素偏移。
  const mapCenterPixel: Point = { x: mapRect.width / 2, y: mapRect.height / 2 }
  const targetPixel: Point = {
    x: mapCenterPixel.x + (targetWorld.x - centerWorld.x) * scale,
    y: mapCenterPixel.y + (targetWorld.y - centerWorld.y) * scale,
  }

  // safeRectInMap——安全區塊的 rect 與地圖容器的 rect 都是相對視窗的
  // 座標,兩者相減才會跟 targetPixel 在同一個基準上(相對容器左上角)。
  const safeRectInMap: Rect = {
    left: safeRect.left - mapRect.left,
    top: safeRect.top - mapRect.top,
    width: safeRect.width,
    height: safeRect.height,
  }
  const safeCenterPixel: Point = {
    x: safeRectInMap.left + safeRectInMap.width / 2,
    y: safeRectInMap.top + safeRectInMap.height / 2,
  }

  // delta——要把 target 從目前的像素位置移到安全區中心,地圖中心需要
  // 往這個方向移動多少像素。地圖整體平移不改變任何兩點之間的相對像素
  // 距離,所以地圖中心移動 delta,target 在螢幕上也剛好移動 delta。
  const delta: Point = {
    x: targetPixel.x - safeCenterPixel.x,
    y: targetPixel.y - safeCenterPixel.y,
  }

  // 換算回世界座標(除以 scale)再轉成經緯度,就是新的地圖中心。
  const newCenter = projectToLatLng({
    x: centerWorld.x + delta.x / scale,
    y: centerWorld.y + delta.y / scale,
  })
  if (!newCenter) return null

  return { newCenter, targetPixel, safeCenterPixel, mapCenterPixel, delta, safeRectInMap }
}
