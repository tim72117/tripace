// swipeReveal.ts——橫向時間軸圖卡「往上滑,卡片內下方露出操作列」手勢的判斷規則(純函式,
// 不碰 DOM、不依賴 React,方便單獨測試)。手勢流程與 DOM 寫入在 useSwipeReveal.ts。
//
// 數值來源:Artifact 試做稿(swipe-up-actions)實測的取捨,不是正式規格。

// 操作列高度(px),也是內容往上位移的上限。要與 HorizontalPlanTimeline.module.css 的
// --swipe-bar-height 一致。
export const SWIPE_BAR_HEIGHT = 68

// 手指移動超過這個距離才判斷意圖(避免點擊時的微小抖動被當成手勢)。
export const SWIPE_SLOP = 8

// |dy| > RATIO × |dx| 才算垂直意圖(約 50° 以上);否則整段手勢交給橫向捲動,鎖定後不再改判。
export const SWIPE_VERTICAL_RATIO = 1.2

// 放手時速度(px/ms)超過這個值就照方向決定開合,不看位移多寡。
export const SWIPE_FLICK_VELOCITY = 0.45

export type SwipeIntent = 'vertical' | 'horizontal' | 'pending'

export interface SwipeSample {
  t: number
  y: number
}

export function resolveSwipeIntent(dx: number, dy: number): SwipeIntent {
  if (Math.hypot(dx, dy) < SWIPE_SLOP) return 'pending'
  return Math.abs(dy) > SWIPE_VERTICAL_RATIO * Math.abs(dx) ? 'vertical' : 'horizontal'
}

// 超出 [0, SWIPE_BAR_HEIGHT] 的部分只跟手 25%(阻尼);往下拉過頭最多 -20px。
export function dampSwipeOffset(raw: number): number {
  if (raw > SWIPE_BAR_HEIGHT) return SWIPE_BAR_HEIGHT + (raw - SWIPE_BAR_HEIGHT) * 0.25
  if (raw < 0) return Math.max(raw * 0.25, -20)
  return raw
}

// 取最近約 100ms 的平均速度;正值 = 往上。
export function swipeVelocity(samples: SwipeSample[]): number {
  if (samples.length < 2) return 0
  const last = samples[samples.length - 1]
  let first = samples[0]
  for (const s of samples) {
    if (last.t - s.t <= 100) {
      first = s
      break
    }
  }
  const dt = last.t - first.t
  return dt > 0 ? (first.y - last.y) / dt : 0
}

// 放手時要停在展開位(true)還是收合位(false)。速度夠快就依方向,否則看位移有沒有過半。
export function shouldSettleOpen(offset: number, velocity: number): boolean {
  if (Math.abs(velocity) >= SWIPE_FLICK_VELOCITY) return velocity > 0
  return offset > SWIPE_BAR_HEIGHT / 2
}
