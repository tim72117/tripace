import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom'
import { useAppState } from './hooks/useAppState'
import { ErrorBoundary } from './ErrorBoundary'
import styles from './App.module.css'

// 每條路由的頁面元件改用 React.lazy() 動態載入,取代原本的靜態 import——
// 靜態 import 會讓 Vite 把所有路由元件塞進同一個模組圖,不管使用者當下
// 訪問哪一條路徑,瀏覽器都會抓到全部頁面元件各自的程式碼(在 HomePage.tsx
// 這類獨立頁面上尤其明顯,使用者只是想看首頁,卻連帶載入了
// PhoneContent/CliAuthPage 等完全不相關的元件)。lazy() 讓 Vite/Rollup
// 把每個元件拆成獨立 chunk,只在真正導航到對應路由時才動態 import,首次
// 載入的 JS 體積只包含這條路由實際需要的程式碼。Suspense fallback 給
// null(空白瞬間),因為這些都是整頁級的路由切換,chunk 載入通常在使用者
// 感知延遲之前就完成,不需要額外的載入動畫。
const HomePage = lazy(() => import('./home/HomePage').then((m) => ({ default: m.HomePage })))
const ProductPage = lazy(() => import('./home/ProductPage').then((m) => ({ default: m.ProductPage })))
const PrivacyPage = lazy(() => import('./home/PrivacyPage').then((m) => ({ default: m.PrivacyPage })))
const TermsPage = lazy(() => import('./home/TermsPage').then((m) => ({ default: m.TermsPage })))
const CliAuthPage = lazy(() => import('./home/CliAuthPage').then((m) => ({ default: m.CliAuthPage })))
const DeviceAuthPage = lazy(() => import('./home/DeviceAuthPage').then((m) => ({ default: m.DeviceAuthPage })))
const PublicViewScreen = lazy(() => import('./trip/PublicViewScreen').then((m) => ({ default: m.PublicViewScreen })))
const PacePage = lazy(() => import('./pace/PacePage').then((m) => ({ default: m.PacePage })))
const PhoneContent = lazy(() => import('./PhoneContent').then((m) => ({ default: m.PhoneContent })))
const NotFoundPage = lazy(() => import('./home/NotFoundPage').then((m) => ({ default: m.NotFoundPage })))

