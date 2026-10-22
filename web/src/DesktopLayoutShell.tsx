import { forwardRef } from 'react'
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import styles from './DesktopLayoutShell.module.css'

// DesktopLayoutShell:桌面版整體佈局的最外層 flex 容器(原全域字串 class
// .desktop-layout,見 desktop-layout-shell.css 的既有說明)——收斂
// desktop/Content.tsx(登入後正式介面)、pace/PacePage.tsx(/demo/pace 公開
// 分享頁)、trip/PublicViewScreen.tsx(旅程分享頁的桌面路徑分支)三處呼叫端
// 共用的同一組骨架 CSS,只是純容器,不涉及內容語意,children 插槽即可。
//
// 命名刻意叫 DesktopLayoutShell,不叫 desktop/Content——desktop/Content.tsx
// 本身已經是桌面版最外層「頁面」元件的既有檔名(渲染 desktop/Content,內部
// 才會用到這個容器),兩者同名會造成混淆。Shell 呼應這份骨架 CSS 檔案本身
// 的檔名 desktop-layout-shell.css,表達「這是版面骨架殼,不是頁面本身」。
// 其餘 HTML 屬性(例如 data-slot)原樣轉給最外層 div,供 desktop/PlanLayout 標示 data-slot="container"。
export interface DesktopLayoutShellProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className' | 'style'> {
  children: ReactNode
  // className/style:比照 ScrollArea/Button 等其餘共用元件的既有慣例,
  // 保留一次性覆寫的逃生口——目前沒有呼叫端需要,但沒有理由讓這個共用
  // 元件成為擋住未來需求的瓶頸。
  className?: string
  style?: CSSProperties
}

// forwardRef——比照 ScrollArea.tsx 等既有慣例保留轉發能力,目前沒有
// 呼叫端需要,但沒有理由讓這個共用元件成為擋住未來需求的瓶頸。
export const DesktopLayoutShell = forwardRef<HTMLDivElement, DesktopLayoutShellProps>(
  function DesktopLayoutShell({ children, className, style, ...rest }, ref) {
    return (
      <div {...rest} ref={ref} className={className ? `${styles.layout} ${className}` : styles.layout} style={style}>
        {children}
      </div>
    )
  },
)
