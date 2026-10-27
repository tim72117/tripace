import type { PolylineDrawable } from '../types'
import { FOOTPRINT_LEFT, FOOTPRINT_RIGHT, footprintSpacing } from './footprintIcon'

// routeStyle——連線(站點之間的線)共用的樣式(2026-10,連線樣式柔化)。
//
// 柔化前每段都是單一條硬實線、折點在站上、每 120px 一個又大又黑的實心箭頭。這裡把一條線拆成兩層再疊:
//   1. 底層「光暈」(casing):較寬、低透明度的白線(深色主題用黑)。線在複雜底圖(路網、地名)上
//      多了一圈柔邊,顏色線本身就不必畫得那麼粗、那麼飽和也看得清楚。
//   2. 上層顏色線:比原本細一點、略透明。
// 兩層的兩端各放一顆同色圓點當「圓頭線帽」(Polyline 沒有 strokeLineCap;icon 給 offset 不給 repeat 時
// 只畫一次),接到站點圓點時不會露出方頭。方向箭頭改成白色的「開口箭頭」(FORWARD_OPEN_ARROW,
// 細 chevron、不填色)、縮小、略透明,只放在線的中段(依段長一到五個,起訖兩端不放),只是提示方向、不搶視覺。
//
// Google Polyline 的 icon offset/repeat 單位是螢幕像素(不隨縮放變)、strokeWeight 也是像素,所以這些
// 數值在任何縮放等級看起來一樣。所有連線功能層都從這裡取樣式,hover 虛線也走同一套視覺語言(圓點虛線)。

// google.maps.SymbolPath 的列舉值(功能層不碰 google.maps,所以用字面值;列舉值屬公開 API 不會變動):
// CIRCLE = 0、FORWARD_CLOSED_ARROW = 1、FORWARD_OPEN_ARROW = 2。
const SYMBOL_CIRCLE = 0
export const SYMBOL_FORWARD_OPEN_ARROW = 2

// 線寬(螢幕像素)集中在這裡,之後要再調只動這幾個常數。使用者要求線要細:顏色線 2.5px(舊的是 3~4px),
// 細了就用接近不透明補償可讀性;光暈只比顏色線寬 3.5px(每側 1.75px 的柔邊),透明度低——是柔邊不是粗框。
export const ROUTE_STROKE_WEIGHT = 2.5
export const ROUTE_STROKE_OPACITY = 0.95
export const ROUTE_CASING_WEIGHT = 6
export const ROUTE_CASING_OPACITY_LIGHT = 0.5
export const ROUTE_CASING_OPACITY_DARK = 0.3
// 方向箭頭(白色開口 chevron)的大小:scale 1.7 時 chevron 半寬約 3.4px,與 2.5px 的線搭配不會太突出。
export const ROUTE_ARROW_SCALE = 1.7
export const ROUTE_ARROW_STROKE_WEIGHT = 1.6
// 箭頭放在線上哪些位置(佔線長的百分比),依「段的實際長度(公尺)」分三級(routeArrowOffsets):
// 短段只有中點一個,中段三個,長段五個。為什麼不用 Google 的 repeat:IconSequence 的 repeat 會以 offset 為中心往
// 「兩個方向」重複排列(實測 offset 50% + repeat 150px 時,起點方向也會出現箭頭),使用者要求起點不能有箭頭、
// 起點只留圓頭;百分比位置則保證起訖兩端各留至少 14% 的空白。用公尺分級而不是螢幕像素:功能層不知道縮放等級
// (像素長度隨縮放變),而段的公尺長度與它通常被檢視的尺度相關(幾百公尺的步行段 vs 跨城的長段)。
export const ROUTE_ARROW_OFFSETS_SHORT = ['50%']
export const ROUTE_ARROW_OFFSETS_MEDIUM = ['25%', '50%', '75%']
export const ROUTE_ARROW_OFFSETS_LONG = ['14%', '32%', '50%', '68%', '86%']
// 分級門檻(公尺):不到 1.5 公里算短段(zoom 15 約 300px 以內),不到 6 公里算中段,再長算長段。
export const ROUTE_ARROW_MEDIUM_METERS = 1500
export const ROUTE_ARROW_LONG_METERS = 6000

