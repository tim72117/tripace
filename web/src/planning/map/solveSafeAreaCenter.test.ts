import { describe, it, expect } from 'vitest'
import { solveSafeAreaCenter, type Rect } from './solveSafeAreaCenter'

// solveSafeAreaCenter.test.ts——守住「把目標點移到安全區中心」這個計算
// 的數學正確性。
//
// 這層測得到、也值得測:2026-10 之前那套 panBy 土法踩過一次「方向寫反」
// 的實機 bug(往上偏移寫成往下),正是這種測試能在進版前擋下來的。
//
// 這層測不到的(不要期待它涵蓋):安全區塊本身的幾何對不對。那是 CSS
// 排版推導的結果,jsdom 的 getBoundingClientRect() 全部回傳 0、不計算
// CSS,根本無法在單元測試裡重現——2026-10 實機回報「安全區域不對」那次
// bug 就是純粹的幾何問題(flex: 1 推導在三種情況下靜默失效),計算這層
// 從頭到尾都是對的。幾何那層靠 SafeAreaDebugOverlay 疊圖肉眼驗證。
//
// 投影用假的線性函式而不是真的 Web Mercator:要驗證的是「像素偏移如何
// 換算成新中心」這段邏輯,不是 Google 的投影實作。線性投影讓期望值可以
// 手算,斷言才有意義——用真投影的話,期望值只能從實作本身反推,那就
// 變成拿程式碼驗證程式碼。
//
// 假投影的定義:lng/lat 直接當 x/y(1:1),所以 zoom=0 時 1 單位經緯度
// = 1 像素,zoom=1 時 = 2 像素。y 不翻轉——真實 Web Mercator 的 y 是
// 由北向南遞增(緯度越大 y 越小),這裡刻意不模擬那個翻轉,讓期望值
// 直觀;方向正確性由「delta 的符號」本身驗證,不依賴投影的方向語意。
const linearProjection = {
  projectToPoint: (latLng: { lat: number; lng: number }) => ({ x: latLng.lng, y: latLng.lat }),
  projectToLatLng: (point: { x: number; y: number }) => ({ lat: point.y, lng: point.x }),
}

// 1000×800 的地圖容器,位於視窗原點——rect 的 left/top 設 0,讓「相對
// 視窗」與「相對容器」兩個座標系重合,期望值不用再多減一層。
// (left/top 非 0 的情況由下方專門的案例驗證。)
const mapRect: Rect = { left: 0, top: 0, width: 1000, height: 800 }

function solve(args: {
  target: { lat: number; lng: number }
  currentCenter?: { lat: number; lng: number }
  zoom?: number
  safeRect: Rect
  mapRect?: Rect
}) {
  return solveSafeAreaCenter({
    target: args.target,
    currentCenter: args.currentCenter ?? { lat: 0, lng: 0 },
    zoom: args.zoom ?? 0,
    mapRect: args.mapRect ?? mapRect,
    safeRect: args.safeRect,
    ...linearProjection,
  })
}

