import type { AskPageInput } from './asktools'

// askTransition——詢問頁換步驟時的「方向」判斷(純函式,獨立出來好單獨測試)。
//
// 詢問頁是一連串步驟:選國家 → 選城市 → 選景點。換步驟時內容要依方向滑入(前進從右、返回從左),
// 讓使用者一眼知道「已經換到下一步」,不會把停在原位的卡片誤認成還在前一個畫面
// (見 AskPage.module.css 的 .transition 與 useHoverLock.ts)。
// 層級只定義有先後關係的三層;交通方式(transport)與純文字(text)是獨立的詢問,沒有方向可言。
export type AskDirection = 'forward' | 'back' | 'none'

const LAYER_COUNTRY = 0
const LAYER_CITY = 1
const LAYER_CANDIDATES = 2

export function askLayerOf(input: AskPageInput): number | undefined {
  if ('country' in input) return LAYER_COUNTRY
  if ('city' in input) return LAYER_CITY
  if ('candidates' in input || 'explore' in input) return LAYER_CANDIDATES
  return undefined
}

// 前後任一邊不在三層之內、或層級沒變,都不做方向動畫。
export function askDirectionBetween(prev: number | undefined, next: number | undefined): AskDirection {
  if (prev === undefined || next === undefined || prev === next) return 'none'
  return next > prev ? 'forward' : 'back'
}
