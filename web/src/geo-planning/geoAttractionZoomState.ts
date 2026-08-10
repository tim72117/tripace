// geoAttractionZoomState:管理「點擊景點區域、地圖 fitBounds 縮放到該
// 區域範圍時,該景點區域自己的圓形照片/佔位圓要不要改用縮小一半的尺寸
// 呈現」這個狀態轉換,從 GeoOutlineMap.tsx 抽成不依賴 google.maps SDK 的
// 純 reducer——理由同 geoAreaSearchState.ts:該元件深度依賴 Google Maps
// JS API,整個元件目前沒有任何測試覆蓋(mock 整個 Google Maps API 成本
// 很高),但「什麼時候該進入縮小狀態、什麼時候該恢復」這組順序決策本身
// 不需要碰到地圖 SDK,抽出來後才能用一般的單元測試驗證順序正確。
//
// 使用者需求原話:「點 attraction 時縮到區域範圍時,地圖上的圖標縮小
// 一半」——只有「這個景點區域自己」的圖示要縮小(不影響地圖上其他景點/
// 飯店圖示),且只有點擊後地圖真的縮放到「區域範圍」(對應
// geoAttractionClick.ts 的 planAttractionClick 回傳 kind==='fit-bounds',
// 這個景點區域本身帶 radiusMeters)才觸發——沒有 radiusMeters 的單點
// 地標(pan-and-zoom 分支)不算「縮到區域範圍」,不觸發縮小。
//
// zoomedInKey:目前處於縮小狀態的景點區域識別鍵(對齊 GeoHotelSidebar.tsx
// 的 geoItemKey('attraction', d)),null 代表沒有任何景點區域處於縮小
// 狀態。同一時間最多只有一個(最近一次觸發 fit-bounds 的那個),不是集合
// ——使用者的瀏覽焦點本來就只會在一個景點區域上。
export type AttractionZoomState = string | null

export const initialAttractionZoomState: AttractionZoomState = null

// AttractionZoomEvent 對應兩個實際觸發時機:
//   attraction-clicked  使用者點擊地圖上的景點區域圖示(見
//     GeoOutlineMap.tsx handleAttractionClick),帶這次點擊算出來的
//     planKind(見 planAttractionClick)與這個景點區域的識別鍵。
//   panel-closed         AttractionInfoPanel 被關閉(見 DesktopLayout.tsx
//     的 onClose)——使用者已經看完介紹、不再聚焦這個景點區域,縮小狀態
//     沒有繼續維持的理由。
export type AttractionZoomEvent =
  | { type: 'attraction-clicked'; key: string; planKind: 'fit-bounds' | 'pan-and-zoom' }
  | { type: 'panel-closed' }

// reduceAttractionZoomState:給定目前狀態 + 事件,回傳新狀態。
//
// 各事件的轉換理由:
//   attraction-clicked:
//     - planKind 是 'fit-bounds'(這個景點區域帶 radiusMeters,地圖真的
//       縮放去框出它的範圍)→ zoomedInKey 改成這次點擊的 key,取代原本
//       任何一個縮小中的景點區域(同一時間只聚焦一個)。
//     - planKind 是 'pan-and-zoom'(單點地標,沒有「區域範圍」可言)→
//       清空 zoomedInKey——點擊了一個新地標,不該讓上一個 fit-bounds
//       景點區域繼續維持縮小狀態(那已經不是目前的瀏覽焦點了)。
//   panel-closed:無條件清空 zoomedInKey——關閉介紹卡片代表使用者結束
//     瀏覽這個景點區域,縮小狀態應該一併恢復,下次重新點擊同一個景點
//     區域時才會是乾淨的初始狀態,不會殘留上一輪的縮小效果。
export function reduceAttractionZoomState(
  state: AttractionZoomState,
  event: AttractionZoomEvent,
): AttractionZoomState {
  switch (event.type) {
    case 'attraction-clicked':
      return event.planKind === 'fit-bounds' ? event.key : null
    case 'panel-closed':
      return null
    default:
      return state
  }
}
