// MomijiCanvasOverlay.ts——把楓葉 canvas 掛進 Google Maps 原生的疊加層
// (google.maps.OverlayView 的 overlayLayer pane)。
//
// 為什麼是 overlayLayer:Maps 的縮放/平移動畫是對「地圖 pane 容器」套用
// CSS transform,圖磚、marker、overlayLayer 都在這個容器裡,由瀏覽器合成
// 器一起縮放/位移。canvas 掛進去之後,縮放過渡期間楓葉層跟圖磚是同一個
// transform,天生同步,不需要我們自己監聽 zoom_changed 去猜時機/曲線
// (先前兩輪那樣做都有延遲)。不要掛 floatPane——它不在 transform 容器內,
// 縮放時不會跟著動。
//
// 不用 1800 個 Marker:marker 是真 DOM 節點,pan/zoom 時要逐一 layout,
// 這個數量遠比單張 canvas 吃資源。
//
// canvas 的位置/尺寸:overlayLayer 的座標系是「div pixel」(fromLatLngToDivPixel
// 的輸出),pan 時 pane 整塊位移、座標不變。canvas 取可視範圍外擴 OVERSCAN
// 一圈,拖曳時邊緣才不會露空;可視範圍超出 canvas 或縮放改變(div pixel
// 原點重設)時才重新定位,避免每個 frame 重設 canvas 尺寸把畫布清掉。
// 葉子動畫(熟度漸變/搖擺/飛葉)本身仍由外部 rAF 迴圈驅動。

const OVERSCAN = 0.25

// google.maps.OverlayView 要等 Maps SDK 載入後才存在,class 不能在模組載入時
// 就 extends 它(會 ReferenceError: google is not defined)。改成工廠函式,
// 第一次呼叫時(地圖已建好)才建立子類並快取。
function defineOverlayClass() {
return class MomijiCanvasOverlayImpl extends google.maps.OverlayView {
  readonly canvas: HTMLCanvasElement
  // canvas 左上角在 div pixel 座標系的位置,與 CSS 尺寸(渲染層用來把
  // fromLatLngToDivPixel 的結果換成 canvas 內座標)
  originX = 0
  originY = 0
  cssWidth = 0
  cssHeight = 0
  private mounted = false
  private laidOut = false
  private onDrawCallbacks: Array<() => void> = []

  // className:CSS Module 編譯後的 class,由呼叫端傳入(這個 canvas 不在 React
  // 管理的 DOM 裡)。位置/尺寸一律由 layout() 以 inline style 設定。
  constructor(className: string) {
    super()
    this.canvas = document.createElement('canvas')
    this.canvas.className = className
    this.canvas.setAttribute('aria-label', '日本列島楓葉變色動畫')
  }

  override onAdd() {
    this.getPanes()?.overlayLayer.appendChild(this.canvas)
    this.mounted = true
  }

  override onRemove() {
    this.canvas.remove()
    this.mounted = false
    this.laidOut = false
  }

  // draw——Maps 在縮放結束(div pixel 原點重設)等時機呼叫。這時必須立刻
  // 重新定位 canvas 並同步補畫,否則會有一個 frame 楓葉停在舊座標。
  override draw() {
    // div pixel 原點在這個時機重設,舊的 canvas 位置失效,強制重新定位。
    this.laidOut = false
    this.layout()
    for (const cb of this.onDrawCallbacks) cb()
  }

  // layout——依目前可視範圍(外擴 OVERSCAN)定位 canvas。回傳是否可畫。
  // 可視範圍仍在 canvas 內時什麼都不做。
  //
  // 可視範圍只用 projection 算(容器像素 → 經緯度 → div pixel),不用
  // map.getBounds()/getZoom():縮放過渡期間實測 getBounds() 已經是新縮放
  // 的值、projection 卻還在舊狀態,兩者混用會算出錯誤尺寸(canvas 在縮放
  // 中被改成一半寬)。同一個 projection 的兩個換算彼此一致。
  layout(): boolean {
    const proj = this.getProjection()
    const div = (this.getMap() as google.maps.Map | null)?.getDiv()
    if (!proj || !div) return false
    const W = div.clientWidth
    const H = div.clientHeight
    if (W === 0 || H === 0) return false
    const tl = proj.fromContainerPixelToLatLng(new google.maps.Point(0, 0))
    const br = proj.fromContainerPixelToLatLng(new google.maps.Point(W, H))
    if (!tl || !br) return false
    const a = proj.fromLatLngToDivPixel(tl)
    const b = proj.fromLatLngToDivPixel(br)
    if (!a || !b) return false
    const vl = a.x
    const vt = a.y
    const vr = b.x
    const vb = b.y
    const inside =
      this.laidOut &&
      vl >= this.originX && vt >= this.originY &&
      vr <= this.originX + this.cssWidth && vb <= this.originY + this.cssHeight
    if (inside) return true
    const w = vr - vl
    const h = vb - vt
    this.originX = Math.round(vl - w * OVERSCAN)
    this.originY = Math.round(vt - h * OVERSCAN)
    this.cssWidth = Math.round(w * (1 + 2 * OVERSCAN))
    this.cssHeight = Math.round(h * (1 + 2 * OVERSCAN))
    this.laidOut = true
    const s = this.canvas.style
    s.left = `${this.originX}px`
    s.top = `${this.originY}px`
    s.width = `${this.cssWidth}px`
    s.height = `${this.cssHeight}px`
    return true
  }

  // onDraw——訂閱 draw() 被呼叫的時機,外部用來同步補畫一次。
  onDraw(cb: () => void): () => void {
    this.onDrawCallbacks.push(cb)
    return () => {
      const i = this.onDrawCallbacks.indexOf(cb)
      if (i >= 0) this.onDrawCallbacks.splice(i, 1)
    }
  }

  isMounted(): boolean {
    return this.mounted
  }
}
}

export type MomijiCanvasOverlay = InstanceType<ReturnType<typeof defineOverlayClass>>

let overlayClass: ReturnType<typeof defineOverlayClass> | null = null

export function createMomijiCanvasOverlay(className: string): MomijiCanvasOverlay {
  overlayClass ??= defineOverlayClass()
  return new overlayClass(className)
}
