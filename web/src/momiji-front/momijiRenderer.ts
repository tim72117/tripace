// momijiRenderer.ts——把楓葉、風、預測都市與賞楓景點標示畫在「蓋在 Google 地圖上的 canvas」。
// 所有「該畫什麼」的判斷(風掃到哪、葉子多熟、顏色)都在 momijiFrontModel.ts
// 的純函式裡;這裡只負責「經緯度 → 螢幕像素」和實際的 canvas 繪製,以及
// 每片葉子隨時間變化的動畫狀態(漸變中的熟度、被風吹過的餘震)。
//
// 座標換算:2026-10(第三次修正,見 MomijiCanvasOverlay.ts 的完整說明)
// 改用 google.maps.MapCanvasProjection(OverlayView.getProjection() 的
// 回傳型別)的 fromLatLngToDivPixel(),直接拿到相對疊加層容器的像素
// 座標,不需要自己用 fromLatLngToPoint() 算世界座標再乘 2^zoom——這組
// 轉換 Maps 自己內部做,且保證跟地圖當下的視覺渲染同步,不會有「視覺已
// 縮放、projection 還沒更新」的時間差(這正是先前兩輪「縮放時楓葉脫離
// 地圖/慢半拍」的根因,見 MomijiCanvasOverlay.ts 的完整背景說明)。
//
// 尺寸:原示意頁以約 700px 寬的畫布設計(樣式單位是畫布座標),這裡用
// unit = 0.65 × 2^(zoom−5) 把那套單位換成像素,風紋/位移等「跟著地圖
// 實際地理距離縮放」的量持續用這個 unit。
//
// 2026-10 使用者明確要求「地圖放大時,楓葉不要放大」:貼地的楓葉(跟著
// 經緯度定位,place 在地圖陸地上的那些)尺寸改用固定的螢幕像素
// LEAF_PX,不再乘上 unit——葉子在地圖上的「所在位置」仍然跟著地圖縮放
// 平移(用 projection 換算的 px/py 決定),只是「畫多大」這件事脫鉤,
// 不再因為 zoom 變大而跟著放大,比較像疊在地圖上的固定大小圖示,不是
// 貼著地表、縮放時一起放大的地圖要素。
// 被風捲起飛走的 flyers 不貼地(見 Flyer 的完整說明與下方景深效果),
// 維持原本依 unit 換算,不受這次改動影響。

import { getLeafPath } from './leafShape'
import { CITY_FORECASTS } from './momijiForecast'
import { MOMIJI_SPOTS } from './momijiSpots'
import { SPOT_LABEL_FONT, SPOT_LABEL_OFFSET_X } from './spotHit'
import {
  SCREEN_DIR, cityPeakDay, effectiveDay, leafColor, leafTarget, linePoint, mulberry32, redShare,
  type MomijiField,
} from './momijiFrontModel'
import { HOKKAIDO_PATCHES, HOKKAIDO_RING, patchGrowth } from './hokkaidoSnow'
import {
  FLAKE_ALPHA, FLAKE_BUCKETS, FLAKE_FALL_SPEED_PX_S, FLAKE_RADIUS_PX, FLAKE_STRIDE, FLAKE_TRAIL_SEC, F_DEPTH, F_Y,
  COVER_CACHE_STEP, bucketMidDepth, createSnowFlakes, createSnowState, flakeBucket, flakeDrawX, lerpRange, pointInPolyPx, setSnowCacheSig,
  shiftFlakes, stepFlakes, stepSnowState, syncFlakeCount, type SnowBox, type SnowCacheSig,
} from './snowfall'

export interface RenderTick {
  dt: number // 秒
  now: number // 秒,單調時間,給搖擺/風紋相位用
  time: number // 模擬時間(天)
  day: number
  frac: number
  windU: number
  env: number // 風強度 0..1
  windOn: boolean // 風是否正在吹(播放中且未到終點)
  playing: boolean
  snap: boolean // true=所有楓葉直接重設到目標熟度,不做漸變(重播、跳回起點時)
  dark: boolean
  snowing: boolean // 北海道降雪開關(漸強/漸弱與積雪累積/融化由 snowfall.ts 狀態機處理)
}