// routeArrowOffsets——依段的長度(公尺)決定箭頭的百分比位置。回傳的陣列不含 0%/100%,離兩端都至少 14%。
export function routeArrowOffsets(chordMeters: number): string[] {
  if (chordMeters < ROUTE_ARROW_MEDIUM_METERS) return ROUTE_ARROW_OFFSETS_SHORT
  if (chordMeters < ROUTE_ARROW_LONG_METERS) return ROUTE_ARROW_OFFSETS_MEDIUM
  return ROUTE_ARROW_OFFSETS_LONG
}
// hover 圓點虛線:圓點半徑(像素)與間距。
export const DOTTED_RADIUS = 1.5
export const DOTTED_REPEAT = '9px'

type PolylineOptions = NonNullable<PolylineDrawable['options']>
type IconSequence = NonNullable<PolylineOptions['icons']>[number]

// 圓頭線帽:線的兩端各一顆與線同色、同寬的圓點。scale 是半徑(像素),所以是線寬的一半。
function roundCaps(color: string, opacity: number, weight: number): IconSequence[] {
  const icon = { path: SYMBOL_CIRCLE, scale: weight / 2, fillColor: color, fillOpacity: opacity, strokeOpacity: 0 }
  return [
    { icon, offset: '0%' },
    { icon, offset: '100%' },
  ]
}

// 方向箭頭:白色開口 chevron,每個位置一個 IconSequence、不用 repeat(理由見 ROUTE_ARROW_OFFSETS_* 的說明)。
// offsets 預設只有中點一個;呼叫端依段長傳 routeArrowOffsets(...) 的結果。
export function routeArrowIcons(offsets: string[] = ROUTE_ARROW_OFFSETS_SHORT): IconSequence[] {
  const icon = {
    path: SYMBOL_FORWARD_OPEN_ARROW,
    scale: ROUTE_ARROW_SCALE,
    strokeColor: '#ffffff',
    strokeOpacity: 0.9,
    strokeWeight: ROUTE_ARROW_STROKE_WEIGHT,
  }
  return offsets.map((offset) => ({ icon, offset }))
}

// 光暈層的樣式。dark 時用黑色、更低透明度(深色底圖上白光暈太亮)。
export function routeCasingOptions(dark = false): PolylineOptions {
  const color = dark ? '#000000' : '#ffffff'
  const opacity = dark ? ROUTE_CASING_OPACITY_DARK : ROUTE_CASING_OPACITY_LIGHT
  return {
    strokeColor: color,
    strokeOpacity: opacity,
    strokeWeight: ROUTE_CASING_WEIGHT,
    icons: roundCaps(color, opacity, ROUTE_CASING_WEIGHT),
  }
}

// 顏色線層的樣式。arrowOffsets:箭頭位置(沒傳只有中點一個);arrows 為 false 時只有圓頭、沒有方向箭頭。
export function routeStrokeOptions(
  color: string,
  { arrows = true, arrowOffsets }: { arrows?: boolean; arrowOffsets?: string[] } = {},
): PolylineOptions {
  return {
    strokeColor: color,
    strokeOpacity: ROUTE_STROKE_OPACITY,
    strokeWeight: ROUTE_STROKE_WEIGHT,
    icons: [...roundCaps(color, ROUTE_STROKE_OPACITY, ROUTE_STROKE_WEIGHT), ...(arrows ? routeArrowIcons(arrowOffsets) : [])],
  }
}

