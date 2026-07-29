import { useIsDesktop } from './AppCommon'
import { PaceChartDemo } from './PaceChartDemo'
import { PaceRouteMap } from './PaceRouteMap'
import { PacePhoneSwipe } from './PacePhoneSwipe'

// PublicPaceDemoPage:/demo/pace 的公開分享頁內容(見 App.tsx App() 的路由
// 判斷)。版型直接比照登入後 demo-pace 面板的樣子(側欄清單 + 主區地圖,見
// DesktopLayout.tsx DesktopContent 的 demo-pace 分支),只是不放最左側的
// DesktopRail(頻道/時間軸/使用者選單那條圖示列,公開頁不需要、也沒有
// 登入身分可以顯示)。沿用同一套 .desktop-sidepanel/.desktop-main class,
// 不是重新設計一份版型;.desktop-layout 底下少了 DesktopRail 這個 flex
// sibling 不影響 sidepanel/main 各自的排版,不需要額外 CSS。手機寬度沿用
// 跟登入後手機版一致的 PacePhoneSwipe(滑動雙頁),不需要另外做一份。
export function PublicPaceDemoPage() {
  const isDesktop = useIsDesktop()
  if (!isDesktop) {
    return <PacePhoneSwipe />
  }
  return (
    <div className="desktop-layout">
      <aside className="desktop-sidepanel wide">
        <div className="desktop-sidepanel-inner">
          <div className="desktop-sidepanel-pace">
            <PaceChartDemo />
          </div>
        </div>
      </aside>
      <main className="desktop-main">
        <div className="desktop-demo-panel">
          <PaceRouteMap />
        </div>
      </main>
    </div>
  )
}
