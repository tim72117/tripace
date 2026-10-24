import type { CSSProperties, HTMLAttributes } from 'react'
import { OVERLAY_SLOT, slotAttr } from '../../shared/overlayDom'
import type { PlanLayoutContract } from '../../shared/layerContracts'
import styles from './PlanLayout.module.css'

// PlanLayout(登入後手機版)——最外層容器,對應 /ai-plan 的 planning/preview/PlanLayout:同一個層級、
// 同一個名字,都渲染 data-slot="container" 的容器(骨架見 planning/shared/overlayDom.ts)。
// 兩邊是各自實作的元件(放在不同資料夾):這一份只管容器本身,內容(地圖與疊加外殼 PlanOverlayLayout、
// phone/Nav、PhoneSideTools、各個 sheet)由呼叫端(planning/member/phone/Content)當 children 放進來。
//
// tabBarHeight——phone/Nav 量到的真實高度(px),寫成 CSS 自訂屬性 --tab-bar-height。寫在這個容器
// (phone/Nav 跟所有需要避開它的 bottom sheet 共用的定位祖先)上,自訂屬性沿 DOM 樹往下繼承,
// 子孫元素(含各個 .module.css 與 inline style)都能直接 var(--tab-bar-height) 讀到同一份數值。
// 初始量測結果是 0(ResizeObserver 要等第一次 layout 完成才會回報),只有一個 frame 的落差。
// PlanLayoutProps——滿足共同契約 PlanLayoutContract(planning/shared/layerContracts.ts),加手機特有的 tabBarHeight 與
// 其餘 div 屬性(children 由契約定義,所以從 HTMLAttributes 排除)。
export interface PlanLayoutProps extends PlanLayoutContract, Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  tabBarHeight: number
}

export function PlanLayout({
  tabBarHeight,
  children,
  ...rest
}: PlanLayoutProps) {
  return (
    <div
      {...rest}
      {...slotAttr(OVERLAY_SLOT.container)}
      className={styles.container}
      style={{ '--tab-bar-height': `${tabBarHeight}px` } as CSSProperties}
    >
      {children}
    </div>
  )
}
