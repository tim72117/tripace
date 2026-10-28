import type { ClientConfig } from '../api'
import type { Trip } from './types'
import { TripManageModal } from './TripManageModal'

// TripManageDialog——旅程管理彈窗(分享連結/成員/開啟時自動進入)的置中卡片外殼,桌面(planning/member/desktop/Content)與手機
// (planning/member/phone/Content)共用(2026-10 從兩邊各一份相同的 JSX 抽出)。用 base-ui.css 既有的 .rp-modal*(置中卡片彈窗骨架,
// 跟 SettingsDialog 同一套)包住,TripManageModal 本身用 .rp-modal-head/.rp-modal-body 渲染內容(見該檔案的說明)。
// 點背景關閉、點卡片本身不關閉。原本掛在 ChatScreen(已移除)navbar 的三個分散入口(TripMenu/分享按鈕/成員按鈕)合併成
// 這一個,由旅程列表觸發;提升到呼叫端最外層渲染,避免被內層容器的 overflow/層級裁掉。
export function TripManageDialog({
  cfg,
  trip,
  userID,
  onClose,
}: {
  cfg: ClientConfig
  trip: Trip
  // userID:登入使用者的 id,用來判斷是不是旅程擁有者(trip.ownerID === userID)。
  userID: string
  onClose: () => void
}) {
  return (
    <div className="rp-modal-backdrop" onClick={onClose}>
      <div className="rp-modal" onClick={(e) => e.stopPropagation()}>
        <TripManageModal cfg={cfg} trip={trip} isOwner={trip.ownerID === userID} onClose={onClose} />
      </div>
    </div>
  )
}
