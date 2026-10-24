import { forwardRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import styles from './Nav.module.css'

// phone/Nav:手機版底部常駐導覽列——取代原本藏在 PhoneNavDrawer 側滑
// 抽屜裡的分頁列(.tabs),不需要先開抽屜才看得到分頁。項目由呼叫端
// (planning/member/phone/Content.tsx)的 tabs 陣列決定,目前是:行程(開啟候選籃/行程抽屜;
// 尚未選擇清單時改為先開 trip/phone/TripList 讓使用者選)、探索(觸發探索面板)、
// 規劃(切換對話 PhoneBottomSheet 疊加層,帶 BETA 標記)——路徑(pace)改放
// PhoneSideTools.tsx 右側小圖示,不在這裡。
//
// 規劃地圖已是唯一常駐主畫面,不再有可切換的分頁模式(使用者明確要求,見
// planning/member/phone/Content.tsx 的 chatSheetOpen/paceSheetOpen 說明)——這裡的每個項目
// 各自是獨立開關的疊加層,不是互斥的分頁,active 狀態因此改成呼叫端直接
// 傳 boolean,不再需要比對「目前選中哪個 mode」。
// 2026-10 修正:
// 1. 「旅程」原本寫死排在最前面、不經過 tabs 陣列——使用者要求把
//    「行程」(開啟行程清單抽屜,見 planning/member/phone/Content.tsx 的
//    tripListDrawerTrigger)搬進底部功能列、跟「旅程」交換位置,兩者
//    現在都改成普通 tabs 陣列項目,順序由呼叫端(planning/member/phone/Content.tsx)的
//    陣列順序決定,不再有「旅程永遠第一個」的特殊待遇。
// 2. icon 下方加入文字標籤——原本只有圖示,使用者要求補上文字,.tab 的
//    排列方向改成直向(icon 在上、文字在下),見 phone/Nav.module.css
//    的 .tab/.tabLabel。
// forwardRef——2026-10 新增(使用者明確要求「有辦法確保 bottom sheet
// 如果是在功能列後面,標頭不會被遮蔽,也不用功能列改動高度就要重新
// 確認」):讓呼叫端(planning/member/phone/Content.tsx)能掛 ref 在這個 <nav> 上,搭配
// hooks/useElementHeight.ts 的 ResizeObserver 量出真實高度,取代目前
// 散落各處把這裡的 .tab 高度(64px)當作寫死數字複製貼上的做法——見該
// hook 的完整說明。
export const Nav = forwardRef<HTMLElement, {
  tabs: { key: string; icon: LucideIcon; title: string; active: boolean; onClick: () => void; beta?: boolean }[]
}>(function PhoneNav({ tabs }, ref) {
  return (
    <nav className={styles.bar} ref={ref}>
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
            {/* betaTag——視覺語言沿用 desktop/Nav.module.css 的 .betaTag
                (標示正式功能還在測試中),見 planning/member/phone/Content.tsx 'plan-ai'
                項目的完整說明。 */}
            {beta && <span className={styles.betaTag}>BETA</span>}
          </span>
          <span className={styles.tabLabel}>{title}</span>
        </button>
      ))}
    </nav>
  )
})
