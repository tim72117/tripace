import { planStopMarkerSvgString, svgStringToElement, type PlanStopMarkerState } from './mapMarkers'

// PlanStopOverlay——usePlanStopMarkers.ts 在 useAdvancedMarkers:false 時
// 使用的 marker 實作(2026-10 改版,取代原本的 google.maps.Marker +
// data:image/svg+xml icon)。背景同 usePlanStopMarkers.ts StopMapMarker
// 型別的完整說明:hand-drawn 行程(jozankei-1day)不帶 mapId,
// AdvancedMarkerElement 強制要求 mapId 才能顯示,但使用者比較
// jozankei-1day 跟 tainan-chikan-2day(simple 樣式、帶 mapId、走
// AdvancedMarkerElement)之後,明確要求兩者的強調態視覺(靶心光暈/漣漪
// 動畫)要一致——而靜態 icon 圖片內部的 SVG 節點不能套用外部 CSS
// keyframe 動畫(.ps-halo/.ps-ripple,定義在 ExploreMap.module.css),
// 改用 google.maps.OverlayView:它跟 AdvancedMarkerElement 一樣是真正的
// DOM(div),CSS 動畫能正常套用,同時跟舊版 Marker 一樣不要求地圖帶
// mapId(OverlayView 本身只是把任意 DOM 貼在地圖投影算出的像素座標上,
// 跟底圖是 raster 還是 vector 管線無關)。
//
// 這個模組的結構(lazy class factory、onAdd/draw/onRemove 生命週期、
// 點擊時 stopPropagation 避免冒泡到地圖觸發 Google 原生 POI 點擊)直接
// 比照同資料夾 geoAttractionOverlay.ts 的既有慣例——那裡的完整說明
// (尤其 onAdd() 開頭對 class 不能在模組頂層 extends google.maps.OverlayView
// 的解釋、bindClickTargets() 對 mousedown/touchstart stopPropagation 的
// 解釋)同樣適用於這裡,不重複抄寫一份,只在這裡的做法跟那裡不同之處
// 額外說明。

// PlanStopOverlayInstance——這個類別只需要 usePlanStopMarkers.ts 用得到
// 的最小介面:setState(視覺狀態切換,對齊 AdvancedMarkerElement.content
// 指派)、setZIndex(OverlayView 沒有原生 zIndex,改用 CSS z-index
// 模擬,見下方 setZIndex 的完整說明)、setMap(沿用 OverlayView 原生
// 方法,不需要額外包一層)。不像 geoAttractionOverlay.ts 的
// AttractionOverlayInstance 那樣需要 setSelected/setCandidate/setHovered
// 等多個獨立狀態方法——這裡的視覺狀態是 PlanStopMarkerState 單一個三態
// 列舉(見 mapMarkers.ts 的完整說明),一個 setState 已經足夠表達。
export type PlanStopOverlayInstance = google.maps.OverlayView & {
  // entering——跟 planStopMarkerSvgString/planStopMarkerContent 的 entering
  // 參數同一個語意(見 mapMarkers.ts 的完整說明):是否「剛從 base 進入
  // 強調態」,只有這種情況才播光暈進場與一次性漣漪。刻意由呼叫端
  // (usePlanStopMarkers.ts)算好傳入,不在這個類別內部用
  // `state !== 'base'` 推算——那樣會讓 hover→selected(強調態之間切換,
  // 不該重播動畫)誤判成 entering,因為呼叫端判斷 entering 的依據是
  // 「切換前」的狀態(prev === 'base'),不是「切換後」的狀態本身,這個
  // 類別自己完全不記得 prev 是什麼。
  setState: (state: PlanStopMarkerState, entering: boolean, color: string, glyphSvg: string | undefined, size: number) => void
  setZIndex: (zIndex: number | null) => void
}

let PlanStopOverlayClass:
  | (new (
      position: google.maps.LatLng,
      title: string | undefined,
      onClick: (() => void) | undefined,
    ) => PlanStopOverlayInstance)
  | null = null

