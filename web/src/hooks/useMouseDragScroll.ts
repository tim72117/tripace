import { useEffect, type RefObject } from 'react'
import { snapToNearestChild } from './snapScroll'

// useMouseDragScroll——讓橫向捲動列(overflow-x: auto + scroll-snap)也能用滑鼠左右拖曳捲動。
// 觸控本來就能原生拖曳捲動;滑鼠沒有,桌面瀏覽器不開手機模擬就拖不動。這裡只處理 pointerType === 'mouse':
// 水平移動超過 DRAG_SLOP_PX 才進入拖曳(單純點擊不受影響),拖曳中暫停 scroll-snap、手動跟著捲,
// 放手後平滑吸附到離中心最近的子元素,再恢復 snap;拖曳結束後吞掉緊接著補發的那次 click,避免誤選卡片。
//
// enabled 為 false(例如縱向堆疊版型,不是橫向捲動)時不掛任何監聽。
const DRAG_SLOP_PX = 6

export function useMouseDragScroll(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return

    let startX = 0
    let startScrollLeft = 0
    let pointerId: number | null = null
    let dragging = false

    const swallowClick = (e: Event) => {
      e.stopPropagation()
      e.preventDefault()
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      const dx = e.clientX - startX
      if (!dragging) {
        if (Math.abs(dx) < DRAG_SLOP_PX) return
        dragging = true
        el.style.scrollSnapType = 'none'
        el.style.cursor = 'grabbing'
        el.style.userSelect = 'none'
        try {
          el.setPointerCapture(e.pointerId)
        } catch {
          // 部分環境(測試/已釋放的指標)會丟錯,不影響拖曳本身。
        }
      }
      el.scrollLeft = startScrollLeft - dx
    }

    const finish = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (dragging) {
        // 補發的 click 緊接在 pointerup 之後;只吞這一次,下一個 tick 就恢復。
        el.addEventListener('click', swallowClick, { capture: true, once: true })
        window.setTimeout(() => el.removeEventListener('click', swallowClick, true), 50)
        el.style.cursor = ''
        el.style.userSelect = ''
        snapToNearestChild(el, Array.from(el.children))
      }
      pointerId = null
      dragging = false
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === pointerId) finish()
    }

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || pointerId !== null) return
      pointerId = e.pointerId
      startX = e.clientX
      startScrollLeft = el.scrollLeft
      dragging = false
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    }

    el.addEventListener('pointerdown', onDown)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      el.style.scrollSnapType = ''
      el.style.cursor = ''
      el.style.userSelect = ''
    }
  }, [ref, enabled])
}
