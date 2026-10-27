// momijiFrontModel.ts——紅葉前線頁的純邏輯(沒有 DOM、沒有 Google Maps、
// 沒有 canvas),全部可以在 vitest 直接測。
//
// 這個頁面的效果:日本列島上的楓葉依各地的預測見頃日由綠轉黃、轉橙、再轉紅,
// 一路推進到全島染紅;每天有一陣風由北往南掃過,風過之處葉色才更新(視覺
// 效果,不影響哪天變色)。各地變色時程來自日本氣象株式會社 2026-10-01 發表的
// 14 個都市紅葉預測日(資料檔 momijiForecast.ts),座標之間以反距離加權
// 內插(forecastPeakDay)——是示意用的內插,不是逐地點的預測。視覺設計來自
// 使用者給的示意頁(claude.ai artifact「紅葉前線模擬」);那份示意用手繪的
// 假座標系和固定的 60 天,這裡改成真實經緯度與資料推導的日期範圍。
//
// 刻意拆成純函式的理由:渲染層(MomijiFrontPage.tsx)每個 frame 都會呼叫
// 這裡的函式,如果把「風掃到哪、這片葉子現在幾分熟、時間怎麼前進」寫在
// requestAnimationFrame 迴圈裡,就只能靠肉眼看動畫驗證;抽出來之後,熟度
// 隨日期單調推進、顏色端點、楓葉不落海、時間軸循環、預測資料抄寫正確這些
// 性質都有測試守著。

import { JAPAN_LAND } from './japanLand'
import { CITY_FORECASTS, FORECAST_YEAR } from './momijiForecast'

// ===== 模擬時間 =====

// RIPEN_DAYS——一片葉子從「還是綠的」到「預測見頃日完全轉紅」要幾天。預測
// 日只告訴我們「大部分葉子變紅的第一天」,沒有告訴我們之前怎麼變色,這個
// 長度是視覺上的假設(約兩個半星期,綠→黃→橙→紅),不是來源資料。
export const RIPEN_DAYS = 18

const DAY_MS = 86400000
// monthDayToDate——'MM-DD'(見 momijiForecast.ts)轉成當年的 Date。
export function monthDayToDate(md: string): Date {
  const [m, d] = md.split('-').map(Number)
  return new Date(FORECAST_YEAR, m - 1, d)
}
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS)
}

// 模擬的起訖日:第 0 天是「今天」(2026-10 使用者要求「起始日設定為當天」,
// 原本是最早見頃日往前推 RIPEN_DAYS 天的固定日期),所以打開頁面看到的第一
// 幀就是今天各地的狀態——離見頃日已經不到 RIPEN_DAYS 天的地方一開始就已經
// 轉色。最後一天是最晚的預測見頃日(這一天全國都轉紅)。
const peakDates = CITY_FORECASTS.map((c) => monthDayToDate(c.momiji.peak))
const lastPeak = new Date(Math.max(...peakDates.map((d) => d.getTime())))

// resolveSeasonStart——今天(本地 0 點)當起點;但預測資料是特定年份
// (FORECAST_YEAR),今天若已經不早於最晚見頃日(例如隔年再開頁面),退到
// 最後一天的前一天,至少保住 TOTAL_DAYS ≥ 1,頁面會顯示全國已轉紅。
export function resolveSeasonStart(today: Date, last: Date): Date {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (start.getTime() < last.getTime()) return start
  const fallback = new Date(last)
  fallback.setDate(fallback.getDate() - 1)
  return fallback
}
const SEASON_START = resolveSeasonStart(new Date(), lastPeak)

// TOTAL_DAYS——整段模擬跨幾天(第 0 天到第 TOTAL_DAYS 天)。
export const TOTAL_DAYS = daysBetween(SEASON_START, lastPeak)
// DAY_SEC——倍速 1× 時,一天播放幾秒。
export const DAY_SEC = 2.4
// WIND_PART——一天中「風在吹」的時間比例,其餘時間風停、畫面只剩楓葉輕晃。
export const WIND_PART = 0.72
// HOLD_SEC——播到最後一天後停多久再自動從頭播。
export const HOLD_SEC = 3.2

export function dateOfDay(day: number): Date {
  const d = new Date(SEASON_START)
  d.setDate(d.getDate() + day)
  return d
}

// formatMonthDay——'9/28'(sep='/')或 '9月28'(sep='月',呼叫端自己補「日」)。
export function formatMonthDay(d: Date, sep: string): string {
  return `${d.getMonth() + 1}${sep}${d.getDate()}`
}

export interface Clock {
  time: number // 目前模擬時間,單位「天」,0..TOTAL_DAYS,小數部分是一天中的進度
  hold: number // 播到終點後已經停了幾秒
}

