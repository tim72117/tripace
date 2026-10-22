// layoutDebugGeometry——/app 手機版規劃面板除錯疊圖(PlanLayoutDebugOverlay)
// 的純計算:輸入是 DOM 量到的矩形(視窗座標),輸出是相對 overlay 左上角的
// 座標。抽成純函式是因為 jsdom 的 getBoundingClientRect 全部回傳 0,元件本身
// 測不出幾何;計算這層用單元測試守住,量測那層靠疊圖肉眼看(同
// home/plan-ai-sim/solveSafeAreaCenter.ts 的分工)。
//
// 名詞(對齊 /ai-plan 的 SafeAreaDebugOverlay):
//   - mapCenter:地圖容器的中心點——地圖「中心座標」實際落在螢幕的位置。
//   - timeline:面板內容(橫向時間軸卡片、按鈕等)的聯集範圍,高度為 0 的忽略。
//   - safeRect:沒被時間軸/composer 擋住的區域 = overlay 頂端到「時間軸上緣與
//     composer 上緣中較高者」,寬度同 overlay。
//   - safeCenter:safeRect 的中心——地圖上的目標點該被移到的位置。
//   - delta:safeCenter - mapCenter,把目標點移到可視區中心需要的位移。
//     /app 目前沒有 panToWithinSafeArea,這個數字是在回答「如果要做,位移量是多少」。

export type Rect = { top: number; left: number; width: number; height: number }
export type Point = { x: number; y: number }

export type PhoneLayoutDebug = {
  mapCenter: Point | null
  timeline: Rect | null
  safeRect: Rect
  safeCenter: Point
  delta: Point | null
}

function relative(r: Rect, origin: Rect): Rect {
  return { top: r.top - origin.top, left: r.left - origin.left, width: r.width, height: r.height }
}

export function solvePhoneLayoutDebug({
  origin,
  mapRect,
  timelineChildRects,
  composerRect,
}: {
  origin: Rect
  mapRect: Rect | null
  timelineChildRects: Rect[]
  composerRect: Rect | null
}): PhoneLayoutDebug {
  const mapCenter = mapRect
    ? (() => {
        const m = relative(mapRect, origin)
        return { x: m.left + m.width / 2, y: m.top + m.height / 2 }
      })()
    : null

  const visible = timelineChildRects.filter((r) => r.height > 0 && r.width > 0).map((r) => relative(r, origin))
  let timeline: Rect | null = null
  if (visible.length > 0) {
    const top = Math.min(...visible.map((r) => r.top))
    const left = Math.min(...visible.map((r) => r.left))
    const bottom = Math.max(...visible.map((r) => r.top + r.height))
    const right = Math.max(...visible.map((r) => r.left + r.width))
    timeline = { top, left, width: right - left, height: bottom - top }
  }

  // 擋住地圖的最高邊界:時間軸上緣、composer 上緣取較高者(較小的 top)。
  let blockTop = origin.height
  if (timeline) blockTop = Math.min(blockTop, timeline.top)
  if (composerRect && composerRect.height > 0) blockTop = Math.min(blockTop, composerRect.top - origin.top)
  blockTop = Math.max(0, blockTop)

  const safeRect: Rect = { top: 0, left: 0, width: origin.width, height: blockTop }
  const safeCenter: Point = { x: safeRect.width / 2, y: safeRect.height / 2 }
  const delta = mapCenter ? { x: safeCenter.x - mapCenter.x, y: safeCenter.y - mapCenter.y } : null
  return { mapCenter, timeline, safeRect, safeCenter, delta }
}
