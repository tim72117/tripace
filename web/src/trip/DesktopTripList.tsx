import { Plus, Settings } from 'lucide-react'
import type { ClientConfig } from '../api'
import type { Trip } from './types'
import { ErrorBanner, isSubmitEnter } from '../AppCommon'
import { useTripsState } from '../hooks/useTripsState'
import styles from './DesktopTripList.module.css'
import '../styles-desktop.css'

// 桌面版側欄行程列表:複用 useTripsState(與手機版 PhoneNavDrawer 的
// 行程列表分頁共用抓取/建立邏輯),只是呈現方式改成緊湊的側欄列表項目,
// 選中的行程有高亮(.desktop-trip-item.active)。從 DesktopLayout.tsx
// 抽出獨立成檔案,搬移純粹是移動程式碼位置,不涉及邏輯重組。
export function DesktopTripList({
  cfg,
  activeTripID,
  onOpen,
  onManage,
}: {
  cfg: ClientConfig
  activeTripID: string | null
  onOpen: (t: Trip) => void
  // onManage:行程管理(分享連結/成員/開啟時自動進入,見
  // TripManageModal.tsx)原本掛在 ChatScreen navbar 的三個分散入口,現在
  // 對話小匡可能無 trip(見 ChatScreen.tsx trip prop 的說明),合併成單一
  // 動作移到行程本來就存在的地方——行程列表每一筆項目上。呼叫端
  // (DesktopLayout.tsx)負責開啟合併後的 TripManageModal。
  onManage: (t: Trip) => void
}) {
  const {
    trips, err, loading,
    creating, setCreating,
    newName, setNewName,
    submitCreate,
  } = useTripsState(cfg, onOpen)

  return (
    <div className={styles.list}>
      <div className="desktop-sidebar-head">
        <span className="desktop-sidebar-title">行程</span>
      </div>
      <ErrorBanner msg={err} />
      <div className={styles.scroll}>
        {trips.length === 0 && !err && (
          <div className="empty">
            {loading ? '載入中…' : '沒有行程,按下方「新增行程」建立一個。'}
          </div>
        )}
        {/* 新增行程:跟下面實際的行程項目共用同一套 .item 樣式(對齊手機版
            PhoneNavDrawer.tsx 的 TripsTabContent,同一組清單的一份子,
            不是另外一顆獨立的圖示按鈕),只把大頭貼換成「＋」圖示徽章
            區分。點擊後原地換成輸入框(composer),下面既有行程清單維持
            可見。 */}
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
          <div className={styles.item}>
            <button className={styles.itemOpen} onClick={() => setCreating(true)}>
              <div className={styles.icon}>
                <Plus size={18} strokeWidth={1.8} />
              </div>
              <div className="grow">
                <div className="name">新增行程</div>
              </div>
            </button>
          </div>
        )}
        {trips.map((t) => (
          <div
            key={t.id}
            className={t.id === activeTripID ? `${styles.item} ${styles.active}` : styles.item}
          >
            <button className={styles.itemOpen} onClick={() => onOpen(t)}>
              <div className="grow">
                <div className="name">{t.name}</div>
                <div className="sub">
                  {t.lastMessagePreview ?? '尚無訊息'} · {t.memberCount} 人
                </div>
              </div>
            </button>
            {/* 管理:stopPropagation 避免冒泡觸發外層(若外層仍是 button)
                的 onOpen——見上方 onManage 說明。 */}
            <button
              className={styles.itemAction}
              onClick={(e) => {
                e.stopPropagation()
                onManage(t)
              }}
              title="行程設定"
            >
              <Settings size={15} strokeWidth={1.8} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
