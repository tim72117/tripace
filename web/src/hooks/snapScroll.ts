// snapToNearestChild——橫向捲動列用滑鼠手動拖曳(暫停了 scroll-snap)放手後:平滑捲到離中心最近的項目,
// 一小段時間後恢復 scroll-snap。useMouseDragScroll 與 planning/timeline/phone/useSwipeReveal 共用。
// items 是要比較的項目元素(通常是捲動列的子元素);沒有任何項目時只恢復 snap。
export function snapToNearestChild(scroller: HTMLElement, items: Iterable<Element>, restoreAfterMs = 400): void {
  const rect = scroller.getBoundingClientRect()
  const center = rect.left + rect.width / 2
  let best = 0
  let bestDist = Infinity
  for (const item of items) {
    const r = item.getBoundingClientRect()
    const delta = r.left + r.width / 2 - center
    if (Math.abs(delta) < bestDist) {
      bestDist = Math.abs(delta)
      best = delta
    }
  }
  if (bestDist !== Infinity) scroller.scrollTo?.({ left: scroller.scrollLeft + best, behavior: 'smooth' })
  window.setTimeout(() => {
    scroller.style.scrollSnapType = ''
  }, restoreAfterMs)
}
