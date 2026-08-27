import { Plus, MapPin, Settings } from 'lucide-react'
import type { Trip } from './types'
import { ErrorBanner } from '../AppCommon'
import { PhoneBottomSheet } from '../components/PhoneBottomSheet'
import { ScrollArea } from '../components/ScrollArea'
import { NewTripComposer } from './NewTripComposer'
import styles from './PhoneTripsDrawer.module.css'

// PhoneTripsDrawer:旅程列表獨立抽屜,由下往上彈出(bottom sheet),由
// PhoneContent.tsx 的「旅程」入口(底部常駐列/空狀態按鈕,見該檔案的
// tripsDrawerOpen state)開關,只有一種內容:瀏覽/新增旅程。
//
// 外殼(backdrop/panel/dragHandle)與拖曳關閉手勢(向下拖超過門檻關閉)
// 改用共用容器 PhoneBottomSheet,視覺語言對齊一般 App 常見的底部彈出
// 選單(使用者要求「行程由下方往上彈出」,原本是左側滑入抽屜)。z-index/
// bottom 定位維持原本數值,透過 panelStyle/backdropStyle 傳入——貼齊
// 底部常駐列(PhoneTabBar.tsx)上緣,不是螢幕最底部,bottom 值等於
// PhoneTabBar.module.css 的 .bar 高度(64px + safe-area),兩處數值需要
// 保持一致,PhoneTabBar 的高度公式之後若調整這裡要一併改。
//
// SHEET_TOP:面板頂部離這個定位祖先頂端的距離(px)——PhoneBottomSheet
// 改成用「離頂部距離」而非「高度百分比」決定展開程度(見該元件的說明,
// 適應不同裝置高度)。TODO(使用者稍後決定合理數值):暫時估算,先讓
// 編譯通過與行為大致對齊原本 maxHeightVh=70 的視覺比例。
const SHEET_TOP = 200
const SHEET_BOTTOM = 'calc(64px + env(safe-area-inset-bottom, 0px))'

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
  // 的 onManage,分享/成員/開啟時自動進入這幾個功能統一收到旅程項目上,
  // 跟桌面版同一套心智模型。
  onManage: (t: Trip) => void
  onClose: () => void
}) {
  return (
    <PhoneBottomSheet
      open={open}
      onClose={onClose}
      snapPoints={[SHEET_TOP]}
      panelStyle={{ position: 'absolute', left: 0, right: 0, bottom: SHEET_BOTTOM, zIndex: 33 }}
      backdropStyle={{ top: 0, left: 0, right: 0, bottom: SHEET_BOTTOM, zIndex: 32, background: 'rgba(0, 0, 0, 0.35)' }}
    >
      <ScrollArea>
        <ErrorBanner msg={err} />
        {trips.length === 0 && !err && (
          <div className="empty">
            {loading ? '載入中…' : '沒有旅程。按下方「新增旅程」建立一個。'}
          </div>
        )}
        <ul className={styles.tripList}>
          {/* 新增旅程:跟下面實際的旅程項目共用同一套 .tripItem 樣式
              (借來瀏覽/新增旅程的是同一個工具畫面,視覺上該是同一組清單
              的一份子,不是另一顆突兀的強調色橫幅按鈕),只把大頭貼換成
              「＋」圖示徽章區分。點擊後這個項目原地換成輸入框(composer),
              下面既有旅程清單維持可見、可捲動,不會像原本整塊消失。 */}
          <li>
            {creating ? (
              <NewTripComposer
                value={newName}
                onChange={setNewName}
                onSubmit={submitCreate}
                onCancel={() => {
                  setCreating(false)
                  setNewName('')
                }}
              />
            ) : (
              <button type="button" className={styles.tripItem} onClick={() => setCreating(true)}>
                <div className={styles.newTripIcon}>
                  <Plus size={18} strokeWidth={1.8} />
                </div>
                <div className={styles.tripGrow}>
                  <div className={styles.tripName}>新增旅程</div>
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
                  title="旅程設定"
                >
                  <Settings size={15} strokeWidth={1.8} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </PhoneBottomSheet>
  )
}