// App.tsx 只保留路由判斷(App() 本身)——PhoneContent(含 PhoneNavDrawer 導覽
// 抽屜)搬到 PhoneContent.tsx、PacePage(原 PublicPaceDemoPage)搬到
// pace/ 目錄、useIsDesktop 搬到 AppCommon.tsx(供多處共用),讓這裡回到
// 單純的「進入點依路徑分派」職責。
//
// 改用 react-router-dom(v7)的 <BrowserRouter>/<Routes>/<Route> 取代原本
// window.location.pathname 手寫字串比對——目的是讓 /app 底下的 panelMode
// (見 DesktopLayout.tsx/PhoneContent.tsx)能反映到網址上,瀏覽器上一頁/
// 下一頁、重新整理、分享連結都能還原到對應畫面。路由本身只負責「依路徑
// 分派到哪個頁面元件」,不涉及登入狀態/旅程選擇(activeTrip 仍是
// useAppState() 管理的獨立 state,不進 URL,維持原樣)。
export function App() {
  const props = useAppState()
  return (
    <BrowserRouter>
      {/* ErrorBoundary 包在最外層——任何路由元件 render/effect 拋出未捕捉的
          例外,都會落地成一個可重新整理的畫面,而不是讓 React 把整棵樹
          unmount 到空白(對 SEO 是嚴重問題,見 ErrorBoundary.tsx 開頭說明)。 */}
      <ErrorBoundary>
        {/* Suspense 包住整個 <Routes>,而非各自包每個 <Route>——同一時間只會
            有一條路由在渲染,不需要每條路由各自一份 fallback 邏輯,包外層
            最單純。fallback 給 null:這些都是整頁級路由切換(不是頁面內的
            局部懶載入),chunk 抓取通常很快,不需要額外的載入態畫面。 */}
        <Suspense fallback={null}>
          <Routes>
          {/* 根路徑渲染首頁(全寬,不套 phone 外框)——京都東山探索路線的捲動
              視差敘事,見 HomePage.tsx。原本掛在這裡的功能介紹頁面(表格式
              列出產品功能/操作流程)搬到 /product,從首頁的導覽/CTA 連過去。 */}
          <Route path="/" element={<HomePage />} />
          {/* /product:功能介紹頁,見 ProductPage.tsx——列出產品核心功能與
              三步驟操作流程,原本掛在 "/",首頁改成 HomePage.tsx 之後搬到
              這裡,供首頁導覽連結指向。 */}
          <Route path="/product" element={<ProductPage />} />
          {/* 隱私權政策/服務條款——視覺語言對齊首頁(HomePage.tsx)的紙感和風
              風格,見 LegalPage.tsx。 */}
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          {/* /public/{token} 路徑:直接渲染公開分享頁。原本用正則
              /^\/public\/([^/]+)$/ 手動解析 token,改用 Route 的 :token
              路徑參數 + useParams() 取代。 */}
          {/* data-theme="light" 寫死:這是任何人(含未登入訪客)都能開的公開
              分享連結,不該受訪問者(若剛好也是登入使用者)的 App 內深色模式
              偏好影響,永遠維持淺色。 */}
          <Route
            path="/public/:token"
            element={
              <div className={styles.webApp} data-theme="light">
                <PublicTokenRoute />
              </div>
            }
          />
          {/* /cli-auth 路徑:`tripace-cli login --web` 開瀏覽器落地的核准頁面
              (見 CliAuthPage.tsx)。與 /public/{token} 一樣是獨立於主要 App
              狀態機之外的頁面,不套用 PhoneContent 那套登入/旅程/聊天畫面
              切換邏輯。 */}
          <Route
            path="/cli-auth"
            element={
              <div className={styles.webApp}>
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
              <div className={styles.webApp}>
                <DeviceAuthPage />
              </div>
            }
          />
          {/* /demo/pace 路徑:配速表 demo 的公開分享頁(見 PaceChart.tsx 的
              「分享這個配速表」按鈕)。這是固定示範資料(花東193公路),不是真實
              使用者旅程,不需要登入、不涉及任何真實資料權限問題——跟 /public/{token}
              那套給真實旅程用的公開分享是分開的機制,不走後端建立/驗證 token 那套
              流程,單純是一個固定網址。 */}
          {/* data-theme="light" 寫死,理由同 /public/:token——固定示範資料的
              公開分享頁,不受訪問者 App 內深色模式偏好影響。 */}
          <Route
            path="/demo/pace"
            element={
              <div className={styles.webApp} data-theme="light">
                <PacePage />
              </div>
            }
          />
          {/* /app 路徑:主要應用畫面本體(套 iPhone 外框,寬螢幕自動切桌面版佈局)。
              :panelMode 是選填的路徑參數(對應桌面版 side panel/手機版 demo 抽屜
              目前顯示的面板,見 DesktopLayout.tsx/PhoneContent.tsx),用 "?"
              後綴讓 /app(無參數)跟 /app/:panelMode 共用同一個 element。
              額外疊加全域 class app-theme-root(見 base-ui.css 深色模式 token
              區塊)——.webApp 是 CSS Modules 雜湊 class,base-ui.css 這種全域
              樣式表無法直接選取它,需要這個穩定的全域 class 名稱當掛載點。
              data-theme 屬性值來自 useAppState() 的 theme(登入後 App 的深色/
              淺色偏好,見 theme.ts),null 時不掛屬性交給 CSS 的
              prefers-color-scheme media query 處理「跟隨系統」。 */}
          <Route
            path="/app/:panelMode?"
            element={
              <div className={`${styles.webApp} app-theme-root`} data-theme={props.theme ?? undefined}>
                <PhoneContent {...props} />
              </div>
            }
          />
          {/* catch-all:真正找不到對應路由的路徑,渲染 404 頁面(NotFoundPage)。
              原本這裡是「除了上面幾條路徑,其他都走 PhoneContent」,讓任何
              打錯字/失效連結的網址都顯得像正常畫面——這對 SEO 是個陷阱:
              後端 static.go 對這類路徑一律回 200(見該檔案的判斷邏輯),等於
              Google 會把找不到的頁面當成有效內容索引。現在前後端同步改為
              真正的 404 語意:後端只對已知路由 pattern 回 200+index.html,
              其餘回 404 狀態碼;前端這裡對應渲染 NotFoundPage,讓人類使用者
              看到的是有品牌感、附導引動作的頁面,不是瀏覽器原生錯誤畫面。 */}
          <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
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