// ===== 北海道降雪/積雪的配色與可調參數(數量/速度等在 snowfall.ts、hokkaidoSnow.ts)=====
// 積雪斑塊:中間大部分不透明的「平台」+ 很快的邊緣衰減(不是棉花球/雲),零星散在陸地上
// (數量/大小在 hokkaidoSnow.ts)。斑塊畫在離屏快取,每幀只 drawImage 一次(見 drawSnow)。
const SPRITE_PX = 48
const SPRITE_PLATEAU = 0.7 // 半徑比例,這以內完全不透明
// 雪片:依深度分 3 組,遠→近由淡藍灰到白(白雪上才不會消失),短拖尾沿下落方向。
const FLAKE_TRAIL_ALPHA = 0.5
const SNOW_COLORS = {
  light: { patch: '246,250,255', flake: ['rgb(176,200,228)', 'rgb(222,234,246)', 'rgb(255,255,255)'] },
  dark: { patch: '234,241,252', flake: ['rgb(190,210,236)', 'rgb(226,236,250)', 'rgb(250,252,255)'] },
}

// makeSnowSprite——平台 + 快速衰減邊緣的圓形,畫一次重複貼。
function makeSnowSprite(rgb: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = SPRITE_PX
  c.height = SPRITE_PX
  const ctx = c.getContext('2d')
  if (ctx) {
    const r = SPRITE_PX / 2
    const g = ctx.createRadialGradient(r, r, 0, r, r, r)
    g.addColorStop(0, `rgba(${rgb},1)`)
    g.addColorStop(SPRITE_PLATEAU, `rgba(${rgb},1)`)
    g.addColorStop(0.88, `rgba(${rgb},0.35)`)
    g.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, SPRITE_PX, SPRITE_PX)
  }
  return c
}

interface Streak {
  y: number
  dx: number
  len: number
  amp: number
  f: number
  ph: number
  w: number
  a: number
}

interface Flyer {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
  size: number
  life: number
  max: number
  col: string
  ph: number
  // z0/z1——2026-10 新增(使用者明確要求「風吹過飄出的楓葉多一點景深
  // 感,就是會飄近放大飄遠縮小的感覺」):這片飛葉的景深軌跡起點/終點,
  // 隨 life/max 的進度在兩者之間線性插值(見 draw 迴圈裡的 depthScale
  // 計算)。z0 可能大於或小於 z1——隨機決定「先飄近、再飄遠」還是
  // 「先飄遠、再飄近」兩種軌跡都會出現,畫面上同時有多片飛葉時才會有
  // 「有些變大、有些變小」的立體層次感,不是全部同步放大縮小。
  z0: number
  z1: number
}

// LEAF_PX/LEAF_SIZE_REF——貼地楓葉的固定螢幕像素大小(見下方 draw 迴圈
// 用法的完整說明)。LEAF_SIZE_REF 是 Leaf.size(見 momijiFrontModel.ts
// createMomijiField,範圍 9~17)的中位數參考值,讓每片葉子仍保留原本
// 9~17 的相對大小差異比例,只是不再乘上隨 zoom 變大的 unit。
const LEAF_PX = 9
const LEAF_SIZE_REF = 13

// 風帶/風紋的配色:淺色底圖用藍灰、深色底圖用偏白的冷色,才看得到。
const WIND_COLORS = {
  light: { band: '70,120,150', bandA: 0.13, streak: '60,100,130', streakA: 0.55, accent: '#c4283a' },
  dark: { band: '200,225,245', bandA: 0.1, streak: '225,240,255', streakA: 0.6, accent: '#ef5a5f' },
}

function makeStreaks(day: number): Streak[] {
  const r = mulberry32(day * 7919 + 13)
  const out: Streak[] = []
  for (let i = 0; i < 34; i++) {
    out.push({
      y: (r() - 0.5) * 1300,
      dx: (r() - 0.7) * 120,
      len: 90 + r() * 220,
      amp: 3 + r() * 9,
      f: 0.012 + r() * 0.02,
      ph: r() * 6.28,
      w: 0.8 + r() * 1.8,
      a: 0.35 + r() * 0.65,
    })
  }
  return out
}

