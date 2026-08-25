import { Plus, MapPin, Settings } from 'lucide-react'
import type { Trip } from './types'
import { ErrorBanner, isSubmitEnter } from '../AppCommon'
import { useDragToClose } from '../hooks/useDragToClose'
import styles from './PhoneTripsDrawer.module.css'

// PhoneTripsDrawer:行程列表獨立抽屜,由下往上彈出(bottom sheet),由
// PhoneContent.tsx 的「行程」入口(底部常駐列/空狀態按鈕,見該檔案的
// tripsDrawerOpen state)開關,只有一種內容:瀏覽/新增行程。
//
// 拖曳關閉手勢(向下拖超過門檻關閉)由 useDragToClose 共用 hook 提供,
// 視覺語言對齊一般 App 常見的底部彈出選單(使用者要求「行程由下方往上
// 彈出」,原本是左側滑入抽屜)。

const SHEET_MAX_HEIGHT_VH = 70

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
  onManage,
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
  // onManage:「管理」按鈕觸發,開啟 TripManageModal(分享連結/成員/
  // 開啟時自動進入,見該檔案的說明)——對齊桌面版 DesktopTripList.tsx
  // 的 onManage,分享/成員/開啟時自動進入這幾個功能統一收到行程項目上,
  // 跟桌面版同一套心智模型。
  onManage: (t: Trip) => void
  onClose: () => void
}) {
  const { translate, transition, onTouchStart, onTouchMove, onTouchEnd } = useDragToClose({
    axis: 'y',
    open,
    onClose,
  })

  return (
    <>
      {open && (
        <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      )}
      <div
        className={styles.panel}
        style={{
          maxHeight: `${SHEET_MAX_HEIGHT_VH}vh`,
          transform: `translateY(${translate})`,
          transition,
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className={styles.dragHandle}>
          <div className={styles.dragHandleBar} />
        </div>
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
                <div className={`${styles.tripItem}${t.id === activeTripID ? ` ${styles.tripItemActive}` : ''}`}>
                  <button
                    type="button"
                    className={styles.tripItemOpen}
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
                  {/* 管理:對齊桌面版 DesktopTripList.tsx 的 itemAction,
                      見上方 onManage 說明。 */}
                  <button
                    type="button"
                    className={styles.tripItemAction}
                    onClick={() => onManage(t)}
                    title="行程設定"
                  >
                    <Settings size={15} strokeWidth={1.8} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  )
}
