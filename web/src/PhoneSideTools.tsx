import type { LucideIcon } from 'lucide-react'
import type { DrawerMode } from './DesktopShared'
import styles from './PhoneSideTools.module.css'

// PhoneSideTools:手機版右側下方小圖示群組——路徑(pace)+ demo-* 系列
// (推薦景點卡片/橫滑/onagent 串接)。這些原本也是 PhoneNavDrawer 側滑
// 抽屜分頁列的一部分,改版後跟正式導覽項目(行程/時間軸/規劃,見
// PhoneTabBar.tsx)分開:路徑/demo-* 不是所有使用者都需要常駐看到的
// 主要功能,收成小圖示疊在畫面右下角,視覺語言沿用
// geo-planning/GeoOutlinePhoneView.module.css 的 candidateBtn/listBtn
// 圓形浮動按鈕樣式。
//
// 掛載在所有主畫面模式下(不是 GeoOutlinePhoneView 專屬),由
// PhoneContent.tsx 疊在 .mainArea 內部、跨所有分支共用。
//
// 目前階段(先讓按鈕到位):onSelect 仍呼叫既有的 PhoneContent.tsx
// setDrawerMode,行為對齊改版前——之後會接上「點擊後改成浮動卡片」的
// PhoneFloatCard,這裡先不動,只負責讓按鈕出現在正確位置。
export function PhoneSideTools({
  tools,
  onSelect,
}: {
  tools: { mode: DrawerMode; icon: LucideIcon; title: string }[]
  onSelect: (mode: DrawerMode) => void
}) {
  if (tools.length === 0) return null

  return (
    <div className={styles.tools}>
      {tools.map(({ mode, icon: Icon, title }) => (
        <button
          key={mode}
          type="button"
          className={styles.toolBtn}
          onClick={() => onSelect(mode)}
          title={title}
        >
          <Icon size={20} strokeWidth={1.8} />
        </button>
      ))}
    </div>
  )
}