export interface ClockStep {
  clock: Clock
  // restarted——這一步剛好從終點自動回到第 0 天。渲染層要在這時候把所有
  // 楓葉直接重設回綠色(snap),而不是讓它們用漸變從紅慢慢變回綠。
  restarted: boolean
}

// advanceClock——播放中時間往前走一步。沒在播放時呼叫端不要呼叫它(時間
// 凍結)。播到 TOTAL_DAYS 之後先停 HOLD_SEC 秒,再回到 0 重播。
export function advanceClock(clock: Clock, dtSec: number, speed: number): ClockStep {
  if (clock.time < TOTAL_DAYS) {
    return { clock: { time: Math.min(TOTAL_DAYS, clock.time + (dtSec * speed) / DAY_SEC), hold: 0 }, restarted: false }
  }
  const hold = clock.hold + dtSec
  if (hold > HOLD_SEC) return { clock: { time: 0, hold: 0 }, restarted: true }
  return { clock: { time: clock.time, hold }, restarted: false }
}

export interface DayState {
  day: number // 整數天,0..TOTAL_DAYS
  frac: number // 這一天內的進度,0..1
  windU: number // 風的前緣位置,在歸一化的 u 軸上(-0.3..1.3)
}

export function dayState(time: number): DayState {
  const day = Math.min(TOTAL_DAYS, Math.floor(time))
  const frac = time - day
  return { day, frac, windU: -0.3 + 1.6 * Math.min(1, frac / WIND_PART) }
}

// windEnvelope——風的強度(0..1):一天中風吹的那段時間內是半個正弦的包絡,
// 開頭結尾趨近 0,所以風是「掃過去」而不是突然出現、突然消失。
// active=false(時間凍結或已播完)時一律 0;scrubbing 時(使用者拖動日期)
// 給固定的 0.5,讓拖動時也看得到風帶,但不會全亮。
export function windEnvelope(frac: number, state: { active: boolean; scrubbing: boolean }): number {
  if (state.active) return Math.sin(Math.PI * Math.min(1, frac / WIND_PART)) ** 0.6
  return state.scrubbing && frac < WIND_PART ? 0.5 : 0
}

// ===== 各地變色時程 =====

// cityPeakDay——某個都市的預測見頃日是模擬的第幾天(小數無意義,整數天)。
export function cityPeakDay(md: string): number {
  return daysBetween(SEASON_START, monthDayToDate(md))
}

// forecastPeakDay——任一座標的「預測見頃日」(模擬的第幾天,可為小數):用
// 14 個都市的預測日做反距離加權內插(權重 ∝ 距離^-3,離都市越近越貼近該都市
// 的預測日,兩都市之間平滑過渡)。這是示意用的內插,不是氣象預測——來源只
// 發布各都市(以及網站上另外約 700 個景點)的預測日,沒有發布面狀的資料,
// 山區與平地的差異(山間部比平野部早約 1 個月)也沒有反映在這裡。
// 距離用經度乘 cos(38°) 的平面近似,精度只需要「誰比較近」。
export function forecastPeakDay(lat: number, lng: number): number {
  let wSum = 0
  let vSum = 0
  for (const c of CITY_FORECASTS) {
    const dx = (lng - c.lng) * COS_LAT
    const dy = lat - c.lat
    const d2 = dx * dx + dy * dy
    const v = cityPeakDay(c.momiji.peak)
    if (d2 < 1e-6) return v
    const w = d2 ** -1.5
    wSum += w
    vSum += w * v
  }
  return vSum / wSum
}

// leafTarget——第 day 天,預測見頃日是 peakDay 的那片葉子應該有多熟(0=綠,
// 1=深紅):見頃日當天剛好 1,往前 RIPEN_DAYS 天是 0,中間線性。對 day 單調
// 不減,對 peakDay 單調不增(預測日越早、越早轉紅)。
export function leafTarget(day: number, peakDay: number): number {
  return Math.max(0, Math.min(1, 1 - (peakDay - day) / RIPEN_DAYS))
}

// effectiveDay——這一刻這片葉子「已經走到第幾天的熟度」。一天之中風吹
// 過葉子(葉子的 u 小於風的前緣)之後,它就算進下一天的熟度——所以葉子是
// 在風掃過去的那一刻變色,不是一整天結束才一起變。
export function effectiveDay(time: number, windU: number, leafU: number): number {
  const { day } = dayState(time)
  const passed = time >= TOTAL_DAYS || leafU < windU
  return Math.min(TOTAL_DAYS, day + (passed ? 1 : 0))
}

// ===== 顏色 =====

// 由綠到深紅的色階。位置是熟度 s(0..1)。
const COLOR_STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [62, 128, 70]],
  [0.22, [150, 176, 58]],
  [0.42, [232, 192, 58]],
  [0.62, [236, 124, 42]],
  [0.84, [204, 44, 52]],
  [1, [150, 22, 42]],
]

