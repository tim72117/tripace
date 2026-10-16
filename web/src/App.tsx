import { lazy, Suspense, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import { useAppState } from './hooks/useAppState'
import { ErrorBoundary } from './ErrorBoundary'
import { useKeyboardShrink } from './components/useKeyboardInset'
import { trackEvent } from './analytics'
import styles from './App.module.css'

// PageViewTracker:SPA 路由切換時手動推送虛擬頁面瀏覽事件——這個專案是
// React Router 的用戶端路由(BrowserRouter),換頁不會重新整理瀏覽器、
// 也不會觸發完整的文件載入,GTM 容器預設的「頁面瀏覽」偵測只在最初的
// 文件載入觸發一次,之後站內導覽(例如首頁→九份頁)完全不會再送出任何
// 頁面瀏覽訊號給 GA4——這正是 GA4「瀏覽量(劃分依據:網頁標題與畫面
// 名稱)」報表看不出各頁面差異的根因:不是標題沒設對,是壓根沒有事件
// 告訴 GA4「使用者換頁了」。
// 用 trackEvent('page_view', {...}) 推送(不是另外發明新事件名稱)——
// page_view 是 GA4 的保留字,GTM 容器後台的 GA4 設定標籤的 History
// Change/Custom Event trigger 通常直接抓這個事件名稱,不需要為了這個
// 情境另外建一個「virtual_page_view」事件再多一層對應設定。
// page_path/page_title/page_location 是 GA4 建議的頁面瀏覽欄位名稱
// (對齊 gtag.js 自動收集時慣用的參數),GTM 容器把這三個設成 Data
// Layer Variable 餵給 GA4 設定標籤即可,不需要額外改 index.html。
// document.title 讀取包一層 setTimeout(0)——react-helmet-async 透過
// 自己的 effect 更新 <title>,跟這裡的路由變化 effect 誰先誰後沒有
// 嚴格保證,直接同步讀可能還拿到切換前的舊標題;延後一個 tick 讓
// Helmet 的 effect 有機會先跑完,避免讀到的 page_title 跟實際網址
// 對不上。
function PageViewTracker() {
  const location = useLocation()
  useEffect(() => {
    const timer = setTimeout(() => {
      trackEvent('page_view', {
        page_path: location.pathname + location.search,
        page_title: document.title,
        page_location: window.location.href,
      })
    }, 0)
    return () => clearTimeout(timer)
  }, [location.pathname, location.search])
  return null
}

// ScrollRestoration:切換路由(路徑改變)時把捲動位置重置回頂部——
// React Router 的用戶端路由預設不會這麼做(跟整頁重新整理不同,瀏覽器
// 原生的「換頁回到頂部」行為這裡完全不會發生),2026-10 使用者回報:
// 主題介紹頁捲到最底部後,透過頁內連結切到另一個主題介紹頁(例如
// 九份→京都),新頁面會直接從「捲動到底」的位置開始顯示,而不是從頭。
// 只依賴 location.pathname(不含 search/hash)——同一頁面內只是 query
// string 變化(例如地圖互動產生的狀態)或錨點跳轉(#section)不該被這裡
// 打斷,只有真正換了一個頁面路徑才需要重置捲動位置。
//
// 用 window.scrollTo 而非 window.scrollTo({behavior: 'smooth'})——換頁
// 當下應該讓使用者直接看到新頁面最上方的內容,平滑捲動反而會讓使用者
// 先看到一段從舊頁面殘留位置捲回頂部的過場動畫,不是預期的「跳過去」
// 體驗。
function ScrollRestoration() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

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
const JiufenPage = lazy(() => import('./home/JiufenPage').then((m) => ({ default: m.JiufenPage })))
const KyotoPage = lazy(() => import('./home/KyotoPage').then((m) => ({ default: m.KyotoPage })))
const TainanPage = lazy(() => import('./home/TainanPage').then((m) => ({ default: m.TainanPage })))
const TainanChikanPage = lazy(() => import('./home/TainanChikanPage').then((m) => ({ default: m.TainanChikanPage })))
const PrivacyPage = lazy(() => import('./home/PrivacyPage').then((m) => ({ default: m.PrivacyPage })))
const TermsPage = lazy(() => import('./home/TermsPage').then((m) => ({ default: m.TermsPage })))
const CliAuthPage = lazy(() => import('./home/CliAuthPage').then((m) => ({ default: m.CliAuthPage })))
const DeviceAuthPage = lazy(() => import('./home/DeviceAuthPage').then((m) => ({ default: m.DeviceAuthPage })))
const PublicViewScreen = lazy(() => import('./trip/PublicViewScreen').then((m) => ({ default: m.PublicViewScreen })))
const PacePage = lazy(() => import('./pace/PacePage').then((m) => ({ default: m.PacePage })))
const PhoneContent = lazy(() => import('./PhoneContent').then((m) => ({ default: m.PhoneContent })))
const NotFoundPage = lazy(() => import('./home/NotFoundPage').then((m) => ({ default: m.NotFoundPage })))
// AIPlanTimelinePage(plan-ai-sim):獨立公開頁,從 plan-ai-sim 分支原封
// 不動搬過來的「AI 安排行程」模擬展示原型(見 home/plan-ai-sim/ 目錄的
// 完整說明)。固定接純前端假資料(attractionPool.ts),不需要登入、不
// 依賴任何需要 token 的後端端點,故放進 home/ 底下跟其餘公開行銷頁同一
// 層級,不是 /app 底下需要登入的正式功能。
const TripPlanRoute = lazy(() => import('./trip-plan/TripPlanRoute').then((m) => ({ default: m.TripPlanRoute })))
// AiItinerariesRoute:「精選行程」展示(清單 + 點進去的時間軸,2026-10
// 使用者明確要求頁面文案從「AI 排好的範例行程」改成「精選行程」,元件/
// 目錄名稱維持不變,純粹是對外文案改名),
// 公開頁,整個功能在 itineraries/ 這個獨立目錄(2026-10 從 ai-itineraries/
// 改名,使用者明確要求「web/src/ai-itineraries 路徑簡化」,見該檔案的
// 完整說明),見該檔案的完整說明。
const AiItinerariesRoute = lazy(() => import('./itineraries/AiItinerariesRoute').then((m) => ({ default: m.AiItinerariesRoute })))
const PlanAiSimPage = lazy(() => import('./home/plan-ai-sim/AIPlanTimelinePage').then((m) => ({ default: m.AIPlanTimelinePage })))
// BlogArticlePage:部落客發文正式頁面(2026-10 從主題介紹頁內容規格化
// 試做轉正,見 docs/brainstorm/2026-10-product-direction-brainstorm.md
// 構想五「發文工具產品線」的完整說明;原始規格設計見 docs/
// refactor-theme-page-content-cms-plan-2026-10.md 的 ThemePageContent,
// 見 web/src/blog/types.ts)——2026-10 改成依路由路徑參數(作者
// handle + 文章 slug)渲染對應文章,見下方 /u/:handle/:slug 路由與
// BlogArticleRoute 的完整說明。元件本身改吃 handle/slug 兩個 props,
// 路由層面的參數解析交給 BlogArticleRoute 負責,不在元件內部呼叫
// useParams()。
const BlogArticlePage = lazy(() => import('./blog/BlogArticlePage').then((m) => ({ default: m.BlogArticlePage })))
// PhotoManagerPage:/blog/photos 路由,部落客管理自己上傳過的圖片、設定
// 裁切焦點(見該檔案開頭的完整說明)——後端上傳/焦點 API 見
// server/internal/api/blog_photo.go,與 BlogArticlePage 同屬「部落格
// 發文」功能,但這是獨立的圖片管理頁,不涉及文章內容渲染。
const PhotoManagerPage = lazy(() => import('./blog/PhotoManagerPage').then((m) => ({ default: m.PhotoManagerPage })))
// LayoutGalleryPage:/dev/layouts 路由,開發用的版型目錄頁(2026-10 新增,
// 見該檔案開頭的完整說明)——陳列 BlogArticle.css 目前支援的所有版型,
// 骨架圖+範例文字,不依賴任何真實照片或後端資料。純開發工具,不是
// 產品功能,不加進任何站內導覽連結。
const LayoutGalleryPage = lazy(() => import('./blog/LayoutGalleryPage').then((m) => ({ default: m.LayoutGalleryPage })))
// KeyboardShrinkGuard:/app 路由專用——鍵盤彈出時把根容器高度直接改成
// visualViewport.height,取代先前試過的 transform: translateY(-offsetTop)
// 反向抵銷做法。
//
// 排查過程(手機真機實測)確定的關鍵事實:.composer(輸入框,
// position: absolute; bottom: 0)的位置數學上一直是對的,不需要調整——
// offsetTop + visualViewport.height 恆等於掛載時的基準高度,代表 iOS
// 已經把可視視窗精確平移到頁面最底部,composer 天生落在可視範圍內。
// 但 translateY(-offsetTop) 這個做法實測失敗、且反而讓輸入框跑位——
// iOS 平移可視視窗的目的就是要讓聚焦的輸入框露出鍵盤上方,translateY
// 把整份內容視覺上搬回原位,等於把原本剛好對齊鍵盤上緣的輸入框,又搬回
// 了鍵盤底下被擋住的位置——治標不治本。
//
// 改成直接讓根容器的實際高度縮小成 visualViewport.height(取代 CSS 的
// 100dvh)——縮小後,composer 的 bottom: 0 天生就貼在新高度的底部(即
// 鍵盤上緣),iOS 沒有理由再平移可視視窗。動畫過渡期的處理邏輯(穩定幀
// 偵測、resize/scroll 分開處理、focusout 零延遲還原)見
// useKeyboardShrink 的完整說明。
//
// 高度覆蓋必須直接套用在 .webApp 本身,不能是外層再包一層 wrapper div
// ——實測發現套在外層完全無效(輸入框仍跑位到鍵盤下方):.webApp 自己
// 的 CSS 寫死 height: 100dvh,這是絕對值,不會因為父層 wrapper 變矮就
// 跟著收縮(block 元素預設不受父層 height 限制強制縮小)。外層 wrapper
// 縮小只是把部分溢出內容裁切掉,製造出「上方平移改善了」的錯覺,實際上
// .webApp 內部的定位鏈(含 PhoneBottomSheet 的 .panel、.composer 的
// bottom: 0)仍然是相對舊高度(100dvh)計算,完全沒有跟著縮小。改成
// KeyboardShrinkGuard 直接渲染 .webApp 本身(吃進 className/data-theme
// prop 並掛 ref),不再是外層 wrapper。
//
// useKeyboardShrink 直接操作 DOM(見該函式說明),不透過 React state
// 回傳高度值——這個元件因此不需要用 height 觸發重新渲染,只需要把
// ref 交給 hook,children 完全不受這個高度變化影響重新渲染。
function KeyboardShrinkGuard({ className, dataTheme, children }: { className: string; dataTheme?: string; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  useKeyboardShrink(rootRef)
  return (
    <div ref={rootRef} className={className} data-theme={dataTheme}>
      {children}
    </div>
  )
}

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
      {/* PageViewTracker/ScrollRestoration 必須在 BrowserRouter 內部
          (useLocation 依賴 Router context)、Routes 外層(不受單一路由的
          Suspense/lazy 載入影響,路徑一變就能立刻讀到新的 useLocation
          值)。見各自元件開頭的完整說明。 */}
      <PageViewTracker />
      <ScrollRestoration />
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
          {/* /jiufen:九份介紹頁,見 JiufenPage.tsx——地形→礦業→衰退→人文
              重生因果鏈的分段長頁,視覺語言對齊 ProductPage/HomePage 的
              紙感和風,無捲動視差特效。 */}
          <Route path="/jiufen" element={<JiufenPage />} />
          {/* /kyoto-kiyomizu:京都・清水寺介紹頁,見 KyotoPage.tsx——原本
              HomePage.tsx 首頁捲動視差敘事的獨立頁面版本(該敘事與互動
              地圖已從首頁移除,只留在這個獨立頁面),外殼架構對齊
              JiufenPage.tsx 模式(互動地圖+進度導覽點+分段長頁)。 */}
          <Route path="/kyoto-kiyomizu" element={<KyotoPage />} />
          {/* /tainan-anping:台南・安平介紹頁,見 TainanPage.tsx——港口地形→
              貿易→淤積轉型→人文重生因果鏈的分段長頁,外殼架構對齊
              JiufenPage.tsx 模式(互動地圖+進度導覽點+分段長頁)。 */}
          <Route path="/tainan-anping" element={<TainanPage />} />
          {/* /tainan-chikan:赤崁・府城「老地方的前世今生」兩日遊介紹頁,見
              TainanChikanPage.tsx——2026-10 從內部試做頁
              (/tainan-chikan-draft)轉正,外殼架構對齊 JiufenPage.tsx 模式
              (互動地圖+進度導覽點+分段長頁+Helmet SEO meta)。 */}
          <Route path="/tainan-chikan" element={<TainanChikanPage />} />
          {/* 隱私權政策/服務條款——視覺語言對齊首頁(HomePage.tsx)的紙感和風
              風格,見 LegalPage.tsx。 */}
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          {/* /ai-plan:「AI 安排行程」模擬展示獨立公開頁,見
              home/plan-ai-sim/AIPlanTimelinePage.tsx 開頭的完整說明——
              固定接純前端假資料,不需要登入,跟其餘公開行銷頁同一層級。
              路由本身使用者明確要求改為 /ai-plan(先前是 /plan-ai,
              /plan-ai-sim 之後),純粹是對外呈現的路徑改名,元件所在
              目錄 home/plan-ai-sim/ 與檔案內部命名(PlanAiSimPage 等)
              維持不變,不做無謂的連動重新命名。改路徑時務必同步更新
              server/cmd/server/static.go 的 knownRoutePatterns——上次
              新增 /plan-ai 忘了同步這份白名單,導致正式環境該路徑直接
              404(即使前端路由本身定義正確),這是實際發生過的教訓。 */}
          <Route path="/ai-plan" element={<PlanAiSimPage />} />
          {/* /itineraries(清單)與 /itineraries/:id(詳細頁):精選行程
              展示(2026-10 頁面文案從「AI 排好的範例行程」改名,見上方
              AiItinerariesRoute import 處的完整說明),公開頁。2026-10
              使用者另外明確要求「路由不要加
              ai」,從原本的 /ai-itineraries 改名——當時是純粹對外呈現
              的路徑改名,元件所在目錄/檔案內部命名(AiItinerariesRoute
              等)維持不變,理由同上方 /ai-plan 的既有先例;後續使用者
              再要求「web/src/ai-itineraries 路徑簡化」,這次才真的把
              目錄本身也從 ai-itineraries/ 改名成 itineraries/(檔案內部
              命名 AiItinerariesRoute 等仍維持不變,只動目錄跟 import
              路徑)。
              使用者後續一度提過「路徑加上區域、地區、國家」(改成
              /itineraries/國家/地區/:id 三段式),但接著自己提出疑問
              「路由要分段嗎,還是直接用 slug」,評估後明確拍板「改成
              /itineraries/:id,不分段」——分段路由唯一的好處(可以做
              /itineraries/taiwan 這種國家分類頁)目前沒有需求,壞處是
              country/area 這兩段路由參數若不驗證跟 id 實際對應的 region
              一致,會出現「網址寫錯國家但仍正常顯示」這種沒有 SEO 唯一性
              保證的狀態,要做對需要後端額外驗證邏輯,複雜度不值得。這段
              維持原本的扁平路徑,沒有真的改過。
              server/cmd/server/static.go 的 knownRoutePatterns——上次
              新增 /plan-ai 忘了同步這份白名單,導致正式環境該路徑直接
              404(即使前端路由本身定義正確),這是實際發生過的教訓。 */}
          <Route path="/itineraries" element={<AiItinerariesRoute />} />
          <Route path="/itineraries/:id" element={<AiItinerariesRoute />} />
          {/* /u/:handle/:slug:部落客發文正式頁面(2026-10,見
              BlogArticlePage.tsx 開頭說明)——不再是固定讀單一 slug 的
              demo 路徑,改依網址路徑參數(作者 handle + 文章 slug)渲染
              對應文章。用 BlogArticleRoute(仿照下方 PublicTokenRoute
              的既有模式)取出 :handle/:slug 兩個路徑參數,轉交給
              BlogArticlePage。 */}
          <Route path="/u/:handle/:slug" element={<BlogArticleRoute />} />
          {/* /blog/photos:部落客上傳圖片管理頁(見 blog/PhotoManagerPage.tsx
              開頭的完整說明)——需登入,比照 /trip-plan(TripPlanRoute)的
              既有模式:訪客可到達這個網址,頁面內自己用 useAppState() 判斷
              isGuest 並內嵌登入表單,不是擋下或導轉。這個專案沒有
              <RequireAuth> 這類包裝元件的先例,沿用這個既有做法。務必記得
              同步 server/cmd/server/static.go 的 knownRoutePatterns(見
              /ai-plan 路由註解提過的教訓)——2026-10 補上這份同步(先前
              一度遺漏,留在後續處理)。 */}
          <Route path="/blog/photos" element={<PhotoManagerPage />} />
          {/* /dev/layouts:開發用版型目錄頁(2026-10 新增,見
              blog/LayoutGalleryPage.tsx 開頭的完整說明)——陳列
              BlogArticle.css 支援的所有版型,骨架圖+範例文字,不依賴任何
              真實照片或後端資料。純開發工具,不加進任何站內導覽連結,
              只能直接輸入網址訪問。 */}
          <Route path="/dev/layouts" element={<LayoutGalleryPage />} />
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
          {/* /trip-plan 路徑:登入後的 AI 規劃,獨立頁面(原 /app/plan-ai)。
              外殼自己管深色模式與捲動、訪客時內嵌登入表單,見
              trip-plan/TripPlanRoute.tsx。server/cmd/server/static.go 的
              knownRoutePatterns 已同步新增。 */}
          <Route path="/trip-plan" element={<TripPlanRoute />} />
          {/* 舊網址 /app/plan-ai 已搬到 /trip-plan:轉址保留書籤與外部連結。
              React Router 依特異度排序,靜態路徑本來就優先於下方
              /app/:legacyPanelMode 這個相容路由,放在它前面只是明確表達意圖。 */}
          <Route path="/app/plan-ai" element={<Navigate to="/trip-plan" replace />} />
          {/* /app/blog、/app/blog/:slug:2026-10 新增,使用者明確要求「部落格
              頁面給獨立路由」——跟上面 346 行註解提到的「/app/:panelMode?
              已整段移除,side panel 展開狀態不反映在網址上」這個刻意決定
              有意的例外:只對 blog/blog-editor 這兩個 panelMode 重新引入
              網址驅動,其餘 panelMode(trips/timeline/pace/geo-outline 等)
              維持純 useState、不綁路由。
              元素內容跟下面 /app 完全相同(同樣渲染 PhoneContent,寬螢幕
              會切到桌面版 DesktopContent)——實際的「網址 ↔ panelMode」
              同步邏輯在 DesktopLayout.tsx DesktopContent 內部用
              useLocation()/useNavigate() 處理,不是在這裡用路徑參數
              改變渲染內容,理由是 ContentProps 介面被 PhoneContent 的
              每個呼叫端共用,不想為了這兩個 panelMode 額外擴充整條 props
              傳遞鏈——DesktopContent 本身已經在 BrowserRouter context 內,
              可以直接呼叫 router hook,不需要外部傳參數。
              放在 /app 本身前面,是因為 React Router 比對靜態片段優先於
              下方 /app/:legacyPanelMode 這個單層相容萬用路由,但明確放在
              前面表達意圖,不依賴排序規則本身。 */}
          <Route
            path="/app/blog"
            element={
              <KeyboardShrinkGuard className={`${styles.webApp} app-theme-root`} dataTheme={props.theme ?? undefined}>
                <PhoneContent {...props} />
              </KeyboardShrinkGuard>
            }
          />
          <Route
            path="/app/blog/:slug"
            element={
              <KeyboardShrinkGuard className={`${styles.webApp} app-theme-root`} dataTheme={props.theme ?? undefined}>
                <PhoneContent {...props} />
              </KeyboardShrinkGuard>
            }
          />
          {/* /app 路徑:主要應用畫面本體(套 iPhone 外框,寬螢幕自動切桌面版佈局)。
              2026-10:原本這裡是 /app/:panelMode? 選填路徑參數,桌面版 side
              panel 展開哪個面板(旅程列表/規劃/時間軸/路徑/AI 規劃)由網址
              驅動,讓重新整理/瀏覽器上一頁下一頁/分享連結都能還原到對應
              面板。使用者明確要求「展開側欄不需要變更路由」——改回純本地
              UI state(見 DesktopLayout.tsx 的 panelMode state 完整說明),
              側欄展開狀態不再反映在網址上,這條路徑參數不再需要,整段移除
              只保留 /app 本身。這是刻意的行為取捨:重新整理、分享
              /app/timeline 這類連結、瀏覽器上一頁下一頁,現在都不再能還原
              展開中的面板(一律收合),使用者已確認接受這個後果。
              額外疊加全域 class app-theme-root(見 base-ui.css 深色模式 token
              區塊)——.webApp 是 CSS Modules 雜湊 class,base-ui.css 這種全域
              樣式表無法直接選取它,需要這個穩定的全域 class 名稱當掛載點。
              data-theme 屬性值來自 useAppState() 的 theme(登入後 App 的深色/
              淺色偏好,見 theme.ts),null 時不掛屬性交給 CSS 的
              prefers-color-scheme media query 處理「跟隨系統」。 */}
          <Route
            path="/app"
            element={
              <KeyboardShrinkGuard className={`${styles.webApp} app-theme-root`} dataTheme={props.theme ?? undefined}>
                <PhoneContent {...props} />
              </KeyboardShrinkGuard>
            }
          />
          {/* 2026-10 code review 抓到:/app/:panelMode? 這條路徑參數整段
              移除後,先前分享/加入書籤的舊深連結(/app/trips、
              /app/geo-outline、/app/timeline、/app/pace、/app/plan-ai)
              不會再落在 /app 收合,而是直接命中下方的 catch-all,顯示
              NotFoundPage——跟上面註解宣稱的「一律收合」不符,比收合更
              嚴重(是真正的 404,不是看得懂的收合畫面)。
              這裡補回一條只接受單層路徑片段的相容路由,忽略
              panelMode 參數本身(不會把它傳給 PhoneContent,
              DesktopLayout.tsx 的 panelMode state 初始值固定是
              null/收合),純粹讓這批舊網址繼續落在跟 /app 本身一樣的
              畫面,不再是 404。元素內容跟上面 /app 那條路由完全相同。 */}
          <Route
            path="/app/:legacyPanelMode"
            element={
              <KeyboardShrinkGuard className={`${styles.webApp} app-theme-root`} dataTheme={props.theme ?? undefined}>
                <PhoneContent {...props} />
              </KeyboardShrinkGuard>
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

// BlogArticleRoute:仿照上方 PublicTokenRoute 的既有模式——用 useParams()
// 取出 /u/:handle/:slug 兩個路徑參數轉交給 BlogArticlePage。獨立成這個
// 小元件同樣是因為 useParams() 是 hook,必須在 Route 的 element 底下
// (Router context 內)呼叫。useParams() 的型別允許 handle/slug 回傳
// undefined(即使路由命中時理論上一定有值),用 ?? '' 處理這個型別上的
// 邊界情況,寫法對齊 PublicTokenRoute 的既有慣例。
function BlogArticleRoute() {
  const { handle, slug } = useParams<{ handle: string; slug: string }>()
  return <BlogArticlePage handle={handle ?? ''} slug={slug ?? ''} />
}
