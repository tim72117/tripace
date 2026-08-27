import { forwardRef } from 'react'
import type { ReactNode } from 'react'
import styles from './DesktopSidepanel.module.css'

// DesktopSidepanel:桌面版可收合側欄容器(原全域字串 class
// .desktop-sidepanel/.collapsed/.wide + .desktop-sidepanel-inner)——目前
// 有三處呼叫端:
//   1) DesktopLayout.tsx 登入後正式介面,已改用 panelMode 驅動的浮動卡片
//      (FloatingPanel),不再渲染這個容器本身。
//   2) pace/PacePage.tsx(/demo/pace 公開分享頁)與
//      trip/PublicViewScreen.tsx 的 PublicPaceDrawerMap(旅程分享頁桌面
//      寬度分支)仍沿用「側欄清單 + 主區地圖」這套舊版型,固定套用 wide
//      變體(見下方 wide prop 說明)。
// collapsed 變體目前沒有呼叫端使用(DesktopLayout.tsx 已改用浮動卡片,
// 不再需要側欄本身收合的 push 動畫),但收合的 CSS 過渡規則本身仍是這個
// 容器語意的一部分(未來若有呼叫端需要「側欄清單 + 可收合」版型,不需要
// 重新設計這組 transition),故保留成具名 prop,不因為目前沒有呼叫端就
// 砍掉這個變體。
export interface DesktopSidepanelProps {
  children: ReactNode
  // collapsed:側欄收合成 0 寬(見 module.css 的 transition:flex-basis/
  // width/border-color),主區跟著撐開的 push 模式,非 overlay。
  collapsed?: boolean
  // wide:見上方元件說明——PublicPaceDemoPage(pace/PacePage.tsx)與
  // PublicPaceDrawerMap(trip/PublicViewScreen.tsx)仍沿用「側欄清單 + 主區
  // 地圖」這套舊版型,固定套用這個變體讓側欄容納配速表檢查站清單
  // (380px,比一般 272px 側欄更寬)。
  wide?: boolean
  className?: string
}

// forwardRef——比照 ScrollArea.tsx/Button.tsx 既有慣例保留轉發能力,目前
// 沒有呼叫端需要,但沒有理由讓這個共用元件成為擋住未來需求的瓶頸。
export const DesktopSidepanel = forwardRef<HTMLElement, DesktopSidepanelProps>(
  function DesktopSidepanel({ children, collapsed, wide, className }, ref) {
    const classes = [styles.sidepanel]
    if (collapsed) classes.push(styles.collapsed)
    if (wide) classes.push(styles.wide)
    if (className) classes.push(className)
    return (
      <aside ref={ref} className={classes.join(' ')}>
        {/* inner 維持完整寬度渲染內容,收合時靠外層 width:0 裁掉,避免收合
            過程中內容本身被壓縮換行(transition 期間看起來會很醜)——見
            module.css 的 .inner/.wide .inner 說明。 */}
        <div className={wide ? `${styles.inner} ${styles.innerWide}` : styles.inner}>
          {children}
        </div>
      </aside>
    )
  },
)
