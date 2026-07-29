import { LandingPage } from './LandingPage'
import { CliAuthPage } from './CliAuthPage'
import { useAppState } from './AppCommon'
import { PublicViewScreen } from './PhoneScreens'
import { PublicPaceDemoPage } from './PublicPaceDemoPage'
import { PhoneContent } from './PhoneContent'

// App.tsx 只保留路由判斷(App() 本身)——PhoneContent/PhoneDemoDrawer 搬到
// PhoneContent.tsx、PublicPaceDemoPage 搬到自己的檔案、useIsDesktop 搬到
// AppCommon.tsx(供多處共用),讓這裡回到單純的「進入點依路徑分派」職責。
export function App({ isDemo = false }: { isDemo?: boolean } = {}) {
  const props = useAppState()
  // 根路徑渲染產品介紹 landing page(全寬,不套 phone 外框)
  if (window.location.pathname === '/') {
    return <LandingPage />
  }
  // 偵測 /public/{token} 路徑，直接渲染公開分享頁
  const publicMatch = window.location.pathname.match(/^\/public\/([^/]+)$/)
  if (publicMatch) {
    return (
      <div className="web-app">
        <PublicViewScreen token={publicMatch[1]} />
      </div>
    )
  }
  // /cli-auth 路徑:`tripace-cli login --web` 開瀏覽器落地的核准頁面
  // (見 CliAuthPage.tsx)。與 /public/{token} 一樣是獨立於主要 App 狀態機
  // 之外的頁面,不套用 PhoneContent 那套登入/頻道/聊天畫面切換邏輯。
  if (window.location.pathname === '/cli-auth') {
    return (
      <div className="web-app">
        <CliAuthPage />
      </div>
    )
  }
  // /demo/pace 路徑:配速表 demo 的公開分享頁(見 PaceChartDemo.tsx 的
  // 「分享這個配速表」按鈕)。這是固定示範資料(花東193公路),不是真實
  // 使用者頻道,不需要登入、不涉及任何真實資料權限問題——跟 /public/{token}
  // 那套給真實頻道用的公開分享是分開的機制,不走後端建立/驗證 token 那套
  // 流程,單純是一個固定網址。
  if (window.location.pathname === '/demo/pace') {
    return (
      <div className="web-app">
        <PublicPaceDemoPage />
      </div>
    )
  }
  // /app 路徑:主要應用畫面本體(套 iPhone 外框,寬螢幕自動切桌面版佈局)
  return (
    <div className="web-app">
      <PhoneContent {...props} isDemo={isDemo} />
    </div>
  )
}
