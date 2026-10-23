import { CTA_AFTER_STOPS, usePlanSimSocket } from './usePlanSimSocket'
import { useSimulatedStopsView } from './useSimulatedStopsView'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ROUTE_LINE_ENABLED, TIME_DRAG_ENABLED } from '../../DesktopShared'
import { useThemeToggle } from '../../hooks/useThemeToggle'
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from '../SiteNavButtons'
import { trackEvent } from '../../analytics'
import { planAiFakeDataSource } from './planAiFakeDataSource'
import { getPlanAiPublicDataSource } from './planAiPublicDataSource'
import { getPlanAiApiDataSource } from './planAiApiDataSource'
import { BASE_URL } from '../../AppCommon'
import { PlanMap } from './PlanMap'
import { maskPlanStopsView, usePlanStopsState } from '../../plan-core/usePlanStopsState'
import { useGuestClientConfig } from '../../plan-core/clientConfig'
import { useCurrentLocation } from './useCurrentLocation'
import { createPlanSimFakeSource } from './planSimFakeSource'
import { PlanTimelineView } from '../../plan-core/PlanTimelineView'
import { Composer } from '../../components/Composer'
import { LivePlanLayer } from './LivePlanLayer'
import { PlanLayout } from './PlanLayout'
import { HorizontalPlanTimeline } from './HorizontalPlanTimeline'
import { ScriptedAskPage } from './ScriptedAskPage'
import { useIsDesktop } from '../../hooks/useIsDesktop'
import { useIsWide } from '../../hooks/useIsWide'
import { Lightbox } from '../../geo-planning/PhotoCarousel'
import type { AskPageCandidate } from '../../plan-core/askPageTools'
import { useAskPageBridge } from '../../plan-core/useAskPageBridge'
// planTimeline.ts——共用的時間軸領域層(純函式,不碰 UI 或任何後端
// 呼叫),直接 import plan-core/ 那份跟正式頁 trip-plan/TripPlanPage.tsx
// 共用,不維護 home/plan-ai-sim/ 底下重複的一份。這個目錄原本有一份幾乎
// 一模一樣的副本(唯一差異是死碼清理時拿掉的一個已確認恆為 no-op 的
// 判斷式,兩份行為完全等價),是從 plan-ai-sim 分支原封不動搬過來時一併
// 帶進來的重複檔案。
import { getTimeDragBounds } from '../../plan-core/planTimeline'
import type { MapHandle } from '../../geo-planning/NativeMapBase'
// SafeAreaDebugOverlay——地圖安全區的除錯疊圖(開發工具,用
// ?debugSafeArea=1 開啟,見該檔案檔頭的完整說明)。
//
// 用 lazy 動態載入而不是靜態 import:DEBUG_SAFE_AREA 是執行期才知道的
// 值(讀 URL 參數),Vite 無法靜態判斷這段永遠用不到、搖不掉,靜態
// import 會讓這個純開發工具跟著進正式打包結果。改成 lazy 之後它自成
// 一個 chunk,沒帶那個 URL 參數的訪客完全不會下載。
const SafeAreaDebugOverlay = lazy(() =>
  import('./SafeAreaDebugOverlay').then((m) => ({ default: m.SafeAreaDebugOverlay })),
)
// WideLayoutDebugOverlay——wide 模式(見 PlanOverlayPanel 的 wide 分支與
// planOverlayGeometry.ts)側欄/composer 插槽的除錯疊圖,共用同一個 ?debugSafeArea=1 開關,
// 見該檔案檔頭的完整說明:標示的是不同的幾何,跟上面的
// SafeAreaDebugOverlay 互補、不是取代關係。同樣 lazy 載入,理由相同。
const WideLayoutDebugOverlay = lazy(() =>
  import('./WideLayoutDebugOverlay').then((m) => ({ default: m.WideLayoutDebugOverlay })),
)
import { useMapSafeArea } from '../../geo-planning/useMapSafeArea'
import { useDesktopStopPan, usePhoneStopPan, useStopCardClick } from '../../plan-core/useStopPan'
import { useFirstStopAutoPan } from '../../plan-core/useFirstStopAutoPan'
import styles from './Content.module.css'
import { SIMPLE_MAP_ID } from '../../geo-planning/mapStyleIds'

// CENTER/ZOOM——地圖初始中心與縮放層級,數值沿用原本 StaticMapBackdrop.tsx
// 同名常數(對準「赤崁・府城」這個主題點所在的老城區,範圍涵蓋展示腳本
// planSimScript.ts 全部 14 個站點,詳細取捨理由見該檔案保留下來的完整
// 說明——StaticMapBackdrop.tsx 本身已不再是這個頁面的地圖來源,但常數
// 選值的理由仍然適用,故原樣沿用數字而非重新調整構圖)。
const CENTER = { lat: 22.9975, lng: 120.1900 }
const ZOOM = 14

// 地圖安全區除錯疊圖——開發工具,用 ?debugSafeArea=1 開啟(見
// SafeAreaDebugOverlay.tsx 檔頭的完整說明)。改成讀 URL 參數而不是
// 改程式碼的常數:不用動原始碼就能隨時開,也不會因為忘了改回 false
// 而誤上 production。
//
// 開啟時會一併停掉模擬播放(見下方 usePlanSimSocket 的呼叫)——驗證
// 中心點計算時畫面上不該有東西在動。
const DEBUG_SAFE_AREA =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debugSafeArea')
// DEBUG_TARGET——赤崁樓(劇本第一站的座標)。選它是因為它在初始地圖
// 中心(CENTER)的右上方,水平與垂直都有偏移,兩個軸的計算都能驗證到
// ——選一個剛好在中心正上方或正左方的點,會讓其中一軸的 delta 恆為 0,
// 那一軸算錯也看不出來。
const DEBUG_TARGET = { lat: 23.0009, lng: 120.2024 }

// plan-ai-sim/Content — 「AI 安排行程」時間軸展示原型的正式頁面版本。
// 原型先在 Artifact(Design Component 畫布)做過一輪,經 Fable 設計方案
// (版面/時間軸視覺/逐步生成節奏/配色皆出自該輪討論)驗證整體概念後,
// 這裡重寫成 TypeScript + CSS Module,整合進 tripace 專案。
//
// 資料流(2026-09 重構,取代原本純前端 setTimeout 排時序的版本):後端
// server/internal/api/plan_sim_ws.go 的 GET /public/plan-sim/ws 模擬
// 「AI 安排行程」推論過程逐步推播 action 訊息(新增景點/交通/注記/
// 刪除某一步),前端(見下方 usePlanSimSocket/planActionToInsert)收到後
// 直接 dispatch 更新 steps 這個 state 陣列,畫面即時反應——這是使用者
// 明確要求的「結構化前端結構,讓上面的元素可以被新增跟刪除,並反應在
// 畫面上」「提供接口讓 agent 傳進來的訊息可以異動結構資料」的具體實作:
// steps state + planActionToInsert/insertAttractionAfter 就是這個
// 「接口」,只要來源送對格式的 action 訊息(不論是這支模擬 WS、之後
// 真正接上的 LLM 推論,或甚至是手動測試時透過 devtools console 呼叫
// dispatch),都能驅動同一套畫面更新邏輯,不需要為不同來源另外寫一份
// 渲染程式碼。
//
// add_stop 訊息若帶 placeId(見 PlanAction 型別的完整說明),代表「AI
// 呼叫了查地點工具」——插入後 insertAttractionAfter 內部用這個 id 呼叫
// fetchPlanAiPlaceDetailsAny(GET /internal/geo/plan-ai/place-details-any)取得
// 真正的地點名稱/簡介/照片,這是「把 place_id 串到前端、前端用 id 呼叫
// 端點顯示景點」這個需求的具體落地,不是後端直接把完整資料內嵌進訊息裡。
//
// 播放態(handedOver 為 false)是純模擬展示(見下方「模擬」相關說明),
// 不接真實 AI/LLM;使用者按下「讓我試看看」交接(handedOver 為 true)後,
// 改渲染 LivePlanLayer(複用 /app 的 TripPlanPage,連真實 AI,見該檔檔頭)。
// 路由 /ai-plan(見 App.tsx),獨立於 /app 底下的正式導覽系統之外(不走
// desktop/Content.tsx、phone/Content.tsx 那套 panelMode 機制)。日後若要把
// 播放態換成真實來源,只需要把 usePlanSimSocket 換成真正的 agent 推論 WS
// 來源(訊息格式維持一致),不需要動 planActionToInsert 或下方渲染邏輯。
//
// 視覺語言採用登入後正式 App 的 --ios-* token(base-ui.css),不是
// home/ 底下城市介紹頁那套 --paper/--ink 紙感和風——這個頁面示範的是
// 產品核心功能,不是行銷頁,視覺應該跟真正做出來的樣子一致。
//
// 2026-09:日夜間模式的切換機制改用 home/ 城市介紹頁那套純前端
// useThemeToggle(不寫 localStorage,重新整理會重置),取代原本的
// getTheme()(theme.ts,登入後 App 的深色模式偏好)——使用者明確要求
// 「上方功能列採用跟首頁一樣的漂浮按鈕,要有功能介紹跟登入日夜間切換
// 按鈕」,首頁/城市頁的按鈕(SiteNavThemeToggle)是即時可點擊切換的,
// getTheme() 只是讀一次 localStorage 靜態值、沒有對應的 setter,無法
// 支援這種互動。--ios-* token 系統本身不受影響,一樣掛 app-theme-root
// + data-theme 屬性,只是這個屬性值現在來自可即時切換的 state,不是
// 讀一次就固定的值。

