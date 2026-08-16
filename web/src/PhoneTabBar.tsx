import { List } from 'lucide-react'
import type { DrawerMode } from './DesktopShared'
import styles from './PhoneTabBar.module.css'

// PhoneTabBar:手機版底部常駐導覽列——取代原本藏在 PhoneNavDrawer 側滑
// 抽屜裡的分頁列(.tabs),不需要先開抽屜才看得到分頁。只放 3 項:行程
// (維持原本開啟 PhoneTripsDrawer 側滑抽屜的既有行為,不是切換 drawerMode,
// 故獨立用 onOpenTrips 而非塞進 tabs 陣列)、時間軸、規劃地圖——路徑
// (pace)與 demo-* 改放 PhoneSideTools.tsx 右側小圖示,不在這裡。
//
// 目前階段(先讓按鈕到位):onSelectMode 仍呼叫既有的 PhoneContent.tsx
// setDrawerMode,行為對齊改版前——之後會接上底部列常駐後「再點同一分頁
// no-op」的邏輯調整,這裡先不動,只負責讓按鈕出現在正確位置。
export function PhoneTabBar({
  tabs,
  mode,
  lastContentMode,
  tripsDrawerOpen,
  onOpenTrips,
  onSelectMode,
}: {
  tabs: { mode: DrawerMode; icon: typeof List; title: string; disabled?: boolean }[]
  mode: DrawerMode
  // lastContentMode:沿用 PhoneContent.tsx 既有邏輯——瀏覽獨立行程抽屜期間,
  // 使用者切換前正在看的時間軸分頁圖示仍要顯示 active(見該檔案的說明)。
  lastContentMode: 'pace' | 'timeline' | null
  tripsDrawerOpen: boolean
  onOpenTrips: () => void
  onSelectMode: (mode: DrawerMode) => void
}) {
  return (
    <nav className={styles.bar}>
      <button
        type="button"
        className={`${styles.tab}${tripsDrawerOpen ? ` ${styles.tabActive}` : ''}`}
        onClick={onOpenTrips}
        title="行程列表"
      >
        <List size={20} strokeWidth={1.8} />
      </button>
      {tabs.map(({ mode: m, icon: Icon, title, disabled }) => {
        const isActive = mode === m || (tripsDrawerOpen && lastContentMode === m)
        return (
          <button
            key={m}
            type="button"
            className={`${styles.tab}${isActive ? ` ${styles.tabActive}` : ''}`}
            onClick={() => !disabled && onSelectMode(m)}
            disabled={disabled}
            title={disabled ? '請先選擇一個行程' : title}
          >
            <Icon size={20} strokeWidth={1.8} />
          </button>
        )
      })}
    </nav>
  )
}
