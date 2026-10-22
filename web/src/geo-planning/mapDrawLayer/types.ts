// mapDrawLayer/types.ts——統一繪製層的型別(2026-10)。
//
// 目的:地圖上所有「原生繪製」的東西(marker、圓圈、線)由同一層管理。目前它們分散在十幾個 hook,
// 各自處理重建(有的有 mapVersion、有的沒有)、疊放順序(zIndex 散落各處)、清理。這一層把這些
// 共通的事收斂在一處;各功能只需要宣告「要畫什麼」,不用再自己碰 google.maps 物件。
//
// 三層分工:
//   1. NativeMapBase:只建地圖,回報 MapHandle。
//   2. 繪製層(這個資料夾):宿主 useMapDrawLayer 吃一組「功能層」(FeatureLayer),內部組合起來,
//      依 id 比對、原地更新、地圖重建後重掛、清理、依群組決定疊放順序。
//   3. 功能層:各自把資料轉成一份 Drawable 清單(純資料,沒有副作用),例如目前位置、搜尋結果、
//      行程站點。功能層可以任意組合。
//
// 支援四種:marker、circle、polyline,以及功能層自行建立實例的 overlay(OverlayView,例如景點光暈)。

export type LatLng = { lat: number; lng: number }

// DrawGroup:決定疊放順序(見 zOrder.ts,所有 zIndex 集中在那一張表)。
export type DrawGroup =
  | 'currentLocation'
  | 'searchResult'
  | 'searchResultGeocode'
  | 'searchResultSelected'
  | 'tripEntry'
  | 'tripEntrySelected'
  | 'planStopChild'
  | 'planStop'
  | 'planStopSelected'
  | 'planStopHover'
  | 'routeLine'
  | 'routePolyline'
  | 'transitHoverLine'
  | 'attractionGlow'

interface DrawableBase {
  // id 只需要在所屬的功能層內唯一;宿主組合時會加上功能層 id 當前綴,不同功能層可以重複。
  id: string
  group: DrawGroup
}

export type ContentContext = { previousContentKey?: string }

export interface MarkerDrawable extends DrawableBase {
  kind: 'marker'
  position: LatLng
  title?: string
  // contentKey:內容(DOM)的版本標記。改變時宿主才會重新呼叫 createContent;沒變就沿用舊內容。
  // 這樣呼叫端每次渲染傳新的 createContent 函式不會造成重畫。
  contentKey: string
  // createContent:產生 marker 的內容(DOM)。更新時(內容 key 改變)會帶上前一個 contentKey,功能層
  // 可以據此判斷「從哪個狀態變過來」(例如行程站點從 base 變成強調態才播進場動畫);第一次建立時
  // 沒有前一個 key。不需要的功能層直接忽略參數。
  createContent: (ctx?: ContentContext) => Element
  // clickable:預設不可點。gmpClickable 只能在建立時決定,所以這個值改變會重建 marker。
  clickable?: boolean
  // onClick 收到的是功能層內的原始 id(不含前綴)。宿主永遠呼叫最新的那個函式。
  onClick?: (id: string) => void
}

export interface CircleDrawable extends DrawableBase {
  kind: 'circle'
  center: LatLng
  radiusMeters: number
  options?: Omit<google.maps.CircleOptions, 'map' | 'center' | 'radius' | 'zIndex' | 'clickable'>
}

export interface PolylineDrawable extends DrawableBase {
  kind: 'polyline'
  path: LatLng[]
  options?: Omit<google.maps.PolylineOptions, 'map' | 'path' | 'zIndex' | 'clickable'>
}

// overlay:功能層自己建立的 google.maps.OverlayView 實例(例如景點光暈,自訂 DOM、有自己的狀態方法)。
// 引擎只管生命週期:add 時呼叫 create() 並 setMap(map);stateKey 改變時呼叫 update(instance) 讓功能層
// 套用新狀態;移除或地圖重建時 setMap(null)。實例怎麼畫、有哪些方法是功能層的事。
// onCreate / onDispose 讓功能層拿到實例(照片查詢、標籤避讓需要直接操作實例)。
export interface OverlayInstance {
  setMap(map: google.maps.Map | null): void
}

export interface OverlayDrawable<T extends OverlayInstance = OverlayInstance> extends DrawableBase {
  kind: 'overlay'
  // stateKey:狀態版本標記。改變時才呼叫 update;沒變就不碰實例。
  stateKey: string
  create: () => T
  update?: (instance: T) => void
  onCreate?: (instance: T) => void
  onDispose?: (instance: T) => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Drawable = MarkerDrawable | CircleDrawable | PolylineDrawable | OverlayDrawable<any>

// FeatureLayer:一個功能層對宿主的唯一輸出——「現在要畫什麼」。沒有東西要畫就給空陣列。
export interface FeatureLayer {
  id: string
  drawables: Drawable[]
}