describe('solveSafeAreaCenter', () => {
  it('安全區塊沒有尺寸時回傳 null(呼叫端應退化成無條件 panTo)', () => {
    // 初次掛載那一瞬間元素還沒排版出尺寸。一個退化成單點的「安全區」
    // 算出來的中心沒有意義,不如讓呼叫端退回原本的行為。
    expect(solve({ target: { lat: 10, lng: 10 }, safeRect: { left: 0, top: 0, width: 0, height: 400 } })).toBeNull()
    expect(solve({ target: { lat: 10, lng: 10 }, safeRect: { left: 0, top: 0, width: 600, height: 0 } })).toBeNull()
  })

  it('投影轉換失敗時回傳 null', () => {
    const result = solveSafeAreaCenter({
      target: { lat: 10, lng: 10 },
      currentCenter: { lat: 0, lng: 0 },
      zoom: 0,
      mapRect,
      safeRect: { left: 0, top: 0, width: 1000, height: 800 },
      projectToPoint: () => null,
      projectToLatLng: linearProjection.projectToLatLng,
    })
    expect(result).toBeNull()
  })

  it('安全區塊等於整個容器時,新中心就是 target 本身', () => {
    // 沒有任何 UI 遮擋的退化情況——安全區中心等於容器中心,這套計算
    // 的結果應該跟直接 panTo(target) 完全一樣。
    const result = solve({
      target: { lat: 10, lng: 20 },
      safeRect: { left: 0, top: 0, width: 1000, height: 800 },
    })
    expect(result).not.toBeNull()
    expect(result!.newCenter.lat).toBeCloseTo(10)
    expect(result!.newCenter.lng).toBeCloseTo(20)
    // delta 不是 0——它是「target 目前位置」與「安全區中心」的差,而
    // target 本來就不在中心上。安全區等於容器時,安全區中心就是容器
    // 中心,所以 delta 等於 target 相對容器中心的像素偏移。
    expect(result!.safeCenterPixel).toEqual(result!.mapCenterPixel)
    expect(result!.delta).toEqual({ x: 20, y: 10 })
  })

  it('target 已經在安全區中心時,delta 為 0、中心不動', () => {
    // 安全區是容器的上半部(高 400,中心在 y=200),容器中心在 y=400。
    // target 要落在 y=200,也就是比容器中心高 200 像素——zoom=0 的
    // 線性投影下,就是 lat 比中心小 200(y 不翻轉,y 小 = lat 小)。
    const result = solve({
      target: { lat: -200, lng: 0 },
      safeRect: { left: 0, top: 0, width: 1000, height: 400 },
    })
    expect(result).not.toBeNull()
    expect(result!.targetPixel).toEqual({ x: 500, y: 200 })
    expect(result!.safeCenterPixel).toEqual({ x: 500, y: 200 })
    expect(result!.delta).toEqual({ x: 0, y: 0 })
    // 已經在正確位置,新中心應該等於目前中心(不是 target)。
    expect(result!.newCenter.lat).toBeCloseTo(0)
    expect(result!.newCenter.lng).toBeCloseTo(0)
  })

  it('安全區偏上時,新中心必須往下移(方向正確性——這正是踩過的那個 bug)', () => {
    // 安全區是上半部(中心 y=200),容器中心 y=400。target 就在容器
    // 中心(lat=0)。要把它移到安全區中心(往上 200 像素),地圖中心
    // 必須往「下」移 200 像素——地圖往下移,內容在螢幕上就往上跑。
    //
    // 寫反的話新中心會變成 lat=-200(往上),這個斷言就會失敗。
    const result = solve({
      target: { lat: 0, lng: 0 },
      safeRect: { left: 0, top: 0, width: 1000, height: 400 },
    })
    expect(result).not.toBeNull()
    expect(result!.delta).toEqual({ x: 0, y: 200 })
    // y 不翻轉的假投影下,「往下 200 像素」= lat +200。
    expect(result!.newCenter.lat).toBeCloseTo(200)
    expect(result!.newCenter.lng).toBeCloseTo(0)
  })

  it('安全區偏左時,新中心必須往右移', () => {
    // 水平方向的對稱案例——只測垂直的話,x 軸算錯不會被發現。
    // 安全區是左半部(中心 x=250),容器中心 x=500。
    const result = solve({
      target: { lat: 0, lng: 0 },
      safeRect: { left: 0, top: 0, width: 500, height: 800 },
    })
    expect(result).not.toBeNull()
    expect(result!.delta).toEqual({ x: 250, y: 0 })
    expect(result!.newCenter.lng).toBeCloseTo(250)
    expect(result!.newCenter.lat).toBeCloseTo(0)
  })

  it('zoom 每加一級,同樣的像素偏移只需要一半的地理位移', () => {
    // scale = 2^zoom。像素偏移固定時,zoom 越大代表每像素涵蓋的地理
    // 距離越小,所以換算回去的經緯度位移要等比例縮小。
    // 這個案例守住 `/ scale` 那一步沒有寫成 `* scale` 或漏掉。
    const safeRect: Rect = { left: 0, top: 0, width: 1000, height: 400 }
    const atZoom0 = solve({ target: { lat: 0, lng: 0 }, safeRect, zoom: 0 })
    const atZoom1 = solve({ target: { lat: 0, lng: 0 }, safeRect, zoom: 1 })
    const atZoom2 = solve({ target: { lat: 0, lng: 0 }, safeRect, zoom: 2 })

    // delta 是像素,三個 zoom 下都一樣(安全區的像素幾何沒變)。
    expect(atZoom0!.delta.y).toBe(200)
    expect(atZoom1!.delta.y).toBe(200)
    expect(atZoom2!.delta.y).toBe(200)
    // 但換算成地理位移要逐級減半。
    expect(atZoom0!.newCenter.lat).toBeCloseTo(200)
    expect(atZoom1!.newCenter.lat).toBeCloseTo(100)
    expect(atZoom2!.newCenter.lat).toBeCloseTo(50)
  })

  it('支援小數 zoom(Google Maps 的 isFractionalZoomEnabled)', () => {
    // 實機量到的 zoom 是 13.183 這種小數,不是整數——這個案例確保
    // 2 ** zoom 沒有被寫成只處理整數的位元運算(1 << zoom)。
    const result = solve({
      target: { lat: 0, lng: 0 },
      safeRect: { left: 0, top: 0, width: 1000, height: 400 },
      zoom: 0.5,
    })
    expect(result).not.toBeNull()
    expect(result!.newCenter.lat).toBeCloseTo(200 / Math.SQRT2)
  })

  it('安全區塊的 rect 會換算成相對地圖容器的座標', () => {
    // 兩個 rect 都是 getBoundingClientRect() 的結果(相對瀏覽器視窗),
    // 地圖容器本身不一定貼齊視窗左上角。相減那一步漏掉的話,安全區
    // 中心會整個偏移一個容器位置。
    const offsetMapRect: Rect = { left: 100, top: 50, width: 1000, height: 800 }
    const result = solve({
      target: { lat: 0, lng: 0 },
      // 視窗座標 left=100 → 容器座標 left=0,跟上面「安全區在上半部」
      // 那個案例等價,所以期望值也該一致。
      safeRect: { left: 100, top: 50, width: 1000, height: 400 },
      mapRect: offsetMapRect,
    })
    expect(result).not.toBeNull()
    expect(result!.safeRectInMap).toEqual({ left: 0, top: 0, width: 1000, height: 400 })
    expect(result!.safeCenterPixel).toEqual({ x: 500, y: 200 })
    expect(result!.delta).toEqual({ x: 0, y: 200 })
  })

  it('連續套用結果會收斂,不會累積誤差', () => {
    // 這個計算是絕對定位(每次都從當下中心重新算出目的地),不是相對
    // 位移——第一次算完套用後,再算一次 delta 應該就是 0。
    //
    // 這正是 2026-10 不改用 panBy 的理由之一:panBy 是相對位移,連續
    // 快速呼叫(使用者連點 pin)時基準是未定的中間值,會累積偏差。
    const safeRect: Rect = { left: 0, top: 0, width: 500, height: 400 }
    const target = { lat: 123, lng: 456 }

    const first = solve({ target, safeRect })
    expect(first).not.toBeNull()

    const second = solve({ target, currentCenter: first!.newCenter, safeRect })
    expect(second).not.toBeNull()
    expect(second!.delta.x).toBeCloseTo(0)
    expect(second!.delta.y).toBeCloseTo(0)
    // 第二次算出的新中心應該跟第一次相同(已經到位,不再移動)。
    expect(second!.newCenter.lat).toBeCloseTo(first!.newCenter.lat)
    expect(second!.newCenter.lng).toBeCloseTo(first!.newCenter.lng)
  })

  it('套用新中心後,target 的像素位置確實落在安全區中心', () => {
    // 端到端的語意驗證:這個函式承諾的就是這件事,前面的案例都在測
    // 中間步驟,這個直接驗證承諾本身。
    const safeRect: Rect = { left: 120, top: 60, width: 400, height: 300 }
    const target = { lat: 77, lng: -33 }

    const result = solve({ target, safeRect })
    expect(result).not.toBeNull()

    // 把算出來的新中心當作「移動完成後的地圖狀態」再算一次 target
    // 的像素位置,它應該落在安全區中心上。
    const after = solve({ target, currentCenter: result!.newCenter, safeRect })
    expect(after!.targetPixel.x).toBeCloseTo(after!.safeCenterPixel.x)
    expect(after!.targetPixel.y).toBeCloseTo(after!.safeCenterPixel.y)
    expect(after!.safeCenterPixel).toEqual({ x: 320, y: 210 })
  })
})
