import { useCallback, useRef } from 'react'
import { panMapTo } from './panMapTo'

// useMapSafeArea——2026-10 新增(使用者構想:「底下是地圖層,上方是一層
// UI 層,UI 層把各個元素都配置好,像地圖主顯示區就配出一個區塊,只是
// 不用顯示,那自然就可以得知主顯示區的範圍」):取代
// home/plan-ai-sim/Content.tsx 原本「手算 timelineHeight / 2 再呼叫 panBy」
// 的土法可視區偏移——那套作法要自己推導 panBy 的方向語意、還踩過一次
// 方向寫反的實機 bug,且只服務這一個頁面,沒有辦法被其他地圖呼叫端重用。
//
// 這個 hook 只負責三件事:讀取安全區塊元素的實際螢幕範圍、把數字交給
// solveSafeAreaCenter 算出目的地中心、呼叫 panTo。計算本身住在
// solveSafeAreaCenter.ts(純函式,見該檔案的完整說明),不在這裡。
//
// 技術前提(2026-10 查證 @types/google.maps v3.65.5 與官方 reference
// 後確認,這是複查過的結論不是推測):Maps JS API 沒有任何原生的
// 「偏移中心」支援——
//   - MapOptions 沒有常駐 padding。google.maps.Padding 這個 interface
//     存在,但只被 fitBounds/panToBounds 的參數引用,沒有對應的 setter。
//     Android SDK 的 GoogleMap.setPadding() 與 iOS 的 GMSMapView.padding
//     確實有這個功能,JS API 沒有,是平台間的功能落差。
//   - panToBounds(bounds, padding) 不會改 zoom(這點比 fitBounds 好),
//     但官方明文「makes no guarantee where on the map the bounds will
//     be」,而且是「最小必要移動量」——目標已在範圍內就完全不動,
//     無法用來精準置中。
//   - 向量地圖的 CameraOptions 只有 center/heading/tilt/zoom,沒有
//     padding/offset/anchor,moveCamera 的 center 基準跟 setCenter
//     一樣是容器幾何中心。
// 其他地圖庫(MapLibre/Mapbox setPadding、ArcGIS view.padding、
// MapKit JS padding)都有這個能力,只有 Google JS API 沒有,所以這裡
// 的手算反推是這個需求在這個 API 上的標準解法。
//
// 2026-10 改版(使用者連續兩次實機回報修正):
//   1.「沒有用地圖區域作為中心位置」「你現在是整個地圖的中心,不是
//      主要地圖區的中心」——不管是原本單純呼叫 panTo(target),還是
//      第一版用 fitBounds(bounds, padding) 的寫法,兩者都只能把目標點
//      移到「整個地圖容器」的中心/可視範圍,不是「安全區塊」的中心。
//   2.「連續點 pin,地圖會一直 zoom out」——fitBounds 會視情況調整
//      zoom 去把 bounds 塞進可視範圍,即使 bounds 只是單一個點。
// 修正方向:完全不使用 fitBounds,改成算出一個新的地圖中心座標,使得
// 目標點移動後落在安全區塊的幾何中心,再 panTo 到這個算出來的新中心
// (不是 target 本身)。全程只用 panTo,zoom 永遠不變。
//
// 這個 hook 不內建任何版面假設(例如寫死「永遠是底部被卡片列佔用」)
// ——安全區塊元素要長什麼形狀、佔多大範圍,完全由呼叫端自己在 UI 層
// 用 CSS 配置(使用者明確指出「桌面版排版不一樣,區域也不一樣」)。

export function useMapSafeArea(mapRef: React.RefObject<google.maps.Map | null>) {
  // safeAreaElRef——呼叫端把安全區塊元素(UI 層裡一塊不可見的 div,
  // 用 CSS 配置成扣掉遮擋物後剩餘的地圖可視範圍)掛到這個 ref 上。
  // 用 ref 而非 state——這個元素的尺寸不需要觸發任何重新渲染,只在
  // 真正要移動地圖的那一刻才讀取它當下的實際範圍。
  //
  // 這個 ref 同時也是開發工具的組合點:SafeAreaDebugOverlay 拿同一個
  // ref 自己呼叫 solveSafeAreaCenter 畫出中間結果,不需要這個 hook
  // 開任何 debug 專用的回傳值(見該元件檔頭的完整說明)。
  const safeAreaElRef = useRef<HTMLDivElement | null>(null)

  // panToWithinSafeArea——呼叫端要把地圖移動到某個座標時改呼叫這個
  // 函式,取代直接呼叫 mapRef.current.panTo(target)。效果是:target
  // 這個地理座標,移動完成後會落在安全區塊的幾何中心,不是整個地圖
  // 容器的中心。
  // 平移本身(算安全區中心、拿不到資料時退回 panTo)在共用的 panMapTo,登入後的 usePanTarget 也用它。
  const panToWithinSafeArea = useCallback(
    (target: { lat: number; lng: number }) => {
      const map = mapRef.current
      if (!map) return
      panMapTo(map, target, safeAreaElRef.current)
    },
    [mapRef],
  )

  return { safeAreaElRef, panToWithinSafeArea }
}
