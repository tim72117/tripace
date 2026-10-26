// schedule.ts——何時才開始載入縮小島:等頁面 load 完成後的閒置時間。
//
// 不用 IntersectionObserver 當載入時機:島在首屏,一開頁就「在畫面中」,用它等於立刻載入,
// 會跟首屏資源(標題、字型、ScrollPlanDemo 的地圖圖片)搶頻寬。等 load 事件,這些都已下載完。
// requestIdleCallback 不支援時(Safari)退回 setTimeout。
export type ScheduleWindow = {
  document: { readyState: string }
  addEventListener(type: 'load', cb: () => void, opts?: { once: boolean }): void
  removeEventListener(type: 'load', cb: () => void): void
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
  cancelIdleCallback?: (id: number) => void
  setTimeout(cb: () => void, ms: number): number
  clearTimeout(id: number): void
}

export const IDLE_TIMEOUT_MS = 2500
export const FALLBACK_DELAY_MS = 1200

// scheduleHeroIslandLoad——回傳取消函式(元件卸載時呼叫)。onReady 最多呼叫一次。
export function scheduleHeroIslandLoad(win: ScheduleWindow, onReady: () => void): () => void {
  let done = false
  let idleId: number | null = null
  let timerId: number | null = null
  const fire = () => { if (!done) { done = true; onReady() } }
  const afterLoad = () => {
    if (done) return
    if (win.requestIdleCallback) idleId = win.requestIdleCallback(fire, { timeout: IDLE_TIMEOUT_MS })
    else timerId = win.setTimeout(fire, FALLBACK_DELAY_MS)
  }
  if (win.document.readyState === 'complete') afterLoad()
  else win.addEventListener('load', afterLoad, { once: true })

  return () => {
    done = true
    win.removeEventListener('load', afterLoad)
    if (idleId !== null) win.cancelIdleCallback?.(idleId)
    if (timerId !== null) win.clearTimeout(timerId)
  }
}
