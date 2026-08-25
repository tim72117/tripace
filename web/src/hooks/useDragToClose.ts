import { useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'

// useDragToClose:手機版 bottom sheet / 側滑抽屜共用的拖曳關閉手勢——抽出
// 自 trip/PhoneTripsDrawer.tsx、geo-planning/GeoOutlinePhoneListDrawer.tsx、
// timeline/PhoneTimelineDrawer.tsx(垂直,由下往上彈出)、
// geo-planning/GeoOutlinePhoneCandidateDrawer.tsx(水平,由右側滑入)——四份
// 檔案原本各自複製貼上同一套 dragOffset/startRef/draggingRef + touch handler
// 邏輯,只有軸向(x/y)與門檻不同,收斂成這個 hook,往後只需要修一處。
//
// axis 決定量測哪個座標軸、以及超過門檻時 delta 該箝制的方向:
// - 'y'(bottom sheet 下滑關閉):只允許往下拖(delta >= 0)
// - 'x'(側滑抽屜右側滑入,只能往右拖關閉):只允許往右拖(delta >= 0)
// 兩種抽屜的「關閉方向」在各自的座標系裡都是正值,所以底層量測邏輯完全
// 共用,呼叫端只需要決定 translate CSS 屬性要套用在 translateX 還是
// translateY(見下方 translate 回傳值的用法說明)。
export function useDragToClose({
  axis,
  open,
  onClose,
  threshold = 60,
}: {
  axis: 'x' | 'y'
  open: boolean
  onClose: () => void
  threshold?: number
}) {
  const [dragOffset, setDragOffset] = useState(0)
  const startRef = useRef<number | null>(null)
  const draggingRef = useRef(false)

  function onTouchStart(e: ReactTouchEvent) {
    startRef.current = axis === 'y' ? e.touches[0].clientY : e.touches[0].clientX
    draggingRef.current = true
  }
  function onTouchMove(e: ReactTouchEvent) {
    if (!draggingRef.current || startRef.current === null) return
    const current = axis === 'y' ? e.touches[0].clientY : e.touches[0].clientX
    const delta = Math.max(0, current - startRef.current)
    setDragOffset(delta)
  }
  function onTouchEnd() {
    if (!draggingRef.current) return
    draggingRef.current = false
    if (dragOffset > threshold) onClose()
    setDragOffset(0)
    startRef.current = null
  }

  // translate:呼叫端直接套進 `transform: translate${axis === 'y' ? 'Y' : 'X'}(${translate})`
  // ——開啟時貼齊 dragOffset(手指拖多少就跟多少),關閉時整個位移出畫面
  // (100% + dragOffset,拖曳中鬆手未達門檻時同樣會彈回這個位置)。
  const translate = open ? `${dragOffset}px` : `calc(100% + ${dragOffset}px)`
  // transition:拖曳進行中關掉動畫(即時跟手),放開手指後才套用彈回/
  // 滑出動畫——比照四份原始檔案的寫法。
  const transition = draggingRef.current ? 'none' : 'transform 0.25s ease'

  return { translate, transition, onTouchStart, onTouchMove, onTouchEnd }
}