// PlanStep — 對外沿用的節點型別名稱(渲染邏輯/其餘函式仍稱呼它
// PlanStep,對齊既有命名),實際上就是 planTimeline.ts 的 PlanNode——
// 底層儲存已經改成 PlanTimeline(鏈結串列,見該檔案開頭的完整背景
// 說明),不再是普通陣列。這裡只是型別別名,不重新宣告欄位。
// ASK_PAGE_CONFIRM_DELAY_MS——最後一張候選被「點」完之後,再停多久才演出
// 按下「確認選擇」(見 ScriptedAskPage.tsx confirmAfterMs 的完整說明)。
//
// 2026-10(使用者明確要求「點完後大幅減少停頓」):原本這個常數叫
// ASK_PAGE_AUTO_PICK_MS、值 2800ms,語意是「選單在畫面上停留多久」
// ——那是還沒有點擊演出時的設計,當時整段詢問就只有「開著讓人看」
// 這件事,需要一段長停留才讀得完。
//
// 加上點擊演出之後,「讓人看清候選」這件事已經由那 2 次點擊
// (2 × PICK_INTERVAL_MS = 1040ms,期間還有勾選與特效逐張出現)承擔了,
// 這個常數剩下的意義只是「點完到按確認之間的一拍」。維持 2800ms 會變成
// 點完之後畫面完全不動將近 3 秒,看起來像播放卡住。
//
// 600ms 的取法:比單次點擊的間隔(520ms)略長一點,讓「點完了」跟「按下
// 確認」讀得出是兩個獨立動作,而不是連在一起的一下;又遠短於單則劇本
// 動作的 randomDelayMs(900~1500ms),因為這一拍只是同一步內的收尾。
const ASK_PAGE_CONFIRM_DELAY_MS = 600

// isEmbedded——網址帶 ?embedded=1 時,代表這頁被當成 iframe 嵌進其他頁面:
// 不渲染頂部漂浮導覽(fixed 定位的一排按鈕會跟外框的動態島疊在一起)並
// 隱藏捲軸把手。預設行為(無參數)完全不變。
// 2026-10:功能介紹頁的手機小展示已改用 AiPlanPhoneDemoScreen 直接渲染
// (見 home/AiPlanPhoneDemo.tsx),不再 iframe 這一頁,目前沒有呼叫端
// 使用這個參數;保留作為日後需要把本頁整頁嵌進其他版面時的入口。
function isEmbedded(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('embedded') === '1'
}

// shouldSkipDemo——2026-10 新增(使用者明確要求「網址加入一個參數,進去
// 的已略過播放態」):網址帶 ?skipDemo=1 時,掛載後直接呼叫 handover()
// (見該函式的完整說明)跳過整段劇本播放,一進頁面就是推論態——適合
// 需要反覆測試推論行為(例如本次 search_attraction/open_ask_page 相關
// 的實機驗證)的情境,不用每次都等劇本播完、點「不用了」跳過開場候選
// 卡片才能進到推論態。寫法比照 isEmbedded 的既有慣例,不是另外發明
// 一套參數解析方式。
function shouldSkipDemo(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('skipDemo') === '1'
}

// 推論態的站點檢視實例是 plan-core/usePlanStopsState(與登入後手機、桌面同一個 hook);模擬態是 ./useSimulatedStopsView.ts。

