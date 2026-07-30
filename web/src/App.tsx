import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom'
import { LandingPage } from './LandingPage'
import { CliAuthPage } from './CliAuthPage'
import { DeviceAuthPage } from './DeviceAuthPage'
import { useAppState } from './AppCommon'
import { PublicViewScreen } from './PhoneScreens'
import { PublicPaceDemoPage } from './PublicPaceDemoPage'
import { PhoneContent } from './PhoneContent'

// App.tsx 只保留路由判斷(App() 本身)——PhoneContent(含 PhoneNavDrawer 導覽
// 抽屜)搬到 PhoneContent.tsx、PublicPaceDemoPage 搬到自己的檔案、
// useIsDesktop 搬到 AppCommon.tsx(供多處共用),讓這裡回到單純的「進入點
// 依路徑分派」職責。
//
// 改用 react-router-dom(v7)的 <BrowserRouter>/<Routes>/<Route> 取代原本
// window.location.pathname 手寫字串比對——目的是讓 /app 底下的 panelMode
// (見 DesktopLayout.tsx/PhoneContent.tsx)能反映到網址上,瀏覽器上一頁/
// 下一頁、重新整理、分享連結都能還原到對應畫面。路由本身只負責「依路徑
// 分派到哪個頁面元件」,不涉及登入狀態/頻道選擇(activeChannel 仍是
// useAppState() 管理的獨立 state,不進 URL,維持原樣)。
export function App({ isDemo = false }: { isDemo?: boolean } = {}) {
  const props = useAppState()
  return (
    <BrowserRouter>
      <Routes>
        {/* 根路徑渲染產品介紹 landing page(全寬,不套 phone 外框)。 */}
        <Route path="/" element={<LandingPage />} />
        {/* /public/{token} 路徑:直接渲染公開分享頁。原本用正則
            /^\/public\/([^/]+)$/ 手動解析 token,改用 Route 的 :token
            路徑參數 + useParams() 取代。 */}
        <Route
          path="/public/:token"
          element={
            <div className="web-app">
              <PublicTokenRoute />
            </div>
          }
        />
        {/* /cli-auth 路徑:`tripace-cli login --web` 開瀏覽器落地的核准頁面
            (見 CliAuthPage.tsx)。與 /public/{token} 一樣是獨立於主要 App
            狀態機之外的頁面,不套用 PhoneContent 那套登入/頻道/聊天畫面
            切換邏輯。 */}
        <Route
          path="/cli-auth"
          element={
            <div className="web-app">
              <CliAuthPage />
            </div>
          }
        />
        {/* /device 路徑:`tripace-cli login --device`(無頭環境用的 device
            code 流程,見 DeviceAuthPage.tsx)落地的核准頁面——網址本身固定
            不帶代碼(唯一例外是 CLI best-effort 開瀏覽器時附上的 ?code=
            純粹圖方便預先帶入輸入框),使用者也可以手動打開這個網址、自己
            輸入代碼,不需要點 CLI 印出的連結。跟 /cli-auth 一樣獨立於主要
            App 狀態機之外。 */}
        <Route
          path="/device"
          element={
            <div className="web-app">
              <DeviceAuthPage />
            </div>
          }
        />
        {/* /demo/pace 路徑:配速表 demo 的公開分享頁(見 PaceChart.tsx 的
            「分享這個配速表」按鈕)。這是固定示範資料(花東193公路),不是真實
            使用者頻道,不需要登入、不涉及任何真實資料權限問題——跟 /public/{token}
            那套給真實頻道用的公開分享是分開的機制,不走後端建立/驗證 token 那套
            流程,單純是一個固定網址。 */}
        <Route
          path="/demo/pace"
          element={
            <div className="web-app">
              <PublicPaceDemoPage />
            </div>
          }
        />
        {/* /app 路徑:主要應用畫面本體(套 iPhone 外框,寬螢幕自動切桌面版佈局)。
            :panelMode 是選填的路徑參數(對應桌面版 side panel/手機版 demo 抽屜
            目前顯示的面板,見 DesktopLayout.tsx/PhoneContent.tsx),用 "?"
            後綴讓 /app(無參數)跟 /app/:panelMode 共用同一個 element。 */}
        <Route
          path="/app/:panelMode?"
          element={
            <div className="web-app">
              <PhoneContent {...props} isDemo={isDemo} />
            </div>
          }
        />
        {/* catch-all:原本的邏輯是「除了上面幾條路徑,其他都走 PhoneContent」,
            這裡明確用 path="*" 保留這個 fallback 行為,避免路由外的路徑
            (例如使用者手動輸入的其他網址)變成空白頁。 */}
        <Route
          path="*"
          element={
            <div className="web-app">
              <PhoneContent {...props} isDemo={isDemo} />
            </div>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

// PublicTokenRoute:用 useParams() 取出 :token 路徑參數轉交給 PublicViewScreen——
// 獨立成這個小元件單純是因為 useParams() 是 hook,必須在 Route 的 element
// 底下(Router context 內)呼叫,不能直接在 App() 裡呼叫後傳給多個 Route。
function PublicTokenRoute() {
  const { token } = useParams<{ token: string }>()
  return <PublicViewScreen token={token ?? ''} />
}
