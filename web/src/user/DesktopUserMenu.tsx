import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Settings, LogOut } from 'lucide-react'
import type { ClientConfig } from '../api'
import type { User } from './types'
import { Avatar } from '../AppCommon'
import { LoginForm } from '../home/LoginForm'
import { ListRow } from '../components/ListRow'
import styles from './DesktopUserMenu.module.css'

// 桌面版左下方使用者設定入口:頭像 + 名稱一列,點擊展開 popover 選單。
// 已登入時選單只有「設定」(開啟 SettingsDialog)、「登出」兩項精簡項目;
// 訪客狀態維持原邏輯不變,popover 顯示登入表單(LoginForm)。
// 從 DesktopLayout.tsx 抽出獨立成檔案——原本在 DesktopRail 底下就地定義,
// 但本身是完整獨立、自帶 state(open)的元件,搬出來讓 DesktopLayout.tsx
// 專注在整體佈局骨架,不需要為了讀懂側欄結構而一併讀完使用者選單的
// popover 互動細節。
export function DesktopUserMenu({
  cfg,
  user,
  isGuest,
  onAuthed,
  onLogout,
  onOpenSettings,
  expanded,
}: {
  cfg: ClientConfig
  user: User
  isGuest: boolean
  onAuthed: (token: string, user: User, email: string) => void
  onLogout: () => void
  onOpenSettings: () => void
  // expanded:目前掛載在收合(48px)還是展開(180px)的 DesktopRail 底下——
  // 原本用 :global(.desktop-rail)/:global(.desktop-rail.expanded) 這兩個
  // 全域字串 class 選擇器從 CSS 側「猜測」外層容器的寬度狀態,DesktopRail
  // 元件化雜湊 class 後這組選擇器會直接失效。改成 DesktopRail 把它自己已經
  // 持有的 expanded state 直接當 prop 往下傳,DesktopUserMenu 不再需要靠
  // CSS 選擇器反推自己被放進什麼容器——更符合 React「資料由上往下明確
  // 傳遞」的慣例,也讓這個元件的排版分支在型別層級就可見(而非藏在
  // CSS 選擇器裡)。
  expanded: boolean
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // rect:觸發按鈕(頭像列)在螢幕上的實際位置,開啟時量測一次,供 portal 出去
  // 的 popover 用 position:fixed + 這份座標定位——見下方 popover 說明,
  // 不能再靠 CSS position:absolute 相對 .desktop-user-menu 定位。
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!open) return
    setRect(triggerRef.current?.getBoundingClientRect() ?? null)
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  return (
    <div className={styles.menu} ref={menuRef}>
      {/* portal 到 document.body——DesktopRail 為了寬度收合/展開過渡動畫
          設有 overflow:hidden(見 DesktopRail.module.css 的 .rail 說明),
          popover 若留在 rail 子樹內,只要往上/往右超出 rail 當下的窄版
          範圍就會被裁掉一角,這是實際回報過的 bug(選單邊緣被邊框遮蔽),
          不是預防性寫法。改成 portal 出去+position:fixed(用 rect 動態算
          座標),不再受任何祖先層 overflow/stacking context 影響——理由
          與做法對齊 Timeline.tsx EditEntrySheet 的 createPortal 說明。 */}
      {open && rect && createPortal(
        <div
          className={styles.popover}
          ref={popoverRef}
          style={{
            position: 'fixed',
            // left 用觸發按鈕的左緣(rect.left)往右留 8px 間隙,不直接
            // 貼齊——rect.left 通常等於 rail 本身的左邊界(頭像列貼齊
            // rail 左緣),選單左緣若直接等於 rect.left 會緊貼視窗/rail
            // 左邊界,跟其他浮動卡片(FloatingPanel side="left" 等)一致
            // 留有呼吸空間的慣例不符。也不用 rect.right(選單會整個跑到 rail
            // 右邊變成「往右展開」而非「往上展開」,先前誤用過)。
            // rail 收合時只有 48px 寬,260px 選單勢必會超出 rail 右緣、
            // 蓋到主顯示區地圖上方一部分,這是預期行為(選單本來就比
            // 48px rail 寬,無法完全收在 rail 範圍內)。
            left: rect.left + 8,
            // bottom 用 rect.top(觸發按鈕頂部)換算——popover 的 bottom
            // 邊要對齊按鈕的頂部邊,選單才會整個疊在按鈕正上方(往上展開);
            // 先前誤用 rect.bottom(按鈕底部),等於選單蓋住按鈕本身。
            bottom: window.innerHeight - rect.top + 6,
            width: 260,
          }}
        >
          {isGuest ? (
            <>
              <div className="section-title">目前身分</div>
              <ListRow icon={<Avatar user={user} />} title="訪客" subtitle="登入後發送的訊息會以你的身分顯示" />
              <LoginForm baseURL={cfg.baseURL} onAuthed={(tok, u, mail) => {
                onAuthed(tok, u, mail)
                setOpen(false)
              }} />
            </>
          ) : (
            <>
              <button
                className={styles.menuItem}
                onClick={() => { setOpen(false); onOpenSettings() }}
              >
                <Settings size={16} strokeWidth={1.8} />
                <span>設定</span>
              </button>
              <button
                className={styles.menuItem}
                onClick={() => { onLogout(); setOpen(false) }}
              >
                <LogOut size={16} strokeWidth={1.8} color="var(--ios-red)" />
                <span style={{ color: 'var(--ios-red)' }}>登出</span>
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
      <button
        className={expanded ? `${styles.trigger} ${styles.triggerExpanded}` : styles.trigger}
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar user={user} />
        <div className="grow">
          <div className="name">{isGuest ? '訪客' : user.name}</div>
          {isGuest && <div className="sub">點擊登入</div>}
        </div>
      </button>
    </div>
  )
}
