import { List } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import styles from './PhoneTabBar.module.css'

// PhoneTabBar:手機版底部常駐導覽列——取代原本藏在 PhoneNavDrawer 側滑
// 抽屜裡的分頁列(.tabs),不需要先開抽屜才看得到分頁。只放 2 項:旅程
// (開啟 PhoneTripsDrawer 側滑抽屜)、對話(開啟對話 PhoneBottomSheet 疊加
// 層)——路徑(pace)與 demo-* 改放 PhoneSideTools.tsx 右側小圖示,不在這裡。
//
// 規劃地圖已是唯一常駐主畫面,不再有可切換的分頁模式(使用者明確要求,見
// PhoneContent.tsx 的 chatSheetOpen/paceSheetOpen 說明)——這裡的每個項目
// 各自是獨立開關的疊加層,不是互斥的分頁,active 狀態因此改成呼叫端直接
// 傳 boolean,不再需要比對「目前選中哪個 mode」。
export function PhoneTabBar({
  tabs,
  tripsDrawerOpen,
  onOpenTrips,
}: {
  tabs: { key: string; icon: LucideIcon; title: string; active: boolean; onClick: () => void }[]
  tripsDrawerOpen: boolean
  onOpenTrips: () => void
}) {
  return (
    <nav className={styles.bar}>
      <button
        type="button"
        className={styles.tab}
        onClick={onOpenTrips}
        title="旅程列表"
      >
        <span className={`${styles.tabIcon}${tripsDrawerOpen ? ` ${styles.tabIconActive}` : ''}`}>
          <List size={20} strokeWidth={1.8} />
        </span>
      </button>
      {tabs.map(({ key, icon: Icon, title, active, onClick }) => (
        <button
          key={key}
          type="button"
          className={styles.tab}
          onClick={onClick}
          title={title}
        >
          <span className={`${styles.tabIcon}${active ? ` ${styles.tabIconActive}` : ''}`}>
            <Icon size={20} strokeWidth={1.8} />
          </span>
        </button>
      ))}
    </nav>
  )
}