// leafRgb——熟度 s 的顏色。hueJ(0..1)是這片葉子綠色階段的個體差異(偏黃綠
// 或偏深綠),只在 s<0.2 時生效並隨熟度淡出;shade(約 ±0.08)是整體明暗
// 抖動。兩者都是生成時固定的亂數,同一片葉子每次呼叫結果一樣。
export function leafRgb(s: number, hueJ: number, shade: number): [number, number, number] {
  const sc = Math.max(0, Math.min(1, s))
  let i = 0
  while (i < COLOR_STOPS.length - 2 && sc > COLOR_STOPS[i + 1][0]) i++
  const [a, ca] = COLOR_STOPS[i]
  const [b, cb] = COLOR_STOPS[i + 1]
  const t = Math.max(0, Math.min(1, (sc - a) / (b - a)))
  let r = ca[0] + (cb[0] - ca[0]) * t
  let g = ca[1] + (cb[1] - ca[1]) * t
  let bl = ca[2] + (cb[2] - ca[2]) * t
  if (sc < 0.2) {
    const k = ((0.2 - sc) / 0.2) * (hueJ - 0.5)
    r += k * 40
    g += k * 30
    bl -= k * 10
  }
  const m = 1 + shade
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * m)))
  return [clamp(r), clamp(g), clamp(bl)]
}

export function leafColor(s: number, hueJ: number, shade: number): string {
  const [r, g, b] = leafRgb(s, hueJ, shade)
  return `rgb(${r},${g},${b})`
}

// ===== 楓葉生成 =====

// 決定性亂數:同一個 seed 永遠產生同一批楓葉,重新整理頁面看到的分布一致。
export function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type LandRing = ReadonlyArray<readonly [number, number]> // [lng, lat]

// pointInRing——射線法判斷 (lng, lat) 是否在多邊形內。
export function pointInRing(lng: number, lat: number, ring: LandRing): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// ===== 經緯度平面與風的方向軸 =====
//
// planar:把經度乘上 cos(38°)(日本中緯度)換成跟緯度等比例的長度單位,
// 這樣「平面上的方向」跟 Google 地圖(墨卡托)上的螢幕方向在局部一致,
// 風帶的斜率才不會因為經緯度單位不同而歪掉。

const COS_LAT = Math.cos((38 * Math.PI) / 180)

// 風的掃過方向:由北往南(平面上 x=東、y=北),略偏西南,對應預測資料裡
// 「北海道最早、本州其次、西日本與九州最晚」的大方向。風只決定每天的視覺
// 掃過順序;各地實際什麼時候變色由預測日決定(見 forecastPeakDay)。
const AXIS_X = -0.25
const AXIS_Y = -1
const AXIS_LEN = Math.hypot(AXIS_X, AXIS_Y)
// 風的方向的單位向量(平面座標:x=東、y=北)。
export const AXIS_DIR = { x: AXIS_X / AXIS_LEN, y: AXIS_Y / AXIS_LEN }
// 同一個方向在螢幕上(y 向下)的單位向量。
export const SCREEN_DIR = { x: AXIS_DIR.x, y: -AXIS_DIR.y }

export function rawU(lng: number, lat: number): number {
  return lng * COS_LAT * AXIS_X + lat * AXIS_Y
}

// ClusterLeaf——楓葉叢裡的單片葉子。偏移 dx/dy 以叢的基準大小為單位
// (渲染層乘上叢的像素大小),size 是相對叢基準大小的倍率。
export interface ClusterLeaf {
  dx: number
  dy: number
  rot: number
  size: number
  shade: number
}

// Leaf——一「叢」楓葉(名稱沿用 Leaf 以免大改):共用一個地理位置、熟度與
// 風吹狀態,每個 frame 只做一次投影換算與狀態更新,畫面上由 members 的
// 2~3 片小葉組成。2026-10 使用者要求「用楓葉叢代替單一楓葉,讓數量減半」。
export interface Leaf {
  members: ClusterLeaf[]
  lat: number
  lng: number
  size: number // 相對尺寸 9..17,實際像素由渲染層依縮放換算
  rot: number
  ph: number // 搖擺相位
  hueJ: number
  shade: number
  u: number // 沿風的方向的歸一化位置 0..1(0=最北端、1=最南端)
  peakDay: number // 這叢預測轉紅的日子(模擬第幾天),由都市預測日內插再加一點亂數
}

export interface MomijiField {
  leaves: Leaf[] // 由北到南排序(南邊的葉子後畫、疊在上面)
  // uToRaw——把歸一化的 u 還原成 rawU 空間的值,畫風帶的位置用。
  uToRaw: (u: number) => number
  // center——風帶定位用的參考點(日本中心附近)。
  center: { lat: number; lng: number }
}

