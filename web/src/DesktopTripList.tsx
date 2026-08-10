import { Plus, MapPin } from 'lucide-react'
import type { ClientConfig } from './api'
import type { Trip } from './types'
import { ErrorBanner, isSubmitEnter, useTripsState } from './AppCommon'

// 桌面版側欄行程列表:複用 useTripsState(與手機版 PhoneNavDrawer 的
// 行程列表分頁共用抓取/建立邏輯),只是呈現方式改成緊湊的側欄列表項目,
// 選中的行程有高亮(.desktop-trip-item.active)。從 DesktopLayout.tsx
// 抽出獨立成檔案,搬移純粹是移動程式碼位置,不涉及邏輯重組。
export function DesktopTripList({
  cfg,
  activeTripID,
  onOpen,
}: {
  cfg: ClientConfig
  activeTripID: string | null
  onOpen: (t: Trip) => void
}) {
  const {
    trips, err, loading,
    creating, setCreating,
    newName, setNewName,
    submitCreate,
  } = useTripsState(cfg, onOpen)

  return (
    <div className="desktop-trip-list">
      <div className="desktop-sidebar-head">
        <span className="desktop-sidebar-title">行程</span>
      </div>
      <ErrorBanner msg={err} />
      <div className="desktop-trip-scroll">
        {trips.length === 0 && !err && (
          <div className="empty">
            {loading ? '載入中…' : '沒有行程,按下方「新增行程」建立一個。'}
          </div>
        )}
        {/* 新增行程:跟下面實際的行程項目共用同一套 .desktop-trip-item
            樣式(對齊手機版 PhoneNavDrawer.tsx 的 TripsTabContent,同一組
            清單的一份子,不是另外一顆獨立的圖示按鈕),只把大頭貼換成「＋」
            圖示徽章區分。點擊後原地換成輸入框(composer),下面既有行程
            清單維持可見。 */}
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
          <button className="desktop-trip-item" onClick={() => setCreating(true)}>
            <div className="desktop-trip-icon">
              <Plus size={18} strokeWidth={1.8} />
            </div>
            <div className="grow">
              <div className="name">新增行程</div>
            </div>
          </button>
        )}
        {trips.map((t) => (
          <button
            key={t.id}
            className={`desktop-trip-item${t.id === activeTripID ? ' active' : ''}`}
            onClick={() => onOpen(t)}
          >
            <div className="desktop-trip-icon">
              <MapPin size={18} strokeWidth={1.8} />
            </div>
            <div className="grow">
              <div className="name">{t.name}</div>
              <div className="sub">
                {t.lastMessagePreview ?? '尚無訊息'} · {t.memberCount} 人
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
