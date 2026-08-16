import { useState } from 'react'
import { useIsDesktop } from '../hooks/useIsDesktop'
import { PaceChart, PACE_PUBLIC_LINK_TOKEN, type Checkpoint } from './PaceChart'
import { PaceRouteMap } from './PaceRouteMap'
import { PacePhoneSwipe } from './PacePhoneSwipe'
import '../styles-desktop.css'
import '../desktop-layout-shell.css'

// PacePage:/demo/pace 的公開分享頁內容(見 App.tsx App() 的路由判斷,原本
// 檔名/元件名叫 PublicPaceDemoPage,搬進 pace/ 目錄後去掉 Public/Demo
// 前綴——目錄本身已表明這是配速表功能的一部分,不需要再重複)。版型直接
// 比照登入後 pace 面板的樣子(側欄清單 + 主區地圖,見 DesktopLayout.tsx
// DesktopContent 的 pace 分支),只是不放最左側的 DesktopRail(行程/
// 時間軸/使用者選單那條圖示列,公開頁不需要、也沒有登入身分可以顯示)。
// 沿用同一套 .desktop-sidepanel/.desktop-main class,不是重新設計一份
// 版型;.desktop-layout 底下少了 DesktopRail 這個 flex sibling 不影響
// sidepanel/main 各自的排版,不需要額外 CSS。手機寬度沿用跟登入後手機版
// 一致的 PacePhoneSwipe(滑動雙頁),不需要另外做一份。
//
// 「點卡片→地圖平移→手動微調→儲存座標」這套互動(見 PaceRouteMap.tsx 的
// SelectedEntry/selectedEntry/onSelectedEntryDone)刻意不接在這個公開頁:
// 這是任何人不用登入都能看的分享頁,寫入座標是需要登入身分的維運操作,
// 不該出現在公開頁面上——只在 DesktopLayout.tsx(登入後正式介面)提供。
export function PacePage() {
  const isDesktop = useIsDesktop()
  // checkpoints:比照登入後正式介面(DesktopLayout.tsx/PhoneContent.tsx)的
  // 作法,PaceChart 目前選取的那一段透過 onRouteChange 鏡像上來,轉傳給
  // PaceRouteMap 畫路線——公開頁沒有 cfg/tripID,PaceChart 走公開連結
  // token 那條路徑抓資料,但鏡像機制本身是同一套,不需要另外處理。
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  if (!isDesktop) {
    return (
      <PacePhoneSwipe
        publicToken={PACE_PUBLIC_LINK_TOKEN}
        checkpoints={checkpoints}
        onRouteChange={setCheckpoints}
      />
    )
  }
  return (
    <div className="desktop-layout">
      <aside className="desktop-sidepanel wide">
        <div className="desktop-sidepanel-inner">
          <div className="desktop-sidepanel-pace">
            <PaceChart onRouteChange={setCheckpoints} />
          </div>
        </div>
      </aside>
      <main className="desktop-main">
        <div className="desktop-demo-panel">
          <PaceRouteMap checkpoints={checkpoints} publicToken={PACE_PUBLIC_LINK_TOKEN} />
        </div>
      </main>
    </div>
  )
}
