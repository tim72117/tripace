import { useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'
import { Plus, MapPin } from 'lucide-react'
import type { Trip } from './types'
import { ErrorBanner, isSubmitEnter } from './AppCommon'
import styles from './PhoneTripsDrawer.module.css'

// PhoneTripsDrawer:行程列表獨立抽屜——原本是 PhoneNavDrawer.tsx 分頁列
// 其中一顆分頁(mode === 'trips'),現在拆成自己的左側滑入抽屜,疊在
// PhoneNavDrawer(時間軸/配速表/demo)之上(見 PhoneTripsDrawer.module.css
// 的 z-index,高於 PhoneNavDrawer.module.css 的 .backdrop/.panel)。由
// PhoneNavDrawer 分頁列右側的「行程」觸發鈕開啟(見該檔案的 onOpenTrips),
// 不再是那個抽屜自己 mode 切換的一部分。
//
// backdrop/panel 的滑入手勢/拖曳關閉寫法完全比照 PhoneNavDrawer.tsx(同一套
// 左側滑入抽屜模式),只是這裡疊得更高、且不需要分頁列(只有一種內容:
// 瀏覽/新增行程)。

const DRAWER_WIDTH_PERCENT = 82

export function PhoneTripsDrawer({
  open,
  trips,
  err,
  loading,
  creating,
  setCreating,
  newName,
  setNewName,
  submitCreate,
  activeTripID,
  onSelectTrip,
  onClose,
}: {
  open: boolean
  trips: Trip[]
  err: string | null
  loading: boolean
  creating: boolean
  setCreating: (v: boolean) => void
  newName: string
  setNewName: (v: string) => void
  submitCreate: () => void
  activeTripID: string | null
  onSelectTrip: (t: Trip) => void
  onClose: () => void
}) {
  const [dragOffset, setDragOffset] = useState(0)
  const startXRef = useRef<number | null>(null)
  const draggingRef = useRef(false)

  function onTouchStart(e: ReactTouchEvent) {
    startXRef.current = e.touches[0].clientX
    draggingRef.current = true
  }
  function onTouchMove(e: ReactTouchEvent) {
    if (!draggingRef.current || startXRef.current === null) return
    const delta = Math.min(0, e.touches[0].clientX - startXRef.current)
    setDragOffset(delta)
  }
  function onTouchEnd() {
    if (!draggingRef.current) return
    draggingRef.current = false
    const threshold = 60
    if (dragOffset < -threshold) onClose()
    setDragOffset(0)
    startXRef.current = null
  }

  const translate = open ? `${dragOffset}px` : `calc(-100% + ${dragOffset}px)`

  return (
    <>
      {open && (
        <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
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
        <div className="screen-body">
          <ErrorBanner msg={err} />
          {trips.length === 0 && !err && (
            <div className="empty">
              {loading ? '載入中…' : '沒有行程。按下方「新增行程」建立一個。'}
            </div>
          )}
          <ul className={styles.tripList}>
            {/* 新增行程:跟下面實際的行程項目共用同一套 .tripItem 樣式
                (借來瀏覽/新增行程的是同一個工具畫面,視覺上該是同一組清單
                的一份子,不是另一顆突兀的強調色橫幅按鈕),只把大頭貼換成
                「＋」圖示徽章區分。點擊後這個項目原地換成輸入框(composer),
                下面既有行程清單維持可見、可捲動,不會像原本整塊消失。 */}
            <li>
              {creating ? (
                <div className="new-trip-composer">
                  <input
                    autoFocus
                    value={newName}
                    placeholder="新行程名稱…"
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (isSubmitEnter(e)) submitCreate()
                      if (e.key === 'Escape') {
                        setCreating(false)
                        setNewName('')
                      }
                    }}
                  />
                  <button className="btn-primary" onClick={submitCreate} disabled={!newName.trim()}>
                    建立
                  </button>
                </div>
              ) : (
                <button type="button" className={styles.tripItem} onClick={() => setCreating(true)}>
                  <div className={styles.newTripIcon}>
                    <Plus size={18} strokeWidth={1.8} />
                  </div>
                  <div className={styles.tripGrow}>
                    <div className={styles.tripName}>新增行程</div>
                  </div>
                </button>
              )}
            </li>
            {trips.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={`${styles.tripItem}${t.id === activeTripID ? ` ${styles.tripItemActive}` : ''}`}
                  onClick={() => onSelectTrip(t)}
                >
                  <div className={styles.newTripIcon}>
                    <MapPin size={18} strokeWidth={1.8} />
                  </div>
                  <div className={styles.tripGrow}>
                    <div className={styles.tripName}>{t.name}</div>
                    <div className={styles.tripSub}>
                      {t.lastMessagePreview ?? '尚無訊息'} · {t.memberCount} 人
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  )
}