export function createMomijiRenderer(field: MomijiField) {
  const leaves = field.leaves
  const n = leaves.length
  // 每片葉子的動畫狀態
  const disp = new Float32Array(n) // 目前顯示的熟度(會往目標漸變)
  const kick = new Float32Array(n) // 風剛掃過後的餘震強度,隨時間衰減
  const lastD = new Int16Array(n) // 上一個 frame 的 effectiveDay,偵測「剛被風掃過」
  let streaks: Streak[] = []
  let streakDay = -1
  const flyers: Flyer[] = []

  function spawnFlyer(x: number, y: number, rot: number, size: number, col: string, unit: number) {
    if (flyers.length > 140) return
    const sp = () => (60 + Math.random() * 90) * unit
    // z0/z1——見 Flyer 介面的完整說明:0.6~1.5 之間隨機取兩個景深值當
    // 飛行軌跡的起點/終點,範圍涵蓋「比葉子原本大小更小」到「更大」,
    // 讓飄近/飄遠的縮放效果看得出來、不會太細微。
    const randZ = () => 0.6 + Math.random() * 0.9
    flyers.push({
      x, y, rot, size: size * 0.8, col,
      vx: SCREEN_DIR.x * sp() + (Math.random() - 0.5) * 30 * unit,
      vy: SCREEN_DIR.y * sp() + (Math.random() - 0.5) * 30 * unit,
      vr: (Math.random() - 0.5) * 8,
      life: 0, max: 1.6 + Math.random() * 1.4, ph: Math.random() * 6.28,
      z0: randZ(), z1: randZ(),
    })
  }

  // leafLatLngs——每片葉子的經緯度只需要包成一次 google.maps.LatLng
  // 物件(建構子開銷不算小,300 叢楓葉每 frame 重建一次不划算),跟
  // 原本 wx/wy 快取世界座標的用意相同,只是現在快取的是 LatLng 物件
  // 本身,換算像素的工作交給 fromLatLngToDivPixel 當下即時算(見下方
  // draw 的完整說明)。
  let leafLatLngs: google.maps.LatLng[] | null = null

  // ===== 北海道降雪/積雪狀態(見 snowfall.ts、hokkaidoSnow.ts)=====
  // 輪廓與斑塊的 LatLng 跟楓葉一樣只包一次;ringPx 是輪廓投影結果的預配置緩衝,
  // 每幀只對抽稀後的輪廓點與斑塊呼叫 fromLatLngToDivPixel。
  const snowState = createSnowState()
  let snowInitialized = false
  const flakes = createSnowFlakes()
  let ringLatLngs: google.maps.LatLng[] | null = null
  let patchLatLngs: google.maps.LatLng[] | null = null
  const ringPx = new Float32Array(HOKKAIDO_RING.length * 2)
  const snowBox: SnowBox = { x0: 0, y0: 0, x1: 0, y1: 0 }
  const sprites = { light: null as HTMLCanvasElement | null, dark: null as HTMLCanvasElement | null }
  // 積雪離屏快取:只涵蓋「北海道 bbox ∩ 畫布」那塊,簽名(snowfall.ts setSnowCacheSig)變了才重畫。
  let patchCache: HTMLCanvasElement | null = null
  let patchCacheCtx: CanvasRenderingContext2D | null = null
  const cacheSig: SnowCacheSig = { ax: NaN, ay: NaN, bx: NaN, by: NaN, coverQ: -1, dark: false, width: 0, height: 0, dpr: 0 }
  const cacheRect = { x: 0, y: 0, w: 0, h: 0 } // 畫布 CSS 座標

  // rebuildPatchCache——把目前 cover 下長出來的斑塊畫進離屏 canvas(座標 = 畫布座標 − cacheRect 原點)。
  function rebuildPatchCache(
    proj: google.maps.MapCanvasProjection, ox: number, oy: number, unit: number, k: number, cover: number,
    latLngs: google.maps.LatLng[], sprite: HTMLCanvasElement,
  ) {
    patchCache ??= document.createElement('canvas')
    patchCacheCtx ??= patchCache.getContext('2d')
    const c = patchCacheCtx
    if (!c) return
    const pw = Math.ceil(cacheRect.w * k)
    const ph = Math.ceil(cacheRect.h * k)
    // 設定 width/height 會清空;尺寸沒變就 clearRect(便宜很多)。
    if (patchCache.width !== pw || patchCache.height !== ph) {
      patchCache.width = pw
      patchCache.height = ph
    } else {
      c.setTransform(1, 0, 0, 1, 0, 0)
      c.clearRect(0, 0, pw, ph)
    }
    c.setTransform(k, 0, 0, k, -cacheRect.x * k, -cacheRect.y * k)
    for (let i = 0; i < HOKKAIDO_PATCHES.length; i++) {
      const pt = HOKKAIDO_PATCHES[i]
      const g = patchGrowth(cover, pt.threshold)
      if (g <= 0) continue
      const p = proj.fromLatLngToDivPixel(latLngs[i])
      if (!p) continue
      const x = p.x - ox
      const y = p.y - oy
      const rx = pt.rx * unit * g
      const ry = pt.ry * unit * g
      if (x + rx < cacheRect.x || x - rx > cacheRect.x + cacheRect.w || y + ry < cacheRect.y || y - ry > cacheRect.y + cacheRect.h) continue
      c.globalAlpha = pt.alpha * g
      c.drawImage(sprite, x - rx, y - ry, rx * 2, ry * 2)
    }
    c.globalAlpha = 1
  }

  // draw——畫一個 frame。回傳目前轉紅的百分比;投影還沒準備好時回傳
  // null,呼叫端這時不要推進時間。
  //
  // mapLike——2026-10 第三次修正(見 MomijiCanvasOverlay.ts 的完整
  // 說明):不再直接吃 google.maps.Map,改吃一個最小介面——projection
  // 來自 OverlayView.getProjection()(MapCanvasProjection,只有
  // fromLatLngToDivPixel,沒有 fromLatLngToPoint 那一套世界座標 API),
  // zoom 仍然要從 map 本身讀(OverlayView 沒有自己的 getZoom)。這個
  // 介面刻意拆成兩個獨立欄位,不要求呼叫端一定要傳同一個物件湊出完整
  // 的 google.maps.Map 形狀。
  // originX/originY:canvas 左上角在 div pixel 座標系的位置(見
  // MomijiCanvasOverlay.layout())。fromLatLngToDivPixel 的結果要減掉它
  // 才是 canvas 內座標。
  let lastOriginX = 0
  let lastOriginY = 0

  function draw(
    ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number,
    mapLike: {
      projection: google.maps.MapCanvasProjection | null
      zoom: number | null
      originX: number
      originY: number
    } | null,
    t: RenderTick,
  ): number | null {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, width * dpr, height * dpr)
    const proj = mapLike?.projection
    const zoom = mapLike?.zoom
    if (!mapLike || !proj || zoom == null) return null
    const { originX: ox, originY: oy } = mapLike

    // canvas 重新定位(pan 超出外擴範圍或縮放後)時,飛葉的 canvas 座標
    // 要跟著平移,才會留在原本的螢幕位置。
    if (ox !== lastOriginX || oy !== lastOriginY) {
      for (const f of flyers) {
        f.x -= ox - lastOriginX
        f.y -= oy - lastOriginY
      }
      shiftFlakes(flakes, ox - lastOriginX, oy - lastOriginY)
      lastOriginX = ox
      lastOriginY = oy
    }

    if (!leafLatLngs) {
      leafLatLngs = leaves.map((l) => new google.maps.LatLng(l.lat, l.lng))
    }
    const unit = 0.65 * 2 ** (zoom - 5)
    const toScreen = (lat: number, lng: number): [number, number] => {
      const p = proj.fromLatLngToDivPixel(new google.maps.LatLng(lat, lng))
      return p ? [p.x - ox, p.y - oy] : [0, 0]
    }
    const colors = t.dark ? WIND_COLORS.dark : WIND_COLORS.light
    const k = dpr

    if (streakDay !== t.day) {
      streaks = makeStreaks(t.day)
      streakDay = t.day
    }

    // ===== 楓葉 =====
    const leaf = getLeafPath()
    const lerpK = 1 - Math.exp(-t.dt * (t.playing ? 3.2 : 10))
    const kickDecay = Math.exp(-t.dt * 1.6)
    for (let i = 0; i < n; i++) {
      const l = leaves[i]
      const D = effectiveDay(t.time, t.windU, l.u)
      let spawn = false
      if (t.windOn && D === lastD[i] + 1) {
        kick[i] = 1
        if (disp[i] > 0.55 && Math.random() < 0.035) spawn = true
      }
      lastD[i] = D
      const target = leafTarget(D, l.peakDay)
      disp[i] = t.snap ? target : disp[i] + (target - disp[i]) * lerpK
      kick[i] *= kickDecay

      // fromLatLngToDivPixel——2026-10 第三次修正(見檔頭說明):直接拿
      // OverlayView 的投影算像素座標,取代原本自己用世界座標減法+乘
      // 2^zoom 手動換算。leafLatLngs[i] 是快取好的 LatLng 物件(見上方
      // 完整說明),不用每個 frame 重建。
      const pxy = proj.fromLatLngToDivPixel(leafLatLngs[i])
      if (!pxy) continue
      const px = pxy.x - ox
      const py = pxy.y - oy
      if (px < -40 || py < -40 || px > width + 40 || py > height + 40) continue

      const gust = t.env > 0 ? Math.exp(-(((l.u - t.windU) / 0.045) ** 2)) * t.env : 0
      const sway = Math.sin(t.now * 1.3 + l.ph) * 0.07
      const flutter = (gust * 0.75 + kick[i] * 0.3) * Math.sin(t.now * 10 + l.ph)
      const push = gust * 7 + kick[i] * 2.5 * Math.sin(t.now * 6 + l.ph)
      const flip = 1 - Math.min(0.85, gust * 0.8 * Math.abs(Math.sin(t.now * 7 + l.ph)))
      // s——葉叢的基準像素大小。2026-10 使用者要求「地圖放大時,楓葉不要放大」:
      // 用固定螢幕像素 LEAF_PX,不乘隨 zoom 指數成長的 unit;位置(px/py)
      // 仍由 projection 換算,跟著地圖走。
      const s = LEAF_PX * (l.size / LEAF_SIZE_REF)
      const rot = l.rot + sway + flutter
      const x = px + SCREEN_DIR.x * push * unit
      const y = py + SCREEN_DIR.y * push * unit
      if (spawn) spawnFlyer(x, y, rot, s, leafColor(disp[i], l.hueJ, l.shade), unit)
      // 一叢 2~3 片小葉:位置/熟度/風吹狀態共用,每片只有偏移、旋轉、大小、
      // 明暗各自不同(見 momijiFrontModel.makeCluster)。
      for (const m of l.members) {
        const ms = s * m.size
        const mr = rot + m.rot
        const c = Math.cos(mr)
        const sn = Math.sin(mr)
        ctx.setTransform(c * ms * flip * k, sn * ms * flip * k, -sn * ms * k, c * ms * k, (x + m.dx * s) * k, (y + m.dy * s) * k)
        ctx.fillStyle = leafColor(disp[i], l.hueJ, l.shade + m.shade)
        ctx.fill(leaf)
      }
    }

    // ===== 被風捲起的飛葉 =====
    for (let i = flyers.length - 1; i >= 0; i--) {
      const f = flyers[i]
      f.life += t.dt
      if (f.life > f.max) { flyers.splice(i, 1); continue }
      f.x += f.vx * t.dt
      f.y += f.vy * t.dt + Math.sin(t.now * 4 + f.ph) * 0.6
      f.vy += 12 * unit * t.dt
      f.rot += f.vr * t.dt
      const a = Math.min(1, f.life * 4) * (1 - f.life / f.max)
      const fl = Math.cos(t.now * 6 + f.ph)
      const c = Math.cos(f.rot)
      const sn = Math.sin(f.rot)
      // depthScale——2026-10 新增(使用者明確要求「風吹過飄出的楓葉
      // 多一點景深感,就是會飄近放大飄遠縮小的感覺」):在 z0→z1 之間
      // 用 smoothstep(3p²−2p³,兩端切線為 0,比線性插值更柔順,加減速
      // 感覺自然)插值,乘上原本的 f.size,讓每片飛葉的大小隨飛行進度
      // 連續變化,不是從頭到尾固定一個尺寸——同一批飛葉的 z0/z1 各自
      // 隨機(見 spawnFlyer 的完整說明),有些先放大後縮小(飄近又飄
      // 遠)、有些相反,一批葉子同時飛舞時才有深淺不一的立體層次。
      const dp = f.life / f.max
      const depthT = dp * dp * (3 - 2 * dp)
      const depthScale = f.z0 + (f.z1 - f.z0) * depthT
      const fs = f.size * depthScale
      ctx.globalAlpha = a
      ctx.setTransform(c * fs * fl * k, sn * fs * fl * k, -sn * fs * k, c * fs * k, f.x * k, f.y * k)
      ctx.fillStyle = f.col
      ctx.fill(leaf)
    }
    ctx.globalAlpha = 1

    drawWind(ctx, t.windU, t.env, t.now, unit, k, toScreen, colors, streaks)
    // 雪在楓葉/飛葉/風之後、都市標籤與景點徽章之前:標籤與徽章不能被雪蓋住。
    drawSnow(ctx, width, height, k, proj, ox, oy, unit, t)
    drawCities(ctx, t.time, k, toScreen, t.dark, colors.accent)
    drawSpots(ctx, k, toScreen, t.dark, colors.accent)
    return redShare(disp)
  }

  // drawSnow——北海道降雪與積雪。不用 ctx.clip(每個繪製都要過遮罩,是光柵化的大成本):
  // 積雪斑塊本來就生成在輪廓內,畫進離屏快取每幀貼一次;雪片逐片做點在多邊形判斷
  // (pointInPolyPx),只畫在陸地上的。北海道完全不在畫布內時整段跳過(含粒子更新)。
  function drawSnow(
    ctx: CanvasRenderingContext2D, width: number, height: number, k: number,
    proj: google.maps.MapCanvasProjection, ox: number, oy: number, unit: number, t: RenderTick,
  ) {
    // 第一次畫時開關是關的(例如系統設為減少動態):積雪量直接從 0 開始,不要先顯示初始積雪再融掉。
    if (!snowInitialized) {
      snowInitialized = true
      if (!t.snowing) {
        snowState.cover = 0
        snowState.intensity = 0
      }
    }
    stepSnowState(snowState, t.dt, t.snowing)
    const { intensity, cover } = snowState
    if (intensity <= 0.001 && cover <= 0.001) return

    ringLatLngs ??= HOKKAIDO_RING.map(([lng, lat]) => new google.maps.LatLng(lat, lng))
    patchLatLngs ??= HOKKAIDO_PATCHES.map((p) => new google.maps.LatLng(p.lat, p.lng))
    let bx0 = Infinity
    let by0 = Infinity
    let bx1 = -Infinity
    let by1 = -Infinity
    for (let i = 0; i < ringLatLngs.length; i++) {
      const p = proj.fromLatLngToDivPixel(ringLatLngs[i])
      if (!p) return
      const x = p.x - ox
      const y = p.y - oy
      ringPx[i * 2] = x
      ringPx[i * 2 + 1] = y
      if (x < bx0) bx0 = x
      if (x > bx1) bx1 = x
      if (y < by0) by0 = y
      if (y > by1) by1 = y
    }
    if (bx1 < 0 || by1 < 0 || bx0 > width || by0 > height) return
    const mode = t.dark ? 'dark' : 'light'
    const colors = SNOW_COLORS[mode]
    const sprite = (sprites[mode] ??= makeSnowSprite(colors.patch))
    const n = ringLatLngs.length

    // 積雪:簽名沒變就直接貼快取;變了(平移/縮放/cover 跨階/換色)才重畫斑塊。
    if (cover > 0.001) {
      const mid = (n >> 1) * 2
      if (setSnowCacheSig(cacheSig, ringPx[0], ringPx[1], ringPx[mid], ringPx[mid + 1], cover, t.dark, width, height, k)) {
        cacheRect.x = Math.max(0, Math.floor(bx0))
        cacheRect.y = Math.max(0, Math.floor(by0))
        cacheRect.w = Math.min(width, Math.ceil(bx1)) - cacheRect.x
        cacheRect.h = Math.min(height, Math.ceil(by1)) - cacheRect.y
        // 用簽名裡的量化值畫(不是這一刻的原始 cover):快取內容要完全由簽名決定,否則 cover 在同一階內繼續增加
        // (例如 0.675 → 0.7)時簽名不變、不會重建,畫面就一直停在重建當下的舊值。
        rebuildPatchCache(proj, ox, oy, unit, k, cacheSig.coverQ * COVER_CACHE_STEP, patchLatLngs, sprite)
      }
      if (patchCache && cacheRect.w > 0 && cacheRect.h > 0) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        const pw = Math.ceil(cacheRect.w * k)
        const ph = Math.ceil(cacheRect.h * k)
        ctx.drawImage(patchCache, 0, 0, pw, ph, Math.round(cacheRect.x * k), Math.round(cacheRect.y * k), pw, ph)
      }
    }

    // 雪片:活動範圍 = 輪廓 bbox ∩ 畫布;只畫落在輪廓內的;3 個深度組各一個 path。
    if (intensity > 0.001) {
      snowBox.x0 = Math.max(0, bx0)
      snowBox.y0 = Math.max(0, by0)
      snowBox.x1 = Math.min(width, bx1)
      snowBox.y1 = Math.min(height, by1)
      syncFlakeCount(flakes, snowBox)
      stepFlakes(flakes, t.dt, t.now, snowBox)
      const { data, count } = flakes
      ctx.setTransform(k, 0, 0, k, 0, 0)
      ctx.lineCap = 'round'
      for (let b = 0; b < FLAKE_BUCKETS; b++) {
        const md = bucketMidDepth(b)
        const alpha = lerpRange(FLAKE_ALPHA, md) * intensity
        const r = lerpRange(FLAKE_RADIUS_PX, md)
        const trail = lerpRange(FLAKE_FALL_SPEED_PX_S, md) * FLAKE_TRAIL_SEC * (0.5 + md)
        ctx.fillStyle = colors.flake[b]
        ctx.strokeStyle = colors.flake[b]
        ctx.lineWidth = r * 0.9
        // 拖尾
        ctx.globalAlpha = alpha * FLAKE_TRAIL_ALPHA
        ctx.beginPath()
        for (let i = 0; i < count; i++) {
          const o = i * FLAKE_STRIDE
          if (flakeBucket(data[o + F_DEPTH]) !== b) continue
          const x = flakeDrawX(data, i, t.now)
          const y = data[o + F_Y]
          if (!pointInPolyPx(ringPx, n, x, y)) continue
          ctx.moveTo(x, y)
          ctx.lineTo(x, y - trail)
        }
        ctx.stroke()
        // 圓點
        ctx.globalAlpha = alpha
        ctx.beginPath()
        for (let i = 0; i < count; i++) {
          const o = i * FLAKE_STRIDE
          if (flakeBucket(data[o + F_DEPTH]) !== b) continue
          const x = flakeDrawX(data, i, t.now)
          const y = data[o + F_Y]
          if (!pointInPolyPx(ringPx, n, x, y)) continue
          ctx.moveTo(x + r, y)
          ctx.arc(x, y, r, 0, Math.PI * 2)
        }
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }
  }

  // drawCities——14 個預測都市的標示:圓點 + 「都市名 預測日」。預測日還沒到
  // 是空心點,到了(模擬時間 ≥ 該都市預測見頃日)變實心的強調色,讓使用者
  // 看得到「資料點在哪、各地是哪天」。字體固定螢幕像素(不隨縮放變大),
  // 加一圈反色描邊確保壓在楓葉上也讀得到。
  function drawCities(
    ctx: CanvasRenderingContext2D, time: number, k: number,
    toScreen: (lat: number, lng: number) => [number, number],
    dark: boolean, accent: string,
  ) {
    ctx.setTransform(k, 0, 0, k, 0, 0)
    ctx.font = '600 11px -apple-system, "Hiragino Sans", "PingFang TC", sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    for (const c of CITY_FORECASTS) {
      const [x, y] = toScreen(c.lat, c.lng)
      const reached = time >= cityPeakDay(c.momiji.peak)
      ctx.beginPath()
      ctx.arc(x, y, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = reached ? accent : dark ? '#101a21' : '#faf7f0'
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = dark ? '#ece6da' : '#2b2620'
      ctx.stroke()
      const [mm, dd] = c.momiji.peak.split('-').map(Number)
      const label = `${c.nameZh} ${mm}/${dd}`
      ctx.lineWidth = 3
      ctx.strokeStyle = dark ? 'rgba(16,26,33,0.85)' : 'rgba(250,247,240,0.9)'
      ctx.strokeText(label, x - 7, y)
      ctx.fillStyle = dark ? '#ece6da' : '#2b2620'
      ctx.fillText(label, x - 7, y)
    }
    ctx.textBaseline = 'alphabetic'
  }

  // drawSpots——知名賞楓景點:白(深色模式用深)底圓徽章 + 強調色外圈 + 楓葉圖示
  // + 名稱(畫在徽章右側,都市標籤畫在圓點左側,兩邊不互相壓)。名稱一律顯示:
  // 這是頁面要標出來的重點,縮小到看不出是哪個景點就失去意義。京都/奈良一帶
  // 密度高,縮小時標籤仍會靠得很近,放大即可分開。徽章畫在都市標示之後。
  function drawSpots(
    ctx: CanvasRenderingContext2D, k: number,
    toScreen: (lat: number, lng: number) => [number, number],
    dark: boolean, accent: string,
  ) {
    ctx.setTransform(k, 0, 0, k, 0, 0)
    const leaf = getLeafPath()
    ctx.font = SPOT_LABEL_FONT
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    for (const sp of MOMIJI_SPOTS) {
      const [x, y] = toScreen(sp.lat, sp.lng)
      ctx.setTransform(k, 0, 0, k, 0, 0)
      ctx.beginPath()
      ctx.arc(x, y, 9, 0, Math.PI * 2)
      ctx.fillStyle = dark ? '#111920' : '#faf7f0'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = accent
      ctx.stroke()
      // 楓葉圖示:葉心略往上,讓葉柄落在圓心下方
      ctx.setTransform(6.5 * k, 0, 0, 6.5 * k, x * k, (y - 0.5) * k)
      ctx.fillStyle = accent
      ctx.fill(leaf)
      ctx.setTransform(k, 0, 0, k, 0, 0)
      // 有精選行程的景點(可點,見 spotItinerary.ts):徽章右上角加一顆實心小點,
      // 跟只有標示的景點區分。
      if (sp.itineraryId) {
        ctx.beginPath()
        ctx.arc(x + 7.5, y - 7.5, 3.5, 0, Math.PI * 2)
        ctx.fillStyle = accent
        ctx.fill()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = dark ? '#111920' : '#faf7f0'
        ctx.stroke()
      }
      ctx.lineWidth = 3.5
      ctx.strokeStyle = dark ? 'rgba(16,26,33,0.9)' : 'rgba(250,247,240,0.95)'
      ctx.strokeText(sp.name, x + SPOT_LABEL_OFFSET_X, y)
      ctx.fillStyle = accent
      ctx.fillText(sp.name, x + SPOT_LABEL_OFFSET_X, y)
    }
    ctx.setTransform(k, 0, 0, k, 0, 0)
    ctx.textBaseline = 'alphabetic'
  }

  function drawWind(
    ctx: CanvasRenderingContext2D, windU: number, env: number, now: number, unit: number, k: number,
    toScreen: (lat: number, lng: number) => [number, number],
    colors: typeof WIND_COLORS.light, sk: Streak[],
  ) {
    if (env <= 0.001) return
    const c = linePoint(field, windU)
    const [px, py] = toScreen(c.lat, c.lng)
    ctx.setTransform(k, 0, 0, k, 0, 0)
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(Math.atan2(SCREEN_DIR.y, SCREEN_DIR.x))
    ctx.scale(unit, unit)
    // 光帶
    const bw = 150
    const g = ctx.createLinearGradient(-bw * 1.6, 0, bw * 0.5, 0)
    g.addColorStop(0, `rgba(${colors.band},0)`)
    g.addColorStop(0.75, `rgba(${colors.band},${colors.bandA * env})`)
    g.addColorStop(1, `rgba(${colors.band},0)`)
    ctx.fillStyle = g
    ctx.fillRect(-bw * 1.6, -900, bw * 2.1, 1800)
    // 風紋
    ctx.lineCap = 'round'
    for (const s of sk) {
      const head = s.dx
      const tail = s.dx - s.len
      const grad = ctx.createLinearGradient(tail, 0, head, 0)
      grad.addColorStop(0, `rgba(${colors.streak},0)`)
      grad.addColorStop(1, `rgba(${colors.streak},${colors.streakA * s.a * env})`)
      ctx.strokeStyle = grad
      ctx.lineWidth = s.w
      ctx.beginPath()
      for (let x = tail; x <= head; x += 8) {
        const y = s.y + Math.sin(x * s.f + s.ph + now * 2.2) * s.amp * ((x - tail) / s.len)
        if (x === tail) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  return { draw }
}
