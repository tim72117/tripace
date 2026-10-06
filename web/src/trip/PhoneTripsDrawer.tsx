import { Plus, Luggage, Settings } from 'lucide-react'
import type { Trip } from './types'
import { ErrorBanner } from '../AppCommon'
import { PhoneBottomSheet, SheetHead } from '../components/PhoneBottomSheet'
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
      showBackdrop={false}
      // head:原本沒有標頭,只能靠下滑手勢關閉——使用者明確要求清單
      // sheet 要有關閉按鈕,比照其餘 bottom sheet(行程/設定/對話)一律
      // 用共用的 SheetHead(標題+右上角關閉鈕),不自己另外拼版面。
      head={<SheetHead title="清單" onClose={onClose} />}
    >
      <ScrollArea>
        <ErrorBanner msg={err} />
        {trips.length === 0 && !err && (
          <div className="empty">
            {loading ? '載入中…' : '沒有清單。按下方「新增清單」建立一個。'}
          </div>
        )}
        <ul className={styles.tripList}>
          {/* 新增清單:跟下面實際的旅程項目共用同一套 .tripItem 樣式
              (借來瀏覽/新增的是同一個工具畫面,視覺上該是同一組清單
              的一份子,不是另一顆突兀的強調色橫幅按鈕),只把大頭貼換成
              「＋」圖示徽章區分。點擊後這個項目原地換成輸入框(composer),
              下面既有清單維持可見、可捲動,不會像原本整塊消失。
              2026-10 修正:使用者要求畫面文字統一改用「清單」(按鈕/空
              狀態提示),底層資料仍是 Trip,變數/型別命名不動——這只是
              這個抽屜(已改名「清單」)裡的顯示字樣跟著統一,桌面版
              DesktopTripList.tsx 仍叫「旅程列表」,不在這次改名範圍內。 */}
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
                  <div className={styles.tripName}>新增清單</div>
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
                  {/* 2026-10 修正:原本用 MapPin(單一地點意象),使用者
                      明確指出清單裡每一項代表的是「一趟旅程」的概念,不是
                      單一目的地,改用 Luggage(行李箱,旅程/旅行的慣用
                      意象)。 */}
                  <div className={styles.newTripIcon}>
                    <Luggage size={18} strokeWidth={1.8} />
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
                  title="清單設定"
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
