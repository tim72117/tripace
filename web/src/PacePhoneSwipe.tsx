import { useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'
import { PaceChartDemo } from './PaceChartDemo'
import { PaceRouteMap } from './PaceRouteMap'
import styles from './PacePhoneSwipe.module.css'

// 手機版配速表:地圖(PaceRouteMap)是固定不動的底層,檢查站清單
// (PaceChartDemo,已經不含地圖,見 PaceChartDemo.tsx 的拆分)是從左邊滑入
// 蓋在地圖上面的抽屜面板(off-canvas / drawer navigation,Material Design
// 的正式元件名稱)。桌面版是側欄放清單、主區同時顯示地圖(見
// DesktopLayout.tsx DesktopContent 的 pace 分支),手機螢幕窄放不下兩塊並排,用抽屜取代
// 並排——這是刻意選用抽屜而非輪播(carousel):輪播模式下兩頁等寬一起被
// 拖曳平移,地圖(主要內容)會跟著清單一起被拖動;抽屜模式下地圖固定不動,
// 只有清單這個抽屜面板滑入/滑出蓋在地圖上面。
//
// 拖曳手勢只掛在抽屜面板本身(.pace-drawer-panel),不掛在地圖或整個外層
// 容器——地圖需要保留它自己原生的縮放/平移觸控(Maps JS API 自己處理),
// 掛在整個容器上會互搶同一個觸控手勢。收合狀態下改用一顆固定顯示的把手
// 按鈕開啟抽屜,不做「在地圖上滑動也能拉開抽屜」,同樣是為了不跟地圖的
// 原生手勢衝突。
const DRAWER_WIDTH_PERCENT = 82

export function PacePhoneSwipe() {
  // 預設抽屜開啟(先看到清單),對應桌面版側欄預設就是展開顯示清單的慣例。
  const [open, setOpen] = useState(true)
  const [dragOffset, setDragOffset] = useState(0)
  const startXRef = useRef<number | null>(null)
  const draggingRef = useRef(false)

  function onTouchStart(e: ReactTouchEvent) {
    startXRef.current = e.touches[0].clientX
    draggingRef.current = true
  }
  function onTouchMove(e: ReactTouchEvent) {
    if (!draggingRef.current || startXRef.current === null) return
    // 抽屜開啟時只能往左拖(關閉方向,delta 為負);已經是開啟狀態時 delta
    // 不可能為正(沒有更右可以拖的位置),超過 0 律鎖在 0,避免抽屜被拖出
    // 螢幕右側外的空白區域。
    const delta = Math.min(0, e.touches[0].clientX - startXRef.current)
    setDragOffset(delta)
  }
  function onTouchEnd() {
    if (!draggingRef.current) return
    draggingRef.current = false
    const threshold = 60
    if (dragOffset < -threshold) setOpen(false)
    setDragOffset(0)
    startXRef.current = null
  }

  const translate = open ? `calc(${dragOffset}px)` : `calc(-100% + ${dragOffset}px)`

  return (
    <div className="pace-drawer-wrap">
      <div className={styles.map}>
        <PaceRouteMap />
      </div>

      {open && (
        <div
          className={styles.backdrop}
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={styles.panel}
        style={{
          width: `${DRAWER_WIDTH_PERCENT}%`,
          transform: `translateX(${translate})`,
          transition: draggingRef.current ? 'none' : 'transform 0.25s ease',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <PaceChartDemo />
      </div>

      {!open && (
        <button
          type="button"
          className={styles.handle}
          onClick={() => setOpen(true)}
          aria-label="開啟檢查站清單"
        >
          ›
        </button>
      )}
    </div>
  )
}