// getPlanStopOverlayClass——延後到 Maps SDK 確定載入完成後才定義並快取
// 這個 class(單例,只建一次),理由同 geoAttractionOverlay.ts
// getAttractionOverlayClass() 的完整說明:google.maps 是透過
// importLibrary('maps') 異步載入的全域,模組頂層直接
// `extends google.maps.OverlayView` 會在模組載入當下(google 還不存在時)
// 就拋出 ReferenceError。
export function getPlanStopOverlayClass() {
  if (PlanStopOverlayClass) return PlanStopOverlayClass

  class PlanStopOverlay extends google.maps.OverlayView {
    private div: HTMLDivElement | null = null
    // onAdd() 是 Google Maps SDK 非同步才呼叫(setMap() 之後下一個 frame
    // 才真正建立 div,見 geoAttractionOverlay.ts hidden 欄位的完整說明)。
    // usePlanStopMarkers.ts 的建立 effect 在 new 完這個類別、呼叫
    // setMap() 之後,緊接著就可能呼叫 setState()/setZIndex() 套用建立時
    // 的初始狀態(見該檔案「建立時就套用當下的狀態」的完整說明)——這段
    // onAdd 之前的空窗期裡,下面 setState/setZIndex 若直接操作 this.div
    // 會是 no-op(div 還是 null),故兩者都先把值存成欄位,div 建好時
    // onAdd() 再一次性套用,不遺漏這段空窗期收到的呼叫。
    private state: PlanStopMarkerState = 'base'
    private entering = false
    private color = '#8B3A2F'
    private glyphSvg: string | undefined
    private size = 14
    private zIndex: number | null = null

    constructor(
      private position: google.maps.LatLng,
      private title: string | undefined,
      private onClick: (() => void) | undefined,
    ) {
      super()
    }

    onAdd() {
      const div = document.createElement('div')
      // position: absolute 由 draw() 的 left/top 配合——這裡不靠 CSS
      // Modules class(理由同 geoAttractionOverlay.ts onAdd() 的完整
      // 說明:innerHTML/直接操作的 DOM 拿不到雜湊類名),直接用 inline
      // style 設定,不新增任何 .module.css 規則。
      div.style.position = 'absolute'
      // transform: translate(-50%, -100%)——比照 AdvancedMarkerElement
      // 的預設錨定行為(底部中央貼座標點),讓 OverlayView 分支跟
      // AdvancedMarkerElement 分支在同一個 lat/lng 畫出來的位置一致,
      // 兩種模式切換時圓點不會跳位。plan stop 的 SVG 本身也是以這個
      // 假設設計(見 mapMarkers.ts planStopMarkerSvgString 的完整說明:
      // 圓心固定在畫布底邊中央)。
      div.style.transform = 'translate(-50%, -100%)'
      if (this.onClick) div.style.cursor = 'pointer'
      if (this.title) div.title = this.title
      this.div = div
      this.renderContent()
      this.applyZIndex()
      // bindClick——跟 geoAttractionOverlay.ts bindClickTargets() 同一套
      // 理由:click 本身要 stopPropagation,避免這個合成的 DOM 事件繼續
      // 冒泡到地圖容器,被 Google Maps SDK 自己的事件委派誤判成點擊到
      // 底層 POI/瓦片;mousedown/touchstart 也要 stopPropagation,避免
      // Maps 內部的拖曳手勢偵測把點擊誤判成一次拖曳而吃掉 click——兩者
      // 的完整背景說明見 geoAttractionOverlay.ts bindClickTargets() 的
      // 行內註解,這裡的點擊目標只有整個 div 本身(不像景點區域有縮圖/
      // 標籤等多個獨立可點擊元素),故只需要綁一次,不需要
      // querySelectorAll。
      div.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onClick?.()
      })
      div.addEventListener('mousedown', (e) => e.stopPropagation())
      div.addEventListener('touchstart', (e) => e.stopPropagation())
      // overlayMouseTarget——同 geoAttractionOverlay.ts 的既有選擇,這個
      // pane 接受滑鼠事件,適合需要點擊互動的自訂疊層。
      const panes = this.getPanes()
      panes?.overlayMouseTarget.appendChild(div)
    }

    // renderContent——用 svgStringToElement 把 planStopMarkerSvgString
    // 的輸出解析成真正的 SVG DOM 節點再塞進 div,跟 AdvancedMarkerElement
    // 分支(mapMarkers.ts planStopMarkerContent)共用同一份已經調校過的
    // 繪圖邏輯與 .ps-halo/.ps-ripple class 命名,視覺輸出完全相同——這是
    // 這次改版最主要的目的,不是另外設計一套簡化版樣式。
    //
    // 每次呼叫都整個重設 DOM(appendChild 前先清空),不是局部修改屬性:
    // 強調態切換需要讓 .ps-halo/.ps-ripple 這類一次性動畫從頭播(見
    // planStopMarkerSvgString entering 參數的完整說明),而這兩種狀態的
    // SVG 內部結構本身也不同(base 只有一個圓,強調態多出光暈/漣漪/
    // 靶心三圈),不是單純切 class 能表達的差異——跟 AdvancedMarkerElement
    // 分支整個替換 content 屬性是同一個道理。
    private renderContent() {
      if (!this.div) return
      this.div.replaceChildren(svgStringToElement(planStopMarkerSvgString(this.state, this.color, this.entering, this.glyphSvg, this.size)))
    }

    // applyZIndex——OverlayView 沒有原生 zIndex 概念(跟 AdvancedMarkerElement/
    // 舊版 Marker 不同,那兩者都是地圖 SDK 內部維護的疊圖順序),改用
    // CSS z-index 模擬,等同 geoAttractionOverlay.ts updateContainerZIndex
    // 的既有做法(見該方法的完整說明)。null 時明確清空(空字串退回
    // stylesheet 預設值 auto),不是留著上一次的數字——否則「選取/hover
    // 都不是」的 base 狀態會錯誤繼承前一個強調態留下的疊放層級。
    private applyZIndex() {
      if (!this.div) return
      this.div.style.zIndex = this.zIndex == null ? '' : String(this.zIndex)
    }

    draw() {
      if (!this.div) return
      const projection = this.getProjection()
      if (!projection) return
      const point = projection.fromLatLngToDivPixel(this.position)
      if (!point) return
      this.div.style.left = `${point.x}px`
      this.div.style.top = `${point.y}px`
    }

    onRemove() {
      this.div?.remove()
      this.div = null
    }

    // setState——usePlanStopMarkers.ts 建立/同步兩個 effect 共用的入口,
    // 對應 AdvancedMarkerElement 分支直接指派 content 屬性的那一行。
    // 呼叫端(usePlanStopMarkers.ts)自己負責「值沒變就跳過」的判斷
    // (stateRef 比對,見該檔案同步 effect 的完整說明),這裡不重複做
    // 一次相同的比對,避免兩邊判斷基準不一致。
    setState(state: PlanStopMarkerState, entering: boolean, color: string, glyphSvg: string | undefined, size: number) {
      this.state = state
      this.entering = entering
      this.color = color
      this.glyphSvg = glyphSvg
      this.size = size
      this.renderContent()
    }

    setZIndex(zIndex: number | null) {
      this.zIndex = zIndex
      this.applyZIndex()
    }
  }

  PlanStopOverlayClass = PlanStopOverlay
  return PlanStopOverlayClass
}
