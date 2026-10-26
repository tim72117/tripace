// lighting.ts——時間 → 光照設定的關鍵幀插值(純函式,不依賴 three)。
//
// layout.lighting 是一串關鍵時刻(天空、霧、太陽、半球光、燈籠發光)。時間在兩個相鄰關鍵時刻
// 之間線性插值;跨過午夜時(最後一筆回接第一筆)沿著 24 小時圓環內插,所以 22:00 → 06:00
// 的過渡是連續的。顏色在 sRGB 空間線性內插(原型夠用,不做感知均勻色彩空間)。
import type { LightKey } from '../data/layoutTypes'

export const MINUTES_PER_DAY = 24 * 60

export function parseTime(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) throw new Error(`時間格式錯誤: ${hhmm}`)
  return Number(m[1]) * 60 + Number(m[2])
}

export function formatTime(minutes: number): string {
  const m = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export function lerpColor(a: string, b: string, t: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  return rgbToHex([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t])
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export type LightState = Omit<LightKey, 'time'>

// sampleLight——給定一天中的分鐘數(可超出 0..1440,會取模),回傳插值後的光照。
export function sampleLight(keys: ReadonlyArray<LightKey>, minutes: number): LightState {
  if (keys.length === 0) throw new Error('lighting 不能是空的')
  const sorted = [...keys].map((k) => ({ k, m: parseTime(k.time) })).sort((a, b) => a.m - b.m)
  const t = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  // 找到包住 t 的兩個關鍵幀(環狀)
  let prev = sorted[sorted.length - 1]
  let next = sorted[0]
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].m <= t) prev = sorted[i]
    if (sorted[i].m > t) { next = sorted[i]; break }
    if (i === sorted.length - 1) next = sorted[0]
  }
  let span = next.m - prev.m
  let off = t - prev.m
  if (span <= 0) span += MINUTES_PER_DAY
  if (off < 0) off += MINUTES_PER_DAY
  const f = prev === next ? 0 : Math.max(0, Math.min(1, off / span))
  const a = prev.k
  const b = next.k
  return {
    skyTop: lerpColor(a.skyTop, b.skyTop, f),
    skyBottom: lerpColor(a.skyBottom, b.skyBottom, f),
    fog: lerpColor(a.fog, b.fog, f),
    sun: lerpColor(a.sun, b.sun, f),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, f),
    sunElevationDeg: lerp(a.sunElevationDeg, b.sunElevationDeg, f),
    sunAzimuthDeg: lerp(a.sunAzimuthDeg, b.sunAzimuthDeg, f),
    hemiSky: lerpColor(a.hemiSky, b.hemiSky, f),
    hemiGround: lerpColor(a.hemiGround, b.hemiGround, f),
    hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity, f),
    lanternGlow: lerp(a.lanternGlow, b.lanternGlow, f),
  }
}
