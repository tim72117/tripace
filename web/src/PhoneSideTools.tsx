import type { LucideIcon } from 'lucide-react'
import styles from './PhoneSideTools.module.css'

// PhoneSideTools:手機版右側下方小圖示群組——路徑(pace)+ demo-* 系列
// (推薦景點卡片/橫滑/onagent 串接)。這些原本也是 PhoneNavDrawer 側滑
// 抽屜分頁列的一部分,改版後跟正式導覽項目(旅程/對話,見
// PhoneTabBar.tsx)分開:路徑/demo-* 不是所有使用者都需要常駐看到的
// 主要功能,收成小圖示疊在畫面右下角,視覺語言沿用
// geo-planning/GeoOutlinePhoneView.module.css 的 candidateBtn/listBtn
// 圓形浮動按鈕樣式。
//
// 掛載在所有主畫面模式下(不是 GeoOutlinePhoneView 專屬),由
// PhoneContent.tsx 疊在 .mainArea 內部、跨所有分支共用。
//
// 每個項目各自帶一個 onClick——不再是統一呼叫 setDrawerMode 切換主畫面
// 模式(使用者明確要求「規劃地圖常駐為主畫面,配速表改成疊加層」,主畫面
// 不再有可切換的分頁模式,見 PhoneContent.tsx 的 paceSheetOpen 說明),
// 改由呼叫端各自決定點擊後要做什麼(開啟對應的 PhoneBottomSheet 疊加層
// 或其他行為)。
export function PhoneSideTools({
  tools,
}: {
  tools: { key: string; icon: LucideIcon; title: string; onClick: () => void }[]
}) {
  if (tools.length === 0) return null

  return (
    <div className={styles.tools}>
      {tools.map(({ key, icon: Icon, title, onClick }) => (
        <button
          key={key}
          type="button"
          className={styles.toolBtn}
          onClick={onClick}
          title={title}
        >
          <Icon size={20} strokeWidth={1.8} />
        </button>
      ))}
    </div>
  )
}