// 圓點虛線(hover 交通膠囊時用):strokeOpacity 0 的線上沿路鋪小圓點。Polyline 沒有原生 dashed 線型,
// 用 icons 重複鋪 symbol 是官方文件記載的標準做法;原本是短橫線,改成圓點與圓頭線帽同一語言、更柔和。
export function dottedLineOptions(color: string): PolylineOptions {
  return {
    strokeOpacity: 0,
    icons: [
      {
        icon: { path: SYMBOL_CIRCLE, scale: DOTTED_RADIUS, fillColor: color, fillOpacity: 0.95, strokeOpacity: 0 },
        offset: '0',
        repeat: DOTTED_REPEAT,
      },
    ],
  }
}

// 步行段:只有腳印,沒有線(不畫實線、光暈,連底線也沒有)。沿路徑交錯排列左右腳印(footprintIcon.ts,間距與大小隨縮放,
// 見 footprintSpacing)。腳印填強調色、描一圈淡邊(深色底圖用黑、淺色用白),在複雜底圖上也讀得出來。左右腳 offset 錯開
// 一步(各自 repeat 兩步),起點不貼著圓點。
//
// 沒有底線之後,路徑短到放不下一步時(icons 的像素 offset 超出路徑長度就畫不出來)整段會消失。所以呼叫端傳路徑在螢幕上的
// 長度 pathPx:不到兩步(stepPx*2,再乘 ZOOM_ROUNDING_MARGIN)就改用百分比位置各放一隻腳印(35%、65%,不重複),短段至少看得到一對腳印。
// 沒傳 pathPx 就一律走沿路重複。
// 傳進來的 zoom 是取整後的等級(useSharedDrawLayer 的 useRoundedZoom),實際縮放可能比它大最多 0.5 級,
// 路徑的螢幕長度因此最多被高估 2^0.5 倍;判斷「放不放得下」時把門檻乘上這個係數,寧可多走百分比位置也不要
// 讓右腳被推到路徑外畫不出來。
export const ZOOM_ROUNDING_MARGIN = Math.SQRT2
export const FOOTPRINT_SHORT_LEFT_OFFSET = '35%'
export const FOOTPRINT_SHORT_RIGHT_OFFSET = '65%'

// metersToPixels——公尺長度換成螢幕像素(Web Mercator:zoom 0 時赤道每像素 156543.03392 公尺,隨緯度與縮放縮小)。
export function metersToPixels(meters: number, lat: number, zoom: number): number {
  const metersPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
  return meters / metersPerPixel
}

export function routeFootprintOptions(
  color: string,
  { dark = false, zoom, pathPx }: { dark?: boolean; zoom: number; pathPx?: number },
): PolylineOptions {
  const { stepPx, repeatPx, scale } = footprintSpacing(zoom)
  const icon = (path: string) => ({
    path,
    scale,
    fillColor: color,
    fillOpacity: ROUTE_STROKE_OPACITY,
    strokeColor: dark ? '#000000' : '#ffffff',
    strokeOpacity: 0.7,
    strokeWeight: 0.8,
  })
  const fitsRepeat = pathPx === undefined || pathPx >= stepPx * 2 * ZOOM_ROUNDING_MARGIN
  return {
    // strokeOpacity 0:線本身不畫,只有 icons(腳印)。
    strokeOpacity: 0,
    icons: fitsRepeat
      ? [
          { icon: icon(FOOTPRINT_LEFT), offset: `${Math.round(stepPx / 2)}px`, repeat: `${Math.round(repeatPx)}px` },
          { icon: icon(FOOTPRINT_RIGHT), offset: `${Math.round(stepPx * 1.5)}px`, repeat: `${Math.round(repeatPx)}px` },
        ]
      : [
          { icon: icon(FOOTPRINT_LEFT), offset: FOOTPRINT_SHORT_LEFT_OFFSET },
          { icon: icon(FOOTPRINT_RIGHT), offset: FOOTPRINT_SHORT_RIGHT_OFFSET },
        ],
  }
}