// makeCluster——一叢 2~3 片小葉:沿圓周大致均分再加抖動,半徑與角度、
// 旋轉、大小、明暗都各自隨機,看起來是自然的一小撮而不是整齊的圖案。
function makeCluster(rng: () => number): ClusterLeaf[] {
  const n = 2 + Math.floor(rng() * 2)
  const a0 = rng() * Math.PI * 2
  const out: ClusterLeaf[] = []
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.9
    const r = 0.45 + rng() * 0.4
    out.push({
      dx: Math.cos(a) * r,
      dy: Math.sin(a) * r,
      rot: (rng() - 0.5) * 2.4,
      size: 0.7 + rng() * 0.35,
      shade: (rng() - 0.5) * 0.12,
    })
  }
  return out
}

// createMomijiField——在給定的陸地多邊形內撒 count 叢楓葉。
// 以 bbox 均勻取樣、通過 pointInRing 才收,所以葉子的密度跟面積成正比,
// 不會有楓葉落在外海;海岸線附近因為輪廓簡化(見 japanLand.ts)可能壓到岸邊。
// peakAt(lat, lng)——該座標預測轉紅的日子(見 forecastPeakDay);再各加 ±1.5 天
// 的亂數,讓相鄰葉叢不會剛好同一天轉色、邊緣參差不齊。
export function createMomijiField(
  land: ReadonlyArray<LandRing>,
  count: number,
  seed: number,
  peakAt: (lat: number, lng: number) => number,
): MomijiField {
  const rng = mulberry32(seed)
  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const ring of land) {
    for (const [x, y] of ring) {
      if (x < minLng) minLng = x
      if (x > maxLng) maxLng = x
      if (y < minLat) minLat = y
      if (y > maxLat) maxLat = y
    }
  }
  const raw: Array<Omit<Leaf, 'u' | 'peakDay'> & { r: number }> = []
  let uMin = Infinity
  let uMax = -Infinity
  let guard = 0
  while (raw.length < count && guard++ < count * 400) {
    const lng = minLng + rng() * (maxLng - minLng)
    const lat = minLat + rng() * (maxLat - minLat)
    if (!land.some((ring) => pointInRing(lng, lat, ring))) continue
    const r = rawU(lng, lat)
    if (r < uMin) uMin = r
    if (r > uMax) uMax = r
    raw.push({
      lng,
      lat,
      r,
      size: 9 + rng() * 8,
      rot: (rng() - 0.5) * 1.6,
      ph: rng() * Math.PI * 2,
      hueJ: rng(),
      shade: (rng() - 0.5) * 0.16,
      members: makeCluster(rng),
    })
  }
  const leaves: Leaf[] = raw.map(({ r, ...l }) => {
    const u = (r - uMin) / (uMax - uMin)
    return { ...l, u, peakDay: peakAt(l.lat, l.lng) + (rng() - 0.5) * 3 }
  })
  leaves.sort((a, b) => b.lat - a.lat)
  return {
    leaves,
    uToRaw: (u) => uMin + u * (uMax - uMin),
    center: { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 },
  }
}

// linePoint——歸一化位置 u 的那條風帶中線(垂直於風的方向的直線)穿過的
// 參考點,經緯度。風帶是以這個點為原點、沿垂直方向延伸的直線。
export function linePoint(field: MomijiField, u: number): { lat: number; lng: number } {
  const d = (field.uToRaw(u) - rawU(field.center.lng, field.center.lat)) / AXIS_LEN
  return { lng: field.center.lng + (AXIS_DIR.x * d) / COS_LAT, lat: field.center.lat + AXIS_DIR.y * d }
}

// redShare——已經轉紅(熟度 > 0.78)的楓葉占比,0..100 的整數百分比。
export function redShare(disps: ArrayLike<number>): number {
  if (disps.length === 0) return 0
  let red = 0
  for (let i = 0; i < disps.length; i++) if (disps[i] > 0.78) red++
  return Math.round((red / disps.length) * 100)
}

// 2026-10 使用者要求「減少楓葉數量」(1800 → 600),接著要求「用楓葉叢代替
// 單一楓葉,讓數量減半」:實體數量 600 → 300 叢,每叢 2~3 片小葉。每個
// frame 的投影換算與狀態更新是按叢計算,是繪製成本的主因。
export const MOMIJI_LEAF_COUNT = 300
export const MOMIJI_SEED = 20261018

// createJapanField——頁面實際使用的楓葉場(日本陸地 + 固定 seed)。
export function createJapanField(): MomijiField {
  return createMomijiField(JAPAN_LAND, MOMIJI_LEAF_COUNT, MOMIJI_SEED, forecastPeakDay)
}
