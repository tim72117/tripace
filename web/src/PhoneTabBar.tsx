import type { LucideIcon } from 'lucide-react'
import styles from './PhoneTabBar.module.css'

// PhoneTabBar:手機版底部常駐導覽列——取代原本藏在 PhoneNavDrawer 側滑
// 抽屜裡的分頁列(.tabs),不需要先開抽屜才看得到分頁。項目由呼叫端
// (PhoneContent.tsx)的 tabs 陣列決定,目前是:旅程(開啟
// PhoneTripsDrawer 側滑抽屜)、行程(開啟候選籃抽屜)、AI 規劃(開啟對話
// PhoneBottomSheet 疊加層)——路徑(pace)與 demo-* 改放
// PhoneSideTools.tsx 右側小圖示,不在這裡。
//
// 規劃地圖已是唯一常駐主畫面,不再有可切換的分頁模式(使用者明確要求,見
// PhoneContent.tsx 的 chatSheetOpen/paceSheetOpen 說明)——這裡的每個項目
// 各自是獨立開關的疊加層,不是互斥的分頁,active 狀態因此改成呼叫端直接
// 傳 boolean,不再需要比對「目前選中哪個 mode」。
// 2026-10 修正:
// 1. 「旅程」原本寫死排在最前面、不經過 tabs 陣列——使用者要求把
//    「行程」(開啟候選籃抽屜,見 GeoOutlinePhoneView.tsx 的
//    candidateDrawerTrigger)搬進底部功能列、跟「旅程」交換位置,兩者
//    現在都改成普通 tabs 陣列項目,順序由呼叫端(PhoneContent.tsx)的
//    陣列順序決定,不再有「旅程永遠第一個」的特殊待遇。
// 2. icon 下方加入文字標籤——原本只有圖示,使用者要求補上文字,.tab 的
//    排列方向改成直向(icon 在上、文字在下),見 PhoneTabBar.module.css
//    的 .tab/.tabLabel。
export function PhoneTabBar({
  tabs,
}: {
  tabs: { key: string; icon: LucideIcon; title: string; active: boolean; onClick: () => void; beta?: boolean }[]
}) {
  return (
    <nav className={styles.bar}>
      {tabs.map(({ key, icon: Icon, title, active, onClick, beta }) => (
        <button
          key={key}
          type="button"
          className={styles.tab}
          onClick={onClick}
          title={title}
        >
          <span className={`${styles.tabIcon}${active ? ` ${styles.tabIconActive}` : ''}`}>
            <Icon size={20} strokeWidth={1.8} />
            {/* betaTag——視覺語言沿用 DesktopRail.module.css 的 .betaTag
                (標示正式功能還在測試中),見 PhoneContent.tsx 'plan-ai'
                項目的完整說明。 */}
            {beta && <span className={styles.betaTag}>BETA</span>}
          </span>
          <span className={styles.tabLabel}>{title}</span>
        </button>
      ))}
    </nav>
  )
}