export function Content() {
  const embedded = isEmbedded()
  const { theme, dark, toggleTheme } = useThemeToggle()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const followingRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const [showJumpPill, setShowJumpPill] = useState(false)

  // typedPrompt——輸入框的假打字動畫,展示「使用者輸入這句話,AI 據此
  // 安排行程」的敘事開場,呼應下方自動播放的劇本(planSimScript.ts 第
  // 一則就是赤崁樓開場)。輸入框本身是唯讀展示(見下方 JSX 的完整說明),
  // 不是真的等使用者打字,純粹用逐字附加模擬打字節奏。掛載時執行一次,
  // 不需要清理殘留計時器以外的邏輯(這個頁面不會重新播放)。
  //
  // promptTyped——打完最後一個字那一刻視同「使用者送出」,使用者明確
  // 要求「輸入文字送出後,才觸發開始安排」:傳給 usePlanSimSocket 當
  // start 參數,打字動畫播完前劇本不會開始播放,兩件事不再同時發生。
  // 宣告在 usePlanSimSocket 呼叫之前——後者的 start 參數直接讀這個值。
  const [typedPrompt, setTypedPrompt] = useState('')
  const [promptTyped, setPromptTyped] = useState(false)
  useEffect(() => {
    const fullText = '幫我排台南兩天一夜的行程'
    let i = 0
    const timer = setInterval(() => {
      i += 1
      setTypedPrompt(fullText.slice(0, i))
      if (i >= fullText.length) {
        clearInterval(timer)
        setPromptTyped(true)
      }
    }, 90)
    return () => clearInterval(timer)
  }, [])

  // showAskPage/askPageInput/openAskPage/handleAskPageDone——2026-10
  // 新增(使用者明確要求「播放畫面第一個先模擬送出一個 ask」)。狀態機
  // 本身抽成共用 hook useAskPageBridge(見該檔案開頭的完整設計理由),
  // 跟 TripPlanPage.tsx 的同名機制共用同一份實作,差異只在 Input 泛型:
  // 這裡的劇本固定只給 { candidates }(劇本內容是寫死的,不適合依賴
  // 即時地圖中心/使用者位置的探查模式),不像 TripPlanPage.tsx 還支援
  // { explore }。openAskPage 會被傳給 createPlanSimFakeSource(見該
  // 函式的完整說明)當建立參數,劇本播到 open_ask_page 這則時會直接
  // 呼叫它、await 它——跟真實 AgentBridge 呼叫 open_ask_page 工具
  // handle 的形狀完全對應,這個元件(劇本的消費端)不需要額外做任何事。
  //
  // 宣告位置在 usePlanSimSocket 呼叫之前(而不是跟其餘大多數 state
  // 一起宣告在後面)——下方 createSource 的 useCallback 需要在呼叫
  // usePlanSimSocket 當下就拿到 openAskPage,JavaScript 變數必須先
  // 宣告才能在同一個函式作用域的後續程式碼裡使用,順序不能顛倒。
  const { showAskPage, askPageInput, openAskPage, handleAskPageDone } = useAskPageBridge<{
    candidates: AskPageCandidate[]
    // picks——劇本指定這一步哪幾個候選顯示成已選取(見 PlanAction.picks
    // 的完整說明)。播放態用它讓 AskPage 走腳本模式,不等真人點選。
    picks?: string[]
  }>({ candidates: [] })
  // isDesktop——決定兩件事:
  //   1. 模擬層的手機版要不要換成橫向卡片時間軸(HorizontalPlanTimeline,
  //      見該元件檔頭的完整說明);桌面版繼續渲染 PlanTimelineView。
  //   2. 劇本播到 open_ask_page 時要不要等使用者選擇(見下方
  //      createPlanSimSource 的完整說明)。
  // 宣告位置提前到這裡(原本在 mapHandle 附近)——createPlanSimSource
  // 要用到它,JavaScript 變數必須先宣告才能在後續程式碼裡使用。
  const isDesktop = useIsDesktop()
  // isWide——是否達到 PlanLayout wide 模式的斷點(1024px,見
  // useIsWide 的完整說明)。獨立於 isDesktop 的判斷,只決定要不要把
  // wide prop 傳給 PlanLayout,不影響上面 isDesktop 原本的兩個
  // 既有用途。
  const isWide = useIsWide()

  // createPlanSimSource——用 useCallback 包一層穩定參照:
  // usePlanSimSocket 的 createSource 參數若每次 render 都是新函式,
  // 底下的 effect(建立來源的那個)會每次 render 都重新執行,意外地
  // 重播整段劇本。
  //
  // openAskPage 兩種版面都傳(2026-10 使用者明確要求「桌面版的要顯示
  // ask page」):劇本第一則就是 open_ask_page,planSimFakeSource 會
  // await 它才繼續播下一則。
  //
  // 曾經一度改成「桌面版不傳,直接跳過等待」——那是因為 AskPage 原本
  // 只渲染在手機版的 HorizontalPlanTimeline 裡,桌面版渲染
  // PlanTimelineView、沒有這個元件,整段劇本停在第 0 步(實機確認過:
  // 桌面版時間軸全空、一張卡片都沒有)。跳過等待雖然解開了卡死,
  // 但桌面使用者也就永遠看不到候選選單。改成桌面分支也渲染 AskPage
  // (見下方 JSX),兩種版面都看得到。
  //
  // 2026-10(使用者明確定調「播放態不會有真實互動」):先前這裡的
  // openAskPage 交給 source 之後,那個 Promise 只有使用者真的在 AskPage
  // 上點選、觸發 handleAskPageDone 才會 resolve——等於整段劇本的推進被
  // 綁在一次真人互動上,跟「預設進入會全部播放」這個既有定調矛盾
  // (見 planSimFakeSource.ts 檔頭)。也正是桌面卡死那個 bug 的根因:
  // 沒人可以點,就永遠播不下去。
  //
  // 現在改由 AskPage 的腳本模式負責(見 AskPage.tsx AskPageProps.scripted
  // 的完整說明):劇本帶 picks 指定哪幾個候選顯示成已選取,AskPage 不渲染
  // 按鈕列、演出按下確認後自己送出,Promise 照常 resolve、
  // 劇本繼續。這一層只要把 openAskPage 原樣交出去就好,不需要再包一層
  // 計時器——「不等真人」這件事屬於那個面板怎麼渲染,不屬於這裡怎麼
  // 橋接 Promise。
  const createPlanSimSource = useCallback(() => createPlanSimFakeSource(openAskPage), [openAskPage])

  // renderScriptedAskPage——置換用的詢問頁(見 ScriptedAskPage.tsx 檔頭
  // 的完整說明),同時給桌面與手機兩個分支用。
  //
  // 必須用 useCallback 包,而且依賴要精確到「劇本這一步的實際內容」:
  // HorizontalPlanTimeline 收到的是一個會被它直接呼叫的函式,每次父元件
  // render 若都傳一個新函式進去,它回傳的 element 每次都是新的,React
  // 對應不到同一個元件實例,於是每次 render 都把 ScriptedAskPage 整個
  // 重新掛載。
  //
  // 實機踩過(用 DevTools 追 960ms、57 個取樣確認):劇本播放期間父元件
  // 每則訊息都會 render,內嵌的箭頭函式讓詢問頁被反覆重掛,
  // getAnimations() 回報 5 個同名動畫、currentTime 全程停在 0——點擊
  // 特效每一格都在重新開始,所以完全看不到動畫,卡片只是突然變成已勾選。
  //
  // 依賴列 candidates/picks 而不是整個 askPageInput:後者是 bridge 的
  // state,open_ask_page 之外的 render 也可能換掉它的參照。
  const askPageCandidates = askPageInput.candidates
  const askPagePicks = askPageInput.picks
  // askPageDataSource——2026-10 使用者明確要求「播放態用固定的 attraction
  // id,但是資料跟圖片與推論態用一樣的方式取得」:詢問頁候選卡片的名稱與
  // 照片不再查假資料池(那邊只有 REAL_PHOTOS 登記過的 id 才有圖,其餘卡片
  // 上半部空白),改走跟推論態(訪客)同一條 createPlanAiPublicDataSource
  // → /public/geo/plan-ai/place-details-any,由後端依 placeId 回資料庫
  // 既有景點的真名稱與照片。劇本裡的候選 placeId 是固定的(見
  // planSimScript.ts open_ask_page 的完整說明),所以畫面內容穩定,不會
  // 因為查詢而變動。只有詢問頁這一處換;時間軸站點的背景反查仍是假資料
  // (planAiFakeDataSource),那是劇本逐站排出來的另一條路徑。
  // 用公開端點而不是依登入狀態切換:播放態本來就是給未登入訪客看的展示,
  // 公開端點登入後也能用,不需要分兩套。查詢失敗時 ScriptedAskPage 會降級
  // 成劇本自己帶的名稱、沒有照片(見它的 catch),不會整頁壞掉。
  const askPageDataSource = getPlanAiPublicDataSource(BASE_URL)
  const renderScriptedAskPage = useCallback(
    () => (
      <ScriptedAskPage
        dataSource={askPageDataSource}
        candidates={askPageCandidates}
        picks={askPagePicks ?? []}
        confirmAfterMs={ASK_PAGE_CONFIRM_DELAY_MS}
        onDone={handleAskPageDone}
        // stacked——寬螢幕(>=1024px)側欄改用縱向堆疊的候選卡片列表,
        // 取代橫向捲動(見 ScriptedAskPage.tsx stacked prop 的完整說明,
        // 2026-10 使用者明確要求)。這個 callback 同時服務手機版
        // (horizontalTimeline 分支)與桌面版(isDesktop 分支)兩處呼叫,
        // isWide 在手機版恆為 false,不會影響手機版既有的橫向捲動。
        stacked={isWide}
      />
    ),
    [askPageCandidates, askPagePicks, askPageDataSource, handleAskPageDone, isWide],
  )

  // 這個頁面固定「打字動畫播完才開始安排」(見上方 promptTyped 的完整
  // 說明),不再需要 simEnabled 開關——原始版本這裡還有
  // usePlanAiChatBridge(接真實 onagent 對話)與對應的 getStepsForBridge/
  // addNoteToTimeline 橋接函式,使用者明確要求這個頁面的輸入框改為
  // 純展示、不接受真的輸入,整條 onagent 對話路徑已一併移除。
  // DEBUG_SAFE_AREA 開啟時傳 false,不建立來源、不播放——驗證中心點
  // 計算時畫面上不該有東西在動(見該常數的完整說明)。沒帶那個 URL
  // 參數時這個判斷恆為 false,播放行為跟平常完全一樣。
  // handedOver——是否已交接給推論態(單向,見 handover)。宣告在 usePlanSimSocket 之前:交接後要讓模擬停止播放
  // (下方傳給它的 start 帶 !handedOver),否則劇本計時器繼續對已清空的時間軸插入站點與備註(code review 發現)。
  const [handedOver, setHandedOver] = useState(false)
  const { steps, isGenerating, timelineRef, dragStopTime, clearTimeline, latestInsertedStopIdRef, retryStopLookup } = usePlanSimSocket(
    DEBUG_SAFE_AREA ? false : promptTyped && !handedOver,
    createPlanSimSource,
  )
  const stopCount = steps.filter((s) => s.type === 'stop').length

  // expandedThemeId——2026-10 改成由 useMapMarkerLayer 內部 reducer 自己
  // 判斷(見下方該 hook 呼叫處的完整說明),不再是這裡自己宣告的獨立
  // state、也不再需要另外讀 timelineRef.current.nodes 算一次——原本
  // 「選中的站點若帶 children 就展開」這個判斷邏輯已經收斂進
  // mapMarkerLayer/planStops.ts 的 applySelection,這裡只需要把 children
  // 資訊帶進 points 陣列(見下方 useSharedDrawLayer 與 geo-planning/mapMarkerLayer/planStops.ts)。

  // 兩個站點檢視實例,交接時整個換掉(使用者明確要求「先不要管模擬,模擬就用自己的實例,統一推論態跟登入後」):
  //   simulated  模擬態:播放劇本時的站點與選取,全部由 useSimulatedStopsView 自己持有,不與其他實例共用任何狀態
  //   live       推論態:usePlanStopsState,與登入後手機、桌面是同一個 hook——站點、選取、hover、轉乘配對與
  //              TripPlanPage 的四個回報回呼(tripPlanProps)一次持有
  // 兩個 hook 都無條件呼叫(React hooks 規則:呼叫次數與順序不能依條件變動)。handedOver 決定現在用哪一個實例,
  // 不再另外存一份來源快照(舊的 planSource state 要靠兩個 effect 在 stops 變動時同步,漏同步就是「真實推論沒有
  // 地圖點」那次 bug 的根源;現在是衍生值,沒有同步問題)。
  const simulated = useSimulatedStopsView(steps, latestInsertedStopIdRef)
  const live = usePlanStopsState()
  const view = handedOver ? live : simulated

  // handover——「交接」:清掉模擬的時間軸,改用推論態的實例(live)。選取不需要另外清空——live 是全新的實例
  // (初值 null),模擬態的選取整個被換掉。
  //
  // 2026-10 改動(使用者明確要求「按鈕按下去不能進入 app,是要替換掉時間軸層」):原本這顆按鈕是 navigate('/app')
  // 跳到正式功能頁,現在留在同一頁替換內容——模擬的時間軸清空,換成讓使用者自己描述需求的介面。理由是連續性:使用者
  // 剛看完一段「AI 自動排行程」的展示,當下最想做的是「換我試試看」,跳轉到另一個頁面(還可能撞上登入牆)會把那個
  // 當下打斷。
  //
  // 單向、不可逆——交接後沒有「回到模擬」的路徑(見 LivePlanLayer.tsx 檔頭 TODO 第 3 點:模擬的腳本播放是一次性的,
  // 重播需要另外設計)。
  const handover = useCallback(() => {
    clearTimeline()
    setHandedOver(true)
  }, [clearTimeline])

  // skipDemo——見 shouldSkipDemo 的完整說明:網址帶 ?skipDemo=1 時,
  // 掛載後立即呼叫 handover() 跳過劇本播放。用 ref 記錄「已經觸發過」
  // 而非只靠依賴陣列,是因為 handover 本身的參照會隨 clearTimeline
  // 改變而重新產生(見上方 useCallback 依賴陣列)——若直接把
  // handover 放進 effect 依賴陣列,每次 handover 參照變動都會讓這個
  // effect 重新執行,對已經交接過的頁面重複呼叫 handover()(雖然
  // handover 本身冪等、不會造成實際問題,但語意上這個 effect 应该只在
  // 「掛載時」判斷一次,不該隨 handover 參照變動反覆觸發)。
  const skipDemoTriggeredRef = useRef(false)
  useEffect(() => {
    if (skipDemoTriggeredRef.current) return
    if (!shouldSkipDemo()) return
    skipDemoTriggeredRef.current = true
    handover()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // mapHandle——NativeMapBase 建圖完成後回報上來的控制代碼,見該元件
  // onHandleChange 的完整說明。usePlanStopMarkers 需要 mapRef/mapReady
  // 才能把站點 marker 掛到這個地圖實例上。
  const [mapHandle, setMapHandle] = useState<MapHandle>({ mapRef: { current: null }, mapReady: false, mapVersion: 0 })
  const handleMapHandleChange = useCallback((handle: MapHandle) => {
    setMapHandle(handle)
  }, [])

  // mapSafeArea——2026-10 新增(使用者構想:「底下是地圖層,上方是一層
  // UI 層,UI 層把各個元素都配置好,像地圖主顯示區就配出一個區塊,只是
  // 不用顯示,那自然就可以得知主顯示區的範圍」,見 useMapSafeArea.ts/
  // home/plan-ai-sim/Content.module.css .mapSafeArea 的完整說明)。取代原本
  // 「手算 timelineHeight / 2 再呼叫 panBy」的土法地圖視覺中心偏移
  // ——那套作法要自己推導 panBy 的方向語意、踩過一次方向寫反的實機
  // bug,且只能做「初始置中校正」這一件事,沒辦法判斷之後每次移動到
  // 特定地點時目標是否落在安全範圍內。
  //
  // panToWithinSafeArea 取代所有原本直接呼叫 mapHandle.mapRef.current.
  // panTo(target) 的地方(見下方 panToStopId/panToStop/
  // hasAutoPannedToFirstStopRef 的完整說明):目標點在 UI 層配置的
  // 安全區塊範圍內就用 panTo(維持平滑移動、zoom 不變的既有體驗),超出
  // 範圍才改用 fitBounds 確保目標點移動後真的落在可視範圍內(使用者
  // 明確要求「如果移動範圍在可視區就用 panTo,以外則用 fitBounds」)。
  const mapSafeArea = useMapSafeArea(mapHandle.mapRef)

  // selectedStopId/setSelectedStopId——讀寫目前使用中的實例(view):交接前是模擬態自己的,交接後是推論態的
  // (與登入後同一個 hook),呼叫端(下方 usePlanStopMarkers 呼叫處、JSX 裡 panToStop 等)不需要知道差異。
  //
  // 2026-10 移除右上角小地圖功能前,這個狀態同時也驅動小地圖 panTo+
  // 放大(見 panToStop),拿掉地圖後這裡純粹只剩「點了哪張卡片」的視覺
  // 回饋,不影響其餘行為。2026-10 地圖換成真實互動地圖(NativeMapBase)
  // 後,這個狀態重新驅動地圖圓點強調(見下方 usePlanStopMarkers 呼叫
  // 處),回到原本「選取會連動地圖」的語意,只是不做 pan/放大
  // (panToStop 維持不變,只設定這個狀態)。
  const { selectedStopId, hoverStopId, setSelectedStopId, setHoverStopId } = view

  // 地圖上的圖層由地圖元件 PlanMap 掛(與登入後的 PlanMap 同一個層級,見 PlanMap.tsx 的說明):
  // 統一繪製層(行程站點圓點含主題點展開、目前位置藍點、轉乘虛線、整條路線)與光暈。這頁只持有狀態、
  // 傳 prop:站點的選取與 hover 由這頁的狀態持有(完全受控),點圓點經 onStopClick 寫回同一個
  // selectedStopId;座標由推論態才取得的定位而來(已授權才有,推論態以外為 null,藍點不畫)。選取時
  // 不自動平移:這頁的平移由安全區機制負責(見下方 panToStop),不要同時啟用兩套。轉乘虛線的
  // hoverTransitPair 來自推論態(live.hoverTransitPair,模擬態不會回報),整條路線由 ROUTE_LINE_ENABLED 控制(下方 PlanMap 的 showPlanRouteLine)。
  const { currentPosition } = useCurrentLocation({ wanted: handedOver })
  // visibleStopsView:傳給地圖的站點檢視,與登入後手機、桌面同一個規則——不該畫的時候傳空檢視(空陣列,圖層自己會清掉
  // marker;選取、hover、轉乘配對一起遮蔽),見 maskPlanStopsView。這頁的規劃面板不收起,站點隨時都該顯示,所以
  // 可見條件恆為 true;條件留在呼叫處,日後這頁有會蓋住地圖或收起面板的狀態時,只改這個值。
  const stopsVisible = true
  const visibleStopsView = maskPlanStopsView(
    { stops: view.stops, selectedStopId, hoverStopId, hoverTransitPair: live.hoverTransitPair },
    stopsVisible,
  )
  // expandedThemeId:PlanMap 回報目前展開的主題點(選中有 children 的站點),平移判斷會用。
  const [expandedThemeId, setExpandedThemeId] = useState<string | null>(null)

  // 推論態才有的地圖圖層(2026-10,使用者明確要求把登入後地圖的「景點區域光暈」
  // 「目前位置藍點」加進 /ai-plan)。播放態是首頁展示用的劇本,不查資料、不碰定位,
  // 所以兩者都只在 handedOver 為 true 時啟用。各自的邏輯在 mapLayers/ 下,這裡只接線。
  //
  // layerCfg:兩個圖層查資料用的設定。token 從 localStorage 讀(與
  // LivePlanLayer 共用 useGuestClientConfig);讀不到就當訪客(圖層內部會改走免登入端點)。
  const layerCfg = useGuestClientConfig()
  // attractionDataSource:光暈查附近景點區域用的資料存取層實例(2026-10,使用者明確要求「光暈查詢共用,
  // 端點應該是有不同的資料存取層實例」)。有 token 用登入版(打 /internal)、沒有用訪客版(打免登入的
  // /public);挑哪一個是這一層的事,PlanMap 與光暈 hook 都不看登入狀態。
  const attractionDataSource = layerCfg.token ? getPlanAiApiDataSource(layerCfg) : getPlanAiPublicDataSource(layerCfg.baseURL)
  // 目前位置藍點:只在瀏覽器已授權定位時靜默取得,不主動跳出授權提示
  // (見 useCurrentLocation.ts 檔頭)。要讓新訪客也能看到藍點,需要另外加
  // 一顆定位按鈕呼叫它回傳的 request(),這是待決定的產品項目,先不做。

  // expandedThemeNode——expandedThemeId 目前指向的完整時間軸節點,下方
  // panTo effect 查詢子景點座標時仍會用到(見該 effect 的完整說明)。
  const expandedThemeNode = expandedThemeId != null ? timelineRef.current.nodes.get(expandedThemeId) : undefined

  // 站點平移兩件事分開(都在 plan-core):
  //   首站自動平移 useFirstStopAutoPan  只有手機(桌面的鏡頭統一只由點選圖卡移動);平移用 mapSafeArea.panToWithinSafeArea(依安全區算中心)
  //   卡片「移動到此」 usePhoneStopPan   只分手機與桌面;這頁只有手機有(桌面側欄沒有這顆按鈕),產生的 panToStopId 注入 LivePlanLayer
  // 首站自動平移:模擬態與推論態各一個實例,各自一次性(latch 不跨實例,交接後推論態的第一站仍會平移,與登入後一致)。
  // 桌面點選圖卡(useDesktopStopPan)任何狀態都平移(模擬態、推論態、wide 與非 wide);非 wide 的疊加版面(768–1023px)
  // 沒有安全區節點,panToWithinSafeArea 退回直接 panTo。手機的「移動到此」仍只在模擬態啟用(推論態的選取不搶鏡頭)。
  const firstStopPanAllowed = !isDesktop
  const mapPanReady = mapHandle.mapReady && !!mapHandle.mapRef.current
  useFirstStopAutoPan({
    stops: simulated.stops,
    enabled: !handedOver && firstStopPanAllowed,
    ready: mapPanReady,
    pan: mapSafeArea.panToWithinSafeArea,
  })
  useFirstStopAutoPan({
    stops: live.stops,
    enabled: handedOver && firstStopPanAllowed,
    ready: mapPanReady,
    pan: mapSafeArea.panToWithinSafeArea,
  })
  const { panToStop: panToStopId } = usePhoneStopPan({
    mapRef: mapHandle.mapRef,
    mapReady: mapHandle.mapReady,
    stops: view.stops,
    expandedChildren: expandedThemeNode?.children,
    enabled: !isDesktop && !handedOver,
    panToWithinSafeArea: mapSafeArea.panToWithinSafeArea,
  })

  // composerCollapsed——排程結束後,漂浮輸入膠囊(.composer)裡原本的
  // 箭頭送出鈕(.sendBtn)切換成「讓我試看看」行動呼籲按鈕(.composerCta)。
  // 使用者原本要求「排程結束後,輸入匡做一個動畫轉場……縮成一顆
  // 按鈕」,試做後改要求「保留膠囊輸入外框,送出按鈕部分轉變為立即
  // 使用按鈕」——膠囊外框本身固定維持完整寬度,不再整體收縮,只有
  // .inputRow 裡送出鈕這個位置的按鈕內容改變(同一個 DOM 位置,見下方
  // JSX 依 composerCollapsed 切換渲染哪一顆按鈕)。
  //
  // 觸發時機是 isGenerating 從 true 翻成 false(劇本收到 done)那一刻,
  // 用 wasGeneratingRef 記住上一次的值來辨識這個「下降邊」——isGenerating
  // 初始值就是 false(打字動畫還沒播完、劇本尚未開始),不能單看「目前
  // 是 false」就切換,否則一進頁面就已經顯示「讓我試看看」。這個頁面固定
  // 只播放一次、不能重播,所以這個切換只會發生一次。
  //
  // 2026-10 改成「排到第 CTA_AFTER_STOPS 站就切換」,不再等整段劇本播完
  // (使用者明確要求「播放到第 5 個景點就加入按鈕」)——整段腳本有 14
  // 站、跑完要好幾十秒,而使用者通常看個幾站就知道這個功能在做什麼,
  // 把行動呼籲壓在最後等於讓最有意願的那批人也得枯等。第 5 站時已經
  // 排出完整的上午行程,足夠展示「AI 真的會連續安排」。
  //
  // 原本的「isGenerating 下降邊」條件保留當後備:腳本日後若改短到不足
  // 5 站,播完仍然會顯示按鈕,不會變成永遠不出現。
  //
  // 只進不退(setComposerCollapsed(true) 重複寫入同值不觸發重渲染):
  // 切換之後後續站點繼續插入時,按鈕不該閃回箭頭送出鈕。
  // userPrompt——交接之後使用者自己打的內容。跟 typedPrompt(假打字
  // 動畫的進度)是兩個獨立的 state:後者是展示用的、唯讀,前者才是
  // 真的使用者輸入。
  const [userPrompt, setUserPrompt] = useState('')

  const [composerCollapsed, setComposerCollapsed] = useState(false)
  const wasGeneratingRef = useRef(false)
  useEffect(() => {
    if (stopCount >= CTA_AFTER_STOPS) setComposerCollapsed(true)
    else if (wasGeneratingRef.current && !isGenerating) setComposerCollapsed(true)
    wasGeneratingRef.current = isGenerating
  }, [isGenerating, stopCount])

  // mountedIdsRef——追蹤「已經播過進場動畫的節點 id」,用來正確判斷
  // 下方渲染迴圈裡的 justMounted。原本 justMounted 是用
  // `idx === steps.length - 1`(是不是陣列最後一個元素)判斷,這在
  // steps 只會 append 到尾端時沒問題,但「插入到中間」的節點(見
  // PlanAction.afterId/planActionToInsert 的完整說明——例如測試按鈕
  // insert_anping_mazu 插在 note-1 之後,不是陣列最後一個)永遠不會是
  // 最後一個元素,導致完全沒有進場動畫(cardSlide/thumbPop/pillExpand/
  // anchorPop/noteFade 全部沒套上),這是實際發生過的 bug——使用者要求
  // 「子代理處理插入時,要跟新增有一樣的動畫效果」。改成用這個 ref 記錄
  // 每個 id 是否已經出現過:第一次出現時判定為 justMounted(不論它在
  // 陣列中的位置是不是最後一個),渲染完當下就把 id 記進 ref,之後即使
  // steps 陣列因為其他節點增減而重新渲染,這個 id 也不會被誤判為又一次
  // 新掛載。用 ref 而非 state,是因為這個記錄本身不需要觸發重渲染——它
  // 只是渲染過程中順手更新的旁路狀態(理由同其餘 xxxRef 用法)。
  const mountedIdsRef = useRef<Set<string>>(new Set())

  // 這個頁面固定進頁就自動播放一次固定劇本到底,不需要測試按鈕手動
  // 觸發移除/插入額外訊息(原始版本的 removeWumiao/insertAnpingMazu 與
  // 對應 UI 已一併移除,見 usePlanSimSocket 的完整說明)。

  // lightboxPhotos——比照正式頁 TripPlanPage.tsx 的多圖瀏覽機制(見
  // PlanTimelineView.tsx 的完整說明),改用該共用元件後這個 state 一併
  // 需要。模擬腳本(planSimFakeSource.ts)目前沒有任何節點帶
  // googlePhotoUrls,縮圖實際上不會出現多圖按鈕、onOpenPhotos 也就不會
  // 被觸發,但 PlanTimelineView 的 props 介面要求提供這個 callback,故
  // 仍需要這個 state 讓介面完整,不是只為了展示頁去改共用元件的介面。
  const [lightboxPhotos, setLightboxPhotos] = useState<{ photos: string[]; alt: string } | null>(null)

  const { panToStop: panDesktopToStop } = useDesktopStopPan({
    enabled: isDesktop,
    pan: mapSafeArea.panToWithinSafeArea,
  })
  const panToStop = useStopCardClick({ select: setSelectedStopId, pan: panDesktopToStop })

  // scrollToLatest — 直接捲到最底。.scroll 底部已留 128px 給漂浮膠囊,
  // 捲到底時最新的節點/呼吸點會停在膠囊上方,不會卡在視窗邊緣。原本
  // 「目標節點頂端距視窗底 160px」的算法,在捲到底時比真正的底部高約
  // 140px,使用者捲到底會被拉回去。等兩幀再捲,確保剛掛載的節點已經
  // 完成排版、scrollHeight 已更新。
  const scrollToLatest = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scroller = scrollRef.current
        if (!scroller) return
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
      })
    })
  }, [])

  // 在 steps 改變、或 isGenerating 改變時都要重新跟隨——不把跟隨狀態
  // (followingRef)放進依賴,否則使用者手動捲到底、跟隨狀態從 false
  // 翻成 true 的那一刻,這個 effect 也會被觸發去捲動。
  //
  // 2026-10 補上 isGenerating 依賴(使用者截圖回報「讓我試看看」按鈕
  // 展開那一刻,composer 直接疊在時間軸中段內容上,不是停在底部)——
  // 根因:固定劇本播完觸發的「done」事件只翻轉 isGenerating(true→
  // false),不一定伴隨新的 steps 更新;而 isGenerating 翻 false 的
  // 瞬間,PlanTimelineView 會整段拿掉呼吸點+骨架卡(見該元件
  // isThinking 的渲染邏輯),讓 .timelineScroll 的內容高度瞬間變矮。
  // 這個 effect 原本只監聽 steps,沒有偵測到這次「內容變矮但沒有新
  // 節點」的變化,畫面因此停在生成途中最後一次捲動的位置,沒有跟著
  // 內容收斂重新捲到底——composer 本身固定貼在 .page 底部 20px(見
  // .composer 的完整說明),內容沒捲到底時,它就疊在當下停留位置的
  // 中段內容上。正式頁 TripPlanPage.tsx 的 planAiChat.isThinking 由
  // 真實 onagent 對話驅動,isThinking 翻 false 的時機點通常剛好伴隨
  // 一次 steps 更新(例如最後一句 agent 訊息寫入時間軸),兩者同時
  // 發生掩蓋了這個問題,但邏輯上同樣的風險存在,一併補上這個依賴。
  useEffect(() => {
    if (!followingRef.current) return
    if (steps.length === 0) return
    scrollToLatest()
  }, [steps, isGenerating, scrollToLatest])

  // 只有「使用者往上捲、且離底部超過 80px」才退出跟隨。程式觸發的平滑
  // 捲動(往下)與新節點撐高內容(scrollTop 不變)都不會讓它誤判成離開。
  const handleScroll = useCallback(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const { scrollTop, scrollHeight, clientHeight } = scroller
    const distFromBottom = scrollHeight - scrollTop - clientHeight
    const scrolledUp = scrollTop < lastScrollTopRef.current
    lastScrollTopRef.current = scrollTop
    let nowFollowing = followingRef.current
    if (distFromBottom < 80) nowFollowing = true
    else if (scrolledUp) nowFollowing = false
    if (nowFollowing === followingRef.current) return
    followingRef.current = nowFollowing
    setShowJumpPill(!nowFollowing && isGenerating)
  }, [isGenerating])

  const jumpToLatest = useCallback(() => {
    followingRef.current = true
    setShowJumpPill(false)
    scrollToLatest()
  }, [scrollToLatest])

  // emptyStateMessage——2026-09:漂浮膠囊(.composer,見該 class 的完整
  // 說明)只留 input 本身,不再常駐顯示一行狀態提示文字。原本「生成中/
  // 已安排 N 站/想去哪裡玩」三種文案裡,只有「時間軸完全空白」這一句
  // 使用者明確要求改放進主顯示區(.scroll/.inner)當空狀態引導文字。
  // 2026-10:使用者進一步要求「移除還沒開始對話的空畫面」,改用
  // PlanTimelineView 的 hideEmptyState prop 整段隱藏這塊區域(見該
  // prop 的完整說明)——PlanTimelineViewProps.emptyStateMessage 目前
  // 仍是必填 string(共用元件型別未變,/app 正式頁仍然需要這個文案),
  // 傳一個空字串滿足型別即可,反正 hideEmptyState 為 true 時這段文字
  // 根本不會被渲染,不需要保留原本那句引導文案的字串常數。
  const emptyStateMessage = ''

  // app-theme-root:base-ui.css 的深色模式規則掛在這個全域 class 上
  // (.app-theme-root:not([data-theme="light"]) 搭配
  // prefers-color-scheme、.app-theme-root[data-theme="dark"]),見
  // App.tsx 的 /app 路由同樣疊加這個 class。少了它,無論系統偏好或
  // data-theme 屬性值是什麼,這個頁面都只會顯示淺色 token。
  // navButtons——上方漂浮按鈕列插槽內容(見原本「上方漂浮按鈕」的完整
  // 說明,邏輯不變,只是現在當成 PlanLayout 的 nav 插槽傳入,而不是
  // 直接寫在這個元件的根容器 JSX 裡)。SiteNavBrand 等元件本身是 fixed
  // 定位,放進哪個 DOM 位置不影響視覺,純粹是程式碼組織上收進插槽。
  // 2026-10 使用者明確要求「展示頁面不要功能介紹按鈕」——移除原本的
  // 「功能介紹」CTA(連到 /product),只留登入。
  // pageLabel 只在播放態顯示(2026-10,使用者明確要求「ai-plan 進入推論態後
  // 不要顯示左上角台南兩日遊」):「台南兩日遊」是播放態劇本的主題名稱,
  // 交接後(handedOver)使用者排的是自己的行程,繼續掛著劇本的標題會誤導。
  const navButtons = (
    <>
    <SiteNavBrand pageLabel={handedOver ? undefined : '台南兩日遊'} />
    <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
    <SiteNavCta href="/app" onClick={() => trackEvent('landing_cta_click', { page: 'plan-ai-sim', position: 'nav' })}>登入</SiteNavCta>
    </>
  )

  // mapBackground——地圖背景插槽內容(見原本「NativeMapBase」區塊的
  // 完整說明,邏輯不變)。
  const mapBackground = (
    <>
      <PlanMap
        center={CENTER}
        zoom={ZOOM}
        mapId={SIMPLE_MAP_ID}
        theme={theme}
        {...visibleStopsView}
        // 整條路線:四個入口共用 ROUTE_LINE_ENABLED 控制(見 DesktopShared.tsx);這頁沒有切換入口,flag 開啟就畫。
        showPlanRouteLine={ROUTE_LINE_ENABLED}
        onStopClick={setSelectedStopId}
        currentPosition={currentPosition}
        liveLayersEnabled={handedOver}
        attractionDataSource={attractionDataSource}
        onExpandedThemeIdChange={setExpandedThemeId}
        onHandleChange={handleMapHandleChange}
      />
      {DEBUG_SAFE_AREA && (
        <Suspense fallback={null}>
          <SafeAreaDebugOverlay
            target={DEBUG_TARGET}
            safeAreaElRef={mapSafeArea.safeAreaElRef}
            mapRef={mapHandle.mapRef}
            mapReady={mapHandle.mapReady}
            onPan={mapSafeArea.panToWithinSafeArea}
            resetView={{ center: CENTER, zoom: ZOOM }}
          />
        </Suspense>
      )}
    </>
  )

  // wideDebugOverlay——跟 mapBackground 分開組裝,不塞進那個插槽裡:
  // 見 PlanLayout.tsx debugOverlay prop 的完整說明——mapBackground
  // 最終被包進 .mapLayer(z-index: 0),composer 插槽是 z-index: 20,
  // 兩者是 .page 的手足,子層級的 z-index 再高也蓋不過父層級已經輸掉的
  // 比較結果,標示 composer 範圍的疊圖必須跟 composer 插槽同層級。
  // 只在 wide 模式下才有側欄/composer 插槽可標示,isDesktop 的桌面疊加
  // 版面(PlanOverlayPanel)跟手機版都不渲染這個疊圖。
  const wideDebugOverlay = DEBUG_SAFE_AREA && isWide ? (
    <Suspense fallback={null}>
      <WideLayoutDebugOverlay />
    </Suspense>
  ) : undefined

  return (
    <>
    {/* PlanLayout——版面骨架(根容器+地圖背景+上方 nav+既有的
        PlanOverlayPanel),見該元件開頭的完整設計理由。時間軸層的二選一
        (模擬 vs 真實 AI,見下方 handedOver 判斷的完整說明)決定要傳哪組
        passThrough/composer/children,layout 本身不關心這個決策。 */}
    {handedOver ? (
      <PlanLayout
        embedded={embedded}
        theme={theme}
        mapBackground={mapBackground}
        nav={navButtons}
        wide={isWide}
        debugOverlay={wideDebugOverlay}
        isDesktop={isDesktop}
        safeAreaRef={mapSafeArea.safeAreaElRef}
        passThrough
      >
        <LivePlanLayer selectedStopId={selectedStopId} tripPlanProps={live.tripPlanProps} onPanToStop={isDesktop ? panDesktopToStop : undefined} />
      </PlanLayout>
    ) : (
      <PlanLayout
        embedded={embedded}
        theme={theme}
        mapBackground={mapBackground}
        nav={navButtons}
        wide={isWide}
        debugOverlay={wideDebugOverlay}
        isDesktop={isDesktop}
        safeAreaRef={mapSafeArea.safeAreaElRef}
        composer={(
          // Composer——共用輸入膠囊外框(components/Composer.tsx,見該檔頭
          // 的完整背景說明)。這個展示頁的特有邏輯(假打字動畫唯讀、
          // composerCollapsed 後整個切換成「讓我試看看」CTA)留在這裡
          // 透過 props 組裝,共用元件不知道這些概念。
          //
          // presentational——2026-10 使用者明確要求:「composer 應該用
          // 一個展示態來表達,而不是單純關閉送出,展示態的時候送出樣式
          // 要正常,但是不能點送出」(見 Composer.tsx 該 prop 的完整
          // 說明)。這個展示頁從「打字動畫進行中」到「排完一站都還沒到
          // 第 5 站」整段期間,送出鈕全程都是這個狀態——輸入框是純展示
          // 用的假打字動畫(見 typedPrompt 的完整說明),不接受真的輸入、
          // 不會真的送出任何請求,但視覺上應該完全像一個「正常、能用」
          // 的輸入框,不該讓訪客一眼看出「這是灰掉的假東西」。取代先前
          // 「預設 disabled 淡化,打字中那一刻另外疊加 sendBtnActive
          // 抵銷淡化樣式」的拼湊寫法——那個寫法只覆蓋了「打字中」這一
          // 個特例,排完第一站後到第 5 站之前這段期間其實仍然是淡化的,
          // 跟「送出鈕全程該是正常樣式」的真正意圖不符,改用
          // presentational 後不再需要特例判斷,整段期間自然一致。
          //
          // 2026-10(第三輪):「讓我試看看」出現時(composerCollapsed 且
          // 尚未 handedOver)輸入框整個從 DOM 移除、按鈕置中顯示(使用者
          // 明確要求「按鈕置中,移除輸入匡」)——取代先前「輸入框收合
          // 讓位、按鈕展開動畫」的版本(見 .module.css .composerCta 的
          // 完整說明:那一版同一顆 <button> 疊加 class 做 width
          // transition,這版輸入框是條件渲染、不是 class 切換,沒有連續
          // 的寬度狀態可以 transition,改用 opacity 淡入)。交接後
          // (handedOver)輸入框恢復渲染、開放輸入,不再是 presentational
          // ——這時是正式功能,真的要能送出。(現況:這個 Composer 只渲染在
          // 播放態的 PlanLayout;交接後的輸入框改由 LivePlanLayer 內的
          // TripPlanPage 經 ComposerSlotContext portal 進 composer 插槽,
          // 這裡的 handedOver 分支只是殘留。)
          <Composer
            bare={composerCollapsed && !handedOver}
            hideInput={composerCollapsed && !handedOver}
            inputRowClassName={styles.inputRow}
            ariaLabel={handedOver ? '描述你想要的行程' : '輸入指令(僅供展示)'}
            placeholder={handedOver ? '想去哪裡玩?例如:台南兩天一夜' : undefined}
            value={handedOver ? userPrompt : typedPrompt}
            onChange={handedOver ? setUserPrompt : undefined}
            readOnly={!handedOver}
            presentational={!handedOver && !composerCollapsed}
            // composerCta——排程結束後出現的行動呼籲按鈕,文案「讓我試
            // 看看」(2026-10 從「立即使用」改,使用者明確要求),點擊要
            // 導向登入頁面(/app,對齊首頁 SiteNavCta 的「登入」按鈕同樣
            // 指向 /app——未登入時 /app 本身就會顯示登入畫面,見
            // phone/Content.tsx 的既有行為,不需要另外一個獨立的 /login
            // 路由)。仍是同一顆送出鈕(進行中是箭頭 icon,結束後疊上
            // .composerCta 變成文字按鈕)——這顆按鈕本身的身分沒有變,
            // 只有旁邊的輸入框從「收合」改成「整個移除」(見上方完整
            // 說明)。排到第 5 站前透過 presentational 擋下 onSubmit,
            // 不需要額外判斷 composerCollapsed 才能呼叫 navigate——
            // onSubmit 只有在不是 presentational 時才會真的被呼叫。
            onSubmit={handover}
            sendButtonAriaLabel={composerCollapsed ? '讓我試看看' : '送出'}
            sendButtonClassName={composerCollapsed ? styles.composerCta : ''}
            sendButton={composerCollapsed ? '讓我試看看' : undefined}
          />
        )}
      >
      {isDesktop ? (
      /* 桌面版的詢問頁(2026-10 使用者明確要求「桌面版的要顯示 ask
         page」):劇本播到 open_ask_page 時取代縱向時間軸,跟手機版
         「顯示 AskPage 時取代卡片列」是同一種處理(見
         HorizontalPlanTimeline.tsx showAskPage 分支)。
         在這之前桌面版完全沒有渲染 AskPage,而劇本第一則就是
         open_ask_page——planSimFakeSource 等著使用者選擇,畫面上卻沒有
         任何可以點的東西,整段劇本停在第 0 步(實機確認:桌面版時間軸
         全空、一張卡片都沒有)。
         dataSource 用假資料實作,理由同下方手機版分支的完整說明。

         2026-10 改成置換 ScriptedAskPage(使用者明確定調「播放態不會有
         真實互動」、「所以是要做在被置換的原件上,與正式使用的不一樣」):
         這一頁是播放態,渲染的是播放態專用那一份(見 ScriptedAskPage.tsx
         檔頭的完整說明:劇本指定選哪幾張、依序演出點擊特效、時間到自己
         送出),不是正式的 AskPage。正式那一份完全沒有為了展示而加的
         分支,它只服務真實互動。
         兩者的 onDone 形狀一致,所以在這裡是直接互換,呼叫端其餘程式碼
         不需要知道換了哪一份。 */
      showAskPage ? (
      renderScriptedAskPage()
      ) : (
      <PlanTimelineView
        // onRetryStop——見上方 retryStopLookup 的完整說明:標了 failed
        // 就要給得出脫離的路。
        onRetryStop={retryStopLookup}
        steps={steps}
        isThinking={isGenerating}
        emptyStateMessage={emptyStateMessage}
        hideEmptyState
        endMarkerMessage="行程結束"
        selectedStopId={selectedStopId}
        // onHoverStop——卡片 hover/移出時更新 hoverStopId,讓地圖圓點能
        // 跟著 hover 強調(見上方 hoverStopId state 的完整說明)。
        onHoverStop={setHoverStopId}
        showJumpPill={showJumpPill}
        onJumpToLatest={jumpToLatest}
        onPanToStop={panToStop}
        // getStopTimeDragBounds/onDragStopTime——見 dragStopTime 的完整
        // 說明。這兩個 prop 同時存在才會啟用拖拉手勢(見
        // PlanTimelineView.tsx handlePointerDown 開頭的判斷)。
        // TIME_DRAG_ENABLED——feature flag(見 DesktopShared.tsx 同名
        // 常數的完整說明),關閉時兩個 prop 都不傳。
        getStopTimeDragBounds={TIME_DRAG_ENABLED ? (stopId) => getTimeDragBounds(timelineRef.current, stopId) : undefined}
        onDragStopTime={TIME_DRAG_ENABLED ? dragStopTime : undefined}
        onOpenPhotos={setLightboxPhotos}
        mountedIdsRef={mountedIdsRef}
        scrollRef={scrollRef}
        onScroll={handleScroll}
        scrollClassName={styles.timelineScroll}
        jumpPillWrapClassName={styles.timelineJumpPillWrap}
        endMarkerClassName={styles.timelineEndMarker}
      />
      )
      ) : (
      // 手機版(模擬中)——改用橫向卡片時間軸(方案二設計稿的落地,見
      // HorizontalPlanTimeline.tsx 檔頭的完整說明),取代縱向
      // PlanTimelineView。onSelectStop 同時寫入 selectedStopId 跟
      // hoverStopId(而不是只設 selectedStopId)——這兩個 state 一起餵給
      // 上方 useMapMarkerLayer(見該處呼叫的完整說明),地圖圓點的
      // 「選取」樣式實際上同時看這兩個值的其中之一命中(見 mapMarkers.ts/
      // PlanStopMarkerState 的既有邏輯),縱向版本原本是「點擊卡片→
      // selectedStopId」「hover 卡片→hoverStopId」各自觸發,手機版橫向
      // 卡片沒有滑鼠 hover 這件事,只有「捲到/點到哪一站」這一種事件。
      // mapMarkerLayer/mapMarkers.ts 的三態邏輯是 selected 優先於
      // hover(見 PlanStopMarkerState 的完整說明:兩者同時命中同一個 id
      // 時最終呈現 'selected'),只設 selectedStopId 其實已經足夠讓地圖
      // 圓點呈現「選取」高亮;這裡連同 hoverStopId 一併更新純粹是為了
      // 不留下舊的 hoverStopId 殘留(例如使用者先前在桌面寬度下 hover
      // 過某一站、之後縮小視窗切換成手機版橫向卡片,殘留的 hoverStopId
      // 理論上不該發生但避免有這種邊界情況殘留失準的圓點狀態)。
      // focusLatest(2026-10 修正,使用者實機回報「自動播放時第二個
      // 景點後沒有自動往下一個滑動」):這個 prop 名稱雖然原本是為了
      // 「第一張卡滿版、後面壓縮堆疊」這組視覺效果設計的,但那組卡片
      // 寬度縮放邏輯後來已經被取代(見 HorizontalPlanTimeline.tsx
      // isSingleCard 的完整說明:目前只有「只剩一張卡」這個寬度例外,
      // 其餘卡片一律固定寬度,焦點改用捲動位置表達,不是寬度差異)——
      // focusLatest 現在的唯一實際作用,只剩下開關「骨架轉正式卡時
      // 自動捲動到最新站點」這個自動捲動 effect(見該檔案
      // justFinishedGenerating 的完整說明),不會再帶來任何卡片縮放的
      // 副作用。原本這裡沒有傳這個 prop,套用元件預設值 false,整個
      // 自動捲動 effect 的第一行 `if (!focusLatest) return` 直接讓
      // 自動捲動在這個完整展示頁上完全不會啟動——不是只影響第二站
      // 以後,是從第一站就沒有自動捲動,只是使用者在只有一張卡時不易
      // 察覺,到第二站需要真正捲動才會注意到。改成跟首頁 demo
      // (AiPlanPhoneDemoScreen.tsx)一致,啟用自動捲動到最新完成站點。
      <>
      <HorizontalPlanTimeline
        // showAskPage/askPageInput/onAskPageDone/dataSource——見
        // 上方 state 宣告處的完整說明。dataSource 用假資料實作(預設值
        // planAiFakeDataSource,這裡顯式傳入對齊 usePlanSimSocket 呼叫處
        // 的同一份實例,理由同該處說明:這個展示頁不需要登入就能看,
        // 不能打需要登入的後端端點)。
        showAskPage={showAskPage}
        askPageInput={askPageInput}
        onAskPageDone={handleAskPageDone}
        dataSource={planAiFakeDataSource}
        // renderAskPage——置換成播放態專用那一份(見
        // HorizontalPlanTimeline.tsx 該 prop 與 ScriptedAskPage.tsx 檔頭
        // 的完整說明)。桌面分支也是同一份,兩種版面一致。
        renderAskPage={renderScriptedAskPage}
        onRetryStop={retryStopLookup}
        steps={steps}
        selectedStopId={selectedStopId}
        focusLatest
        onSelectStop={(stopId) => {
          setSelectedStopId(stopId)
          setHoverStopId(stopId)
        }}
        // onSelectThemeChild——2026-10 新增(見 HorizontalPlanTimeline.tsx
        // 該 prop 的完整說明)。只設定 selectedStopId(選中主題卡本身,
        // 連帶觸發 expandedThemeId 的 effect 展開範圍圓圈+子景點小點,見
        // 該 effect 的完整說明)。
        //
        // 2026-10(第二輪,使用者明確要求「手機板觸發地圖中心移動跟標示
        // 目標點都要用捲動中心點觸發,不要用點選觸發」):不再呼叫
        // setHoverStopId(child.id)——地圖 panTo 的 effect 已經改成只讀
        // selectedStopId(見該 effect 的完整說明),hoverStopId 不再驅動
        // 任何地圖行為,這裡設定它只會是沒有視覺效果的殘留狀態,拿掉。
        onSelectThemeChild={(parentId) => {
          setSelectedStopId(parentId)
        }}
        // onOpenPhotos——跟桌面版 PlanTimelineView 共用同一個 Lightbox
        // 覆蓋層(見上方 lightboxPhotos state 的完整說明),兩個時間軸
        // 元件都只負責「觸發開啟」,實際渲染/關閉邏輯統一收在這個頁面
        // 層級,不重複實作。
        onOpenPhotos={setLightboxPhotos}
        isGenerating={isGenerating}
        // onPanToStop——2026-10 新增(使用者明確要求「選擇圖卡時不要
        // 移動地圖中心,標誌地點就好,另外做一個 icon,移動到該點」):
        // 卡片角落新增的「移動到此」按鈕觸發,見 panToStopId 的完整
        // 說明。選填 prop,省略時卡片不會渲染這顆按鈕(對齊
        // onRemoveStop/onTransitModeChange 等既有選填 prop 的慣例)。
        onPanToStop={panToStopId}
      />
      </>
      )}
      </PlanLayout>
    )}
    {lightboxPhotos && (
      <Lightbox
        photos={lightboxPhotos.photos}
        alt={lightboxPhotos.alt}
        onClose={() => setLightboxPhotos(null)}
      />
    )}
    </>
  )
}
