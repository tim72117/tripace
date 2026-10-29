// mini.ts——縮小版(首頁展示用)的純邏輯:固定光照預設、何時該跑、鏡頭距離。
//
// 縮小版不做日夜變化,只凍結在一個好看的時刻:亮色主題用夕陽(17:30,暖橘)、暗色主題用夜晚(19:30,
// 藍紫),兩者燈籠都全亮——展示模型時,亮著的紅燈籠最吸睛。
import { parseTime } from './lighting'

export type MiniTheme = 'light' | 'dark'

export function presetMinutes(theme: MiniTheme): number {
  return parseTime(theme === 'dark' ? '19:30' : '17:30')
}

export type RunState = { intersecting: boolean; docVisible: boolean; webgl: boolean; contextLost: boolean }

// shouldRun——是否該繼續繪製。離開畫面、分頁隱藏、WebGL 不可用或內容遺失時一律停止,
// 這是首頁常駐展示最重要的省電措施。
export function shouldRun(s: RunState): boolean {
  return s.intersecting && s.docVisible && s.webgl && !s.contextLost
}

// 「減少動態」偏好時不自動旋轉:島停在角度 0 的封面角度,只畫一幀(縮小版本來就不能拖曳)。
export function autoRotateEnabled(reducedMotion: boolean): boolean {
  return !reducedMotion
}

// shouldDrawFrame——幀率節流:距離上一次繪製累積的秒數 accum 達到 interval 才畫。
// 首頁常駐展示用 30fps(旋轉每秒只有 7.5°,30fps 下每幀 0.25° 肉眼看不出差別,GPU 工作量減半)。
// 容許一點浮點誤差,避免 1/30 秒剛好卡在邊界時被連續跳過。
export function shouldDrawFrame(accum: number, interval: number): boolean {
  return interval <= 0 || accum >= interval - 1e-6
}

// cameraDistance——讓半徑 radius 的球剛好放進視野(取垂直與水平視角中較緊的那個),再留一點邊距。
export function cameraDistance(radius: number, vfovDeg: number, aspect: number, margin = 1.1): number {
  const v = (vfovDeg * Math.PI) / 180
  const h = 2 * Math.atan(Math.tan(v / 2) * aspect)
  return (radius * margin) / Math.sin(Math.min(v, h) / 2)
}

// rotationAt——自動旋轉的角度(弧度):每 secondsPerTurn 秒轉一整圈,以時間決定、與幀率無關。
// 減少動態偏好時呼叫端傳 enabled=false,角度固定為 0(靜止的封面角度)。
export function rotationAt(seconds: number, secondsPerTurn: number, enabled = true): number {
  if (!enabled || secondsPerTurn <= 0) return 0
  return ((seconds % secondsPerTurn) / secondsPerTurn) * Math.PI * 2
}

// miniLightBoost——縮小版相對於版面光照關鍵幀的「補亮」係數(乘在半球光、太陽/月光強度與曝光上)。
// 縮小版沒有天空與陰影,又要在頁面背景上展示模型,需要比完整版亮;夜晚的月光關鍵幀本身很弱(約 0.24),
// 所以暗色主題的太陽/月光倍率比較大。調整亮度只改這裡。
export type LightBoost = { hemi: number; sun: number; exposure: number }
export function miniLightBoost(theme: MiniTheme): LightBoost {
  return theme === 'light'
    ? { hemi: 2.3, sun: 1.7, exposure: 1.55 }
    : { hemi: 2.4, sun: 4.5, exposure: 1.7 }
}

// miniGlow——縮小版「自發光」的設定(只在暗色主題啟用,亮色主題的夕陽不需要):
//   pointLight:站點上方暖色點光源的強度倍率(0 = 關;點光源數量固定,只改強度,不增減燈以免重編譯 shader)
//   groundPool:每盞燈/每棟建築底下貼在地面的暖色光斑不透明度(0 = 隱藏)
//   lampOn:燈籠與窗戶「亮起」時的亮度(超過 1 讓 ACES 色調映射後仍飽和)
// 調整燈光強度只改這裡。
export type GlowSettings = { pointLight: number; groundPool: number; lampOn: number }
export function miniGlow(theme: MiniTheme): GlowSettings {
  return theme === 'dark'
    ? { pointLight: 1, groundPool: 0.55, lampOn: 2.3 }
    : { pointLight: 0, groundPool: 0, lampOn: 1.75 }
}

// poolRadius——地面光斑半徑(格):跟著擺放的縮放走(街屋、茶樓、石階這些大模型的光斑大,單盞燈籠的小),
// 夾在 [POOL_RADIUS_MIN, POOL_RADIUS_MAX]:太小看不見、太大會蓋過整條街。
export const POOL_RADIUS_MIN = 3.9
export const POOL_RADIUS_MAX = 15.6
export const poolRadius = (scale: number): number => Math.max(POOL_RADIUS_MIN, Math.min(POOL_RADIUS_MAX, 2.2 * scale))
