import { useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'
import { PaceChartDemo } from './PaceChartDemo'
import { PaceRouteMap } from './PaceRouteMap'

// 手機版配速表的滑動雙頁:左頁是檢查站清單(PaceChartDemo,已經不含地圖,
// 見 PaceChartDemo.tsx 的拆分)、右頁是地圖(PaceRouteMap)。桌面版是側欄
// 放清單、主區同時顯示地圖(見 App.tsx DesktopContent 的 demo-pace 分支),
// 手機螢幕窄放不下兩塊並排,改成左右滑動切換,兩頁各自全螢幕寬。
//
// 拖曳中關閉 CSS transition、即時跟手(dragOffset);放開手指後依滑動距離
// 判斷是否切頁,清空 dragOffset、只靠 page 決定最終位置,重新開啟
// transition 做回彈/切頁動畫——業界輪播元件常見的標準手法。
export function PacePhoneSwipe() {
  const [page, setPage] = useState<0 | 1>(0)
  const [dragOffset, setDragOffset] = useState(0)
  const startXRef = useRef<number | null>(null)
  const draggingRef = useRef(false)

  function onTouchStart(e: ReactTouchEvent) {
    startXRef.current = e.touches[0].clientX
    draggingRef.current = true
  }
  function onTouchMove(e: ReactTouchEvent) {
    if (!draggingRef.current || startXRef.current === null) return
    setDragOffset(e.touches[0].clientX - startXRef.current)
  }
  function onTouchEnd() {
    if (!draggingRef.current) return
    draggingRef.current = false
    const threshold = 60
    if (dragOffset < -threshold && page === 0) setPage(1)
    else if (dragOffset > threshold && page === 1) setPage(0)
    setDragOffset(0)
    startXRef.current = null
  }

  const baseTranslate = page === 0 ? '0%' : '-50%'

  return (
    <div className="pace-phone-swipe">
      <div
        className="pace-phone-swipe-track"
        style={{
          transform: `translateX(calc(${baseTranslate} + ${dragOffset}px))`,
          transition: draggingRef.current ? 'none' : 'transform 0.25s ease',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="pace-phone-swipe-page">
          <PaceChartDemo />
        </div>
        <div className="pace-phone-swipe-page">
          <PaceRouteMap />
        </div>
      </div>
      <div className="pace-phone-swipe-dots">
        <button
          type="button"
          className={`pace-phone-swipe-dot${page === 0 ? ' active' : ''}`}
          onClick={() => setPage(0)}
          aria-label="檢查站清單"
        />
        <button
          type="button"
          className={`pace-phone-swipe-dot${page === 1 ? ' active' : ''}`}
          onClick={() => setPage(1)}
          aria-label="地圖"
        />
      </div>
    </div>
  )
}
