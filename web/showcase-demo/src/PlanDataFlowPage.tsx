import { Link } from 'react-router-dom'
import styles from './PlanDataFlowPage.module.css'

// PlanDataFlowPage:行程資料(PlanTimeline)的分層架構圖。
//
// 這一頁不是產品構想的雛形,是把「資料存在哪、誰能改、不同輸入來源
// 各自接在哪一層」整理成一張可以看的圖——定位對齊
// ComponentConventionsPage(把已經做完的設計規範文件化,而不是只留在
// 程式碼註解裡)。
//
// 為什麼需要這一頁:這套分層散落在 plan-core/planTimeline.ts、
// planTimelineStorage.ts、plan-core/usePlanStopsState.ts 的 maskPlanStopsView / usePlanStopsState、
// planSimSource.ts 幾個檔案的註解裡,每一份註解都只講自己那一塊,
// 沒有一個地方能一眼看到全貌。新增輸入來源(例如再接一種推論層)或
// 新增資料操作時,最常問的問題就是「這該放哪一層」——這張圖就是答案。
//
// 圖用 inline SVG 手寫,不引函式庫:形狀固定、不需要互動,用
// currentColor 讓它跟著頁面主題走(見 .diagram 的 color 設定)。
//
// ⚠️ 這張圖要跟著架構一起維護(使用者明確要求「要隨時更新圖」)。
// 改到下列任何一項時,順手回來更新這一頁——一張過時的架構圖比沒有圖
// 更糟,因為它會讓人用錯誤的心智模型去放新程式碼:
//   - plan-core/planTimeline.ts 新增/移除匯出的資料操作函式
//   - 新增一種輸入來源(多一個 PlanSimSource 實作不算,那是同一種來源
//     的不同實作;接一個新的 agent 平台、或多一條後端推播路徑才算)
//   - commitTimeline 的寫入順序改變(目前:resync → compute → save →
//     成功才更新 state)
//   - PlanTimelineStore 的介面或實作數量改變
//   - UI 層或地圖層開始直接呼叫領域層函式(那代表分層被打破,圖要改)
//   - 站點檢視實例(plan-core/usePlanStopsState 與 home/plan-ai-sim/useSimulatedStopsView)
//     的成員增減,或選取(PlanSelection)改回由某一層共用持有(目前是每個實例
//     各持有自己的一份,交接時整個換掉,見頁面上「檢視狀態在哪一層」段落)
//   - PlanAiDataSource 的方法增減,或多一份實作(目前三份:純前端假資料、
//     訪客版 /public、登入版 /internal)
//   - 四個入口(/ai-plan 手機與桌面、登入後手機、登入後桌面)的接法改變
//     (見「四個入口的接法」表)

// LAYERS——領域層與狀態層。抽成陣列而不是在 JSX 裡寫死兩次,
// 讓盒子的 y 座標由索引算出來,調整間距時不用逐個改數字。
const LAYERS: { y: number; title: string; body: string; sub: string; accent?: boolean }[] = [
  {
    y: 352,
    title: '領域層  plan-core/planTimeline.ts　← 唯一能改資料的地方',
    body: 'createEmptyTimeline · insertAfter · removeNode · removeDay · updateNode · staleOtherAgentMessages',
    sub: '純函式:吃一份 timeline、回傳新的一份。不碰 React / DOM / 網路。PlanTimeline = { days, lodgings? },讀取用 listNodes 等唯讀函式',
    accent: true,
  },
  {
    y: 524,
    title: '狀態層  持有兩種狀態:行程資料 + 檢視狀態',
    body: 'useSyncedState → PlanTimeline(會持久化、AI 讀得到)　站點檢視實例 → stops / selectedStopId / hoverStopId(都不會)',
    sub: 'ref 同步讀:WebSocket onmessage 在 React 事件系統外,需要 commit 當下就拿到結果',
  },
]

export function PlanDataFlowPage() {
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link to="/" className={styles.back}>
          ← 回雛形列表
        </Link>
        <h1 className={styles.heading}>行程資料的分層架構</h1>
        <p className={styles.subheading}>
          <code className={styles.code}>PlanTimeline</code> 存在哪、誰能改、四種輸入來源各自接在哪一層。
          實際程式碼見 <code className={styles.code}>plan-core/planTimeline.ts</code>，
          這裡只整理「新增一種輸入來源或一個資料操作時，該放哪一層」。
        </p>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>全貌</h2>
          <p className={styles.lead}>
            三種輸入來源(①②③)最終都匯流到同一個領域層；④ 只在開頁時跑一次。
            持久化<strong>不是平行的一層</strong>，它住在 <code>{'commitTimeline'}</code> 包裝層裡，
            夾在「算出新資料」與「更新記憶體」之間。
            下半部是「站點檢視實例」：模擬態與推論態各是一個完整的實例（站點加自己的選取），
            交接時整個換掉，不是兩份在互相同步；登入後只有推論態那一種，與 /ai-plan 推論態是同一個 hook。
          </p>
          <figure className={styles.figure}>
            <svg
              className={styles.diagram}
              viewBox="0 0 880 760"
              role="img"
              aria-label="行程資料分層架構圖：輸入來源匯流到領域層，UI 層與地圖層各自從狀態層取得唯讀投影"
            >
              <defs>
                <marker id="pdfArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
                </marker>
              </defs>

              {/* ===== 輸入來源(四欄並排)===== */}
              <text x="8" y="18" fontSize="12" fontWeight="700" fill="currentColor">
                輸入來源
              </text>
              {[
                {
                  x: 8,
                  label: '① 模擬推論層',
                  lines: ['PlanSimSource 介面', 'fakeSource(計時器)', 'scrollSource(捲動)', '→ emit(PlanAction)'],
                },
                {
                  x: 228,
                  label: '② 真實 AI',
                  lines: ['onagent AgentBridge', 'attractionTools', 'search / add / remove', '→ 工具呼叫'],
                },
                {
                  x: 448,
                  label: '③ 使用者直接操作',
                  lines: ['時間軸 UI 的回呼', 'dragStopTime', 'onRemoveStop', '→ on* 事件'],
                },
                {
                  x: 668,
                  label: '④ 開頁初始化',
                  lines: ['store.loadTimelineWithRev()', '只在掛載時跑一次', '(寫入前的 resync 不是', '　來源,見下方包裝層)'],
                },
              ].map((src) => (
                <g key={src.label}>
                  <rect
                    x={src.x}
                    y="28"
                    width="204"
                    height="104"
                    rx="8"
                    fill="currentColor"
                    fillOpacity="0.04"
                    stroke="currentColor"
                    strokeOpacity="0.3"
                  />
                  <text x={src.x + 12} y="48" fontSize="12" fontWeight="700" fill="currentColor">
                    {src.label}
                  </text>
                  {src.lines.map((line, i) => (
                    <text
                      key={line}
                      x={src.x + 12}
                      y={66 + i * 16}
                      fontSize="11"
                      fill="currentColor"
                      fillOpacity="0.72"
                    >
                      {line}
                    </text>
                  ))}
                </g>
              ))}

              {/* 四條往下的匯流線 */}
              {[110, 330, 550, 770].map((x) => (
                <line
                  key={x}
                  x1={x}
                  y1="132"
                  x2={x}
                  y2="166"
                  stroke="currentColor"
                  strokeOpacity="0.45"
                  strokeWidth="1.5"
                />
              ))}
              {/* 橫向匯流匯總線 */}
              <line x1="110" y1="166" x2="770" y2="166" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" />

              {/* ===== 轉換層(各來源如何變成領域層呼叫)===== */}
              <rect
                x="8"
                y="192"
                width="864"
                height="92"
                rx="8"
                fill="currentColor"
                fillOpacity="0.04"
                stroke="currentColor"
                strokeOpacity="0.3"
              />
              <text x="20" y="212" fontSize="12" fontWeight="700" fill="currentColor">
                轉換:各來源的事件 → 領域層函式呼叫
              </text>
              <text x="20" y="232" fontSize="11" fill="currentColor" fillOpacity="0.72">
                ① usePlanSimSocket.onMessage　add_stop→insertAttractionAfter · remove_step→removeNode · reset→createEmptyTimeline · reset_day→removeDay
              </text>
              <text x="20" y="250" fontSize="11" fill="currentColor" fillOpacity="0.72">
                ② 工具 handler　add_attraction→insertAttractionAfter · add_note→insertAfter · remove_attraction→removeStep
              </text>
              <text x="20" y="268" fontSize="11" fill="currentColor" fillOpacity="0.72">
                ③ UI 回呼　dragStopTime→updateNode · onRemoveStop→removeNode　　④ 初始化　整份載入當作起始 state
              </text>

              <line
                x1="440"
                y1="284"
                x2="440"
                y2="344"
                stroke="currentColor"
                strokeOpacity="0.55"
                strokeWidth="1.5"
                markerEnd="url(#pdfArrow)"
              />

              {/* ===== 三個主要層(持久化 / 資料 / 狀態)===== */}
              {LAYERS.map((layer) => (
                <g key={layer.title}>
                  <rect
                    x="8"
                    y={layer.y}
                    width="864"
                    height="74"
                    rx="8"
                    fill="currentColor"
                    fillOpacity={layer.accent ? 0.1 : 0.04}
                    stroke="currentColor"
                    strokeOpacity={layer.accent ? 0.55 : 0.3}
                    strokeWidth={layer.accent ? 2 : 1}
                  />
                  <text x="20" y={layer.y + 22} fontSize="12" fontWeight="700" fill="currentColor">
                    {layer.title}
                  </text>
                  <text x="20" y={layer.y + 42} fontSize="11" fill="currentColor" fillOpacity="0.8">
                    {layer.body}
                  </text>
                  <text x="20" y={layer.y + 60} fontSize="10.5" fill="currentColor" fillOpacity="0.62">
                    {layer.sub}
                  </text>
                </g>
              ))}

              {/* 領域層 → commitTimeline 包裝層 */}
              <line x1="440" y1="426" x2="440" y2="438" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.5" />

              {/* commitTimeline 包裝層——持久化住在這裡,不是平行的一層。
                  順序是嚴格的:先追上磁碟 → 算 → 寫磁碟 → 成功才更新記憶體。 */}
              <rect
                x="8"
                y="438"
                width="864"
                height="74"
                rx="8"
                fill="currentColor"
                fillOpacity="0.04"
                stroke="currentColor"
                strokeOpacity="0.3"
                strokeDasharray="5 3"
              />
              <text x="20" y="458" fontSize="12" fontWeight="700" fill="currentColor">
                commitTimeline 包裝層　持久化在這裡,不是平行的一層
              </text>
              <text x="20" y="477" fontSize="11" fill="currentColor" fillOpacity="0.8">
                ① resyncFromStorage()　②
                <tspan fontWeight="700"> compute(current) </tspan>
                ③ store.saveTimeline(next, rev)　④ saved !== null 才更新 state
              </text>
              <text x="20" y="495" fontSize="10.5" fill="currentColor" fillOpacity="0.62">
                先寫磁碟成功、記憶體才更新——反過來會讓版次宣稱「我跟磁碟一致」而實際多了一筆,之後被其他分頁靜默抹掉
              </text>

              {/* 包裝層 → 狀態層 */}
              <line x1="440" y1="512" x2="440" y2="524" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.5" />

              {/* ===== 兩個消費端 ===== */}
              <line
                x1="232"
                y1="598"
                x2="232"
                y2="566"
                stroke="currentColor"
                strokeOpacity="0.55"
                strokeWidth="1.5"
                markerEnd="url(#pdfArrow)"
                transform="rotate(180 232 582)"
              />
              <line
                x1="648"
                y1="598"
                x2="648"
                y2="566"
                stroke="currentColor"
                strokeOpacity="0.55"
                strokeWidth="1.5"
                markerEnd="url(#pdfArrow)"
                transform="rotate(180 648 582)"
              />
              {/* ===== 站點檢視實例(兩種,交接時整個換掉)=====
                  左:模擬態 useSimulatedStopsView(站點從 timeline 投影,選取自己持有)。
                  右:推論態與登入後 usePlanStopsState(站點與轉乘配對由規劃面板回報,選取自己持有)。 */}
              <rect
                x="8"
                y="598"
                width="424"
                height="56"
                rx="8"
                fill="currentColor"
                fillOpacity="0.04"
                stroke="currentColor"
                strokeOpacity="0.3"
              />
              <text x="20" y="618" fontSize="11.5" fontWeight="700" fill="currentColor">
                站點檢視實例 ①　模擬態 useSimulatedStopsView(只有 /ai-plan 交接前)
              </text>
              <text x="20" y="636" fontSize="10.5" fill="currentColor" fillOpacity="0.68">
                stops 從 timeline 篩出有座標的 stop　＋　自己持有的 PlanSelection
              </text>

              <rect
                x="448"
                y="598"
                width="424"
                height="56"
                rx="8"
                fill="currentColor"
                fillOpacity="0.1"
                stroke="currentColor"
                strokeOpacity="0.55"
                strokeWidth="2"
              />
              <text x="460" y="618" fontSize="11.5" fontWeight="700" fill="currentColor">
                站點檢視實例 ②　usePlanStopsState(/ai-plan 推論態＋登入後手機、桌面)
              </text>
              <text x="460" y="636" fontSize="10.5" fill="currentColor" fillOpacity="0.68">
                stops · hoverTransitPair · tripPlanProps(規劃面板回報)＋自己持有的 PlanSelection
              </text>

              {/* 兩條往下的線 */}
              <line x1="220" y1="654" x2="220" y2="690" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.5" markerEnd="url(#pdfArrow)" />
              <line x1="660" y1="654" x2="660" y2="690" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.5" markerEnd="url(#pdfArrow)" />
              {/* 右邊那個實例也給 UI 層:selectedStopId 受控傳給規劃面板,雙向同步 */}
              <path
                d="M660 654 L660 672 L220 672"
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.35"
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />
              <text x="228" y="668" fontSize="9.5" fill="currentColor" fillOpacity="0.55">
                選取受控,面板與地圖雙向同步
              </text>

              {/* ===== 兩個消費端 ===== */}
              <rect
                x="8"
                y="690"
                width="424"
                height="56"
                rx="8"
                fill="currentColor"
                fillOpacity="0.04"
                stroke="currentColor"
                strokeOpacity="0.3"
              />
              <text x="20" y="710" fontSize="11.5" fill="currentColor">
                UI 層　HorizontalPlanTimeline · PlanTimelineView
              </text>
              <text x="20" y="728" fontSize="10.5" fill="currentColor" fillOpacity="0.68">
                讀 steps + selectedStopId　寫 onSelectStop → setSelectedStopId
              </text>

              <rect
                x="448"
                y="690"
                width="424"
                height="56"
                rx="8"
                fill="currentColor"
                fillOpacity="0.04"
                stroke="currentColor"
                strokeOpacity="0.3"
              />
              <text x="460" y="710" fontSize="11.5" fill="currentColor">
                地圖層　PlanMap → useSharedDrawLayer(統一繪製層)
              </text>
              <text x="460" y="728" fontSize="10.5" fill="currentColor" fillOpacity="0.68">
                讀 maskPlanStopsView(stops, selectedId…)　寫 onStopClick → 同一個 setter
              </text>

            </svg>
          </figure>
          <p className={styles.caption}>
            粗框的領域層是唯一能改 <code className={styles.code}>PlanTimeline</code> 的地方；
            粗框的 <code className={styles.code}>usePlanStopsState</code> 是 /ai-plan 推論態與登入後共用的同一個 hook。
            UI 層只 <code className={styles.code}>import type</code>，沒有 import 任何函式——分工靠這一點保證，不是靠約定。
            虛線框的包裝層只有正式頁面(<code className={styles.code}>TripPlanPage</code>，登入後與 /ai-plan 推論態都是它)有；
            <code className={styles.code}>/ai-plan</code> 的模擬層沒有 store，用裸的
            <code className={styles.code}>useSyncedState</code>，所以重新整理後是空的。
          </p>
          <p className={styles.caption}>
            <strong>為什麼叫「站點檢視實例」</strong>(2026-10 改名，取代原本的「投影層」與 <code className={styles.code}>PlanStopsView</code> 介面)：
            真正的推論(AI 決定排哪些站)發生在最上面的輸入來源。這一層持有的是地圖與時間軸要看的那組狀態：
            站點(<code className={styles.code}>stops</code>)加使用者在看哪一站(<code className={styles.code}>PlanSelection</code>)。
            模擬態的 <code className={styles.code}>stops</code> 是從 <code className={styles.code}>PlanTimeline</code> 單向投影出來的(只留有座標的 stop，
            丟掉備註、交通；主題點的子景點小點與旅館點由 <code className={styles.code}>useResolvedNodeRefs</code> 以識別碼執行時查回，查不到就沒有點)；推論態與登入後的 <code className={styles.code}>stops</code> 則由規劃面板(<code className={styles.code}>TripPlanPage</code>)
            經 <code className={styles.code}>tripPlanProps</code> 的四個回呼回報上來。兩種實例形狀相同，
            <code className={styles.code}>Content</code> 依 <code className={styles.code}>handedOver</code> 擇一使用。
          </p>
          <p className={styles.caption}>
            <strong>為什麼叫「領域層」不叫「資料層」</strong>(2026-10 改名)：
            它不持有資料，也不存取外部儲存——只定義「行程時間軸」這個領域的型別與規則。
            實際那一份 <code className={styles.code}>PlanTimeline</code> 活在狀態層的
            <code className={styles.code}>useSyncedState</code> 裡。
            叫「資料層」會跟 data access layer(DAO/repository)混淆，而那正好是這一層<strong>不做</strong>的事。
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>四種輸入來源的對接點</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>來源</th>
                <th>對接層</th>
                <th>形式</th>
                <th>可替換性</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>① 模擬推論</td>
                <td>狀態層 <code className={styles.code}>usePlanSimSocket</code></td>
                <td><code className={styles.code}>PlanAction</code> 串流</td>
                <td>
                  <strong>高</strong>——<code className={styles.code}>PlanSimSource</code> 只有
                  onMessage / onError / close 三個方法，換工廠函式即可。目前三個實作：<code className={styles.code}>planSimFakeSource</code>
                  (/ai-plan 播放態，計時器，支援「詢問頁暫停」)、<code className={styles.code}>demoSimSource</code>(/product 小展示，計時器)、
                  <code className={styles.code}>demoScrollSource</code>(首頁展示，捲動位置推進)。
                </td>
              </tr>
              <tr>
                <td>② 真實 AI</td>
                <td>狀態層 <code className={styles.code}>TripPlanPage</code></td>
                <td>onagent 工具呼叫</td>
                <td>
                  中——工具定義抽在 <code className={styles.code}>attractionTools.ts</code>，
                  但 <code className={styles.code}>AgentBridge</code> 直接在頁面裡建立、handler 是就地閉包，換推論平台要動到頁面。
                  <code className={styles.code}>TripPlanPage</code> 的 <code className={styles.code}>dataSource</code> 與 <code className={styles.code}>store</code> 現在是必填，
                  由各入口的 <code className={styles.code}>LivePlanLayer</code> 明確傳入。
                </td>
              </tr>
              <tr>
                <td>③ 使用者操作</td>
                <td>UI 層 → 狀態層</td>
                <td><code className={styles.code}>on*</code> 回呼</td>
                <td>不適用——本來就是 UI 事件，不是可抽換的資料來源。</td>
              </tr>
              <tr>
                <td>④ 開頁初始化</td>
                <td>狀態層掛載時</td>
                <td><code className={styles.code}>loadTimelineWithRev()</code></td>
                <td>
                  <strong>高</strong>——store 可互換。注意這跟「寫入前的 resync」不同：
                  後者是 <code className={styles.code}>commitTimeline</code> 內部的第一步，屬於寫入路徑，不是獨立來源。
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>讀取層：站點詳情與照片怎麼補上來</h2>
          <p className={styles.lead}>
            上面那張圖沒畫這條路徑——推論來源送出的 <code className={styles.code}>add_stop</code>
            只帶 <code className={styles.code}>placeId</code>，真實的名稱、座標、簡介、照片是
            <strong>插入之後非同步補上</strong>的。這一層跟推論層一樣可以整個抽換。
          </p>
          <figure className={styles.figure}>
            <svg
              className={styles.diagram}
              viewBox="0 0 880 300"
              role="img"
              aria-label="讀取層流程：插入佔位節點後，透過 PlanAiDataSource(假資料、訪客版、登入版三份實作)補上詳情與照片，再 updateNode 寫回"
            >
              <defs>
                <marker id="pdfArrow2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
                </marker>
              </defs>
              <rect x="8" y="8" width="864" height="52" rx="8" fill="currentColor" fillOpacity="0.04" stroke="currentColor" strokeOpacity="0.3" />
              <text x="20" y="30" fontSize="12" fontWeight="700" fill="currentColor">
                ① 插入佔位節點　insertAttractionAfter({'{ placeId, loading: true }'})
              </text>
              <text x="20" y="48" fontSize="10.5" fill="currentColor" fillOpacity="0.68">
                卡片立刻出現(骨架狀態),不等查詢回來——使用者馬上看到「這一站排進去了」
              </text>

              <line x1="440" y1="60" x2="440" y2="88" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.5" markerEnd="url(#pdfArrow2)" />

              <rect x="8" y="88" width="864" height="112" rx="8" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeOpacity="0.55" strokeWidth="2" />
              <text x="20" y="110" fontSize="12" fontWeight="700" fill="currentColor">
                ② 讀取層　PlanAiDataSource {'{ placeDetails, transitEstimate, photoAssets?, geoPlaceDetails?, nearbyAttractionAreas?, … }'}
              </text>
              <text x="20" y="130" fontSize="10.5" fill="currentColor" fillOpacity="0.8">
                planAiFakeDataSource　純前端,attractionPool.ts 的 10 筆台南景點。/ai-plan 播放態的時間軸用
              </text>
              <text x="20" y="148" fontSize="10.5" fill="currentColor" fillOpacity="0.8">
                createPlanAiPublicDataSource　打 /public/*,不需登入。/ai-plan 的詢問頁、推論態、首頁展示的光暈與詳情卡用
              </text>
              <text x="20" y="166" fontSize="10.5" fill="currentColor" fillOpacity="0.8">
                createPlanAiApiDataSource(cfg)　打 /internal/*,需登入。登入後手機與桌面用
              </text>
              <text x="20" y="188" fontSize="10.5" fill="currentColor" fillOpacity="0.62">
                訪客版與登入版共用 PlaceDetailsDedupe(進行中共用、成功短期記憶、失敗不記);元件與 hook 不自己挑端點,一律吃注入的實例
              </text>

              <line x1="440" y1="200" x2="440" y2="228" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.5" markerEnd="url(#pdfArrow2)" />

              <rect x="8" y="228" width="864" height="52" rx="8" fill="currentColor" fillOpacity="0.04" stroke="currentColor" strokeOpacity="0.3" />
              <text x="20" y="250" fontSize="12" fontWeight="700" fill="currentColor">
                ③ 寫回　updateNode(timeline, id, {'{ name, lat, lng, summary, photos, loading: false }'})
              </text>
              <text x="20" y="268" fontSize="10.5" fill="currentColor" fillOpacity="0.68">
                回到領域層的純函式——讀取層不自己改資料,查完交給 setTimeline 寫回
              </text>
            </svg>
          </figure>
          <p className={styles.caption}>
            2026-10：<code className={styles.code}>photoAssets</code> 是這次才補進介面的。
            原本照片是 <code className={styles.code}>/app</code> 自己直接呼叫
            <code className={styles.code}>fetchGeoPlacePhotoAssets</code>，展示頁則寫死在假資料裡——
            兩邊各走各的，換一份實作換不掉照片來源。
            同時 <code className={styles.code}>usePlanSimSocket</code> 的
            <code className={styles.code}>dataSource</code> 從寫死的 import 改成參數注入（預設假資料）。
          </p>
          <p className={styles.caption}>
            2026-10(後端查詢統一走資料存取層)：地圖與規劃領域原本散在元件與 hook 裡的後端查詢，全部改成呼叫注入的實例，
            端點由實例決定，不再用 <code className={styles.code}>cfg</code> 加旗標選端點。介面新增選填方法
            <code className={styles.code}>geoPlaceDetails</code>(完整地點詳情，與 <code className={styles.code}>placeDetails</code> 是不同端點與形狀)、
            <code className={styles.code}>placePhoto</code>、<code className={styles.code}>placeText</code>、<code className={styles.code}>geocode</code>、
            <code className={styles.code}>attractionsByCity</code>、<code className={styles.code}>attractionByID</code>、
            <code className={styles.code}>nearbyAttractionAreas</code>、<code className={styles.code}>searchNearby</code>；
            實例沒實作時，呼叫端用 <code className={styles.code}>requireXxx</code> 取用，會得到 rejected Promise 而不是例外。
            還沒收進來的是行程資料領域(<code className={styles.code}>fetchTrips</code>、<code className={styles.code}>fetchEntries</code> 等)。
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>檢視狀態在哪一層：三個階段的演變</h2>
          <p className={styles.lead}>
            <code className={styles.code}>selectedStopId</code> / <code className={styles.code}>hoverStopId</code>
            (<code className={styles.code}>PlanSelection</code>)不是推論的產物——不持久化、不進 AI 的工具、重新整理後不該還在。
            它放在哪一層，2026-10 改了兩次；現在的做法是<strong>跟著站點檢視實例走</strong>。
          </p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th></th>
                <th>① 綁在投影實作裡</th>
                <th>② 獨立一份、頁面共用</th>
                <th>③ 跟著實例走(現在)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>誰持有</td>
                <td>每個投影實作各自的 <code className={styles.code}>useState</code></td>
                <td>頁面一份 <code className={styles.code}>usePlanSelection</code>，模擬與真實來源共用</td>
                <td>每個站點檢視實例各一份；<code className={styles.code}>/ai-plan</code> 兩個實例，登入後一個</td>
              </tr>
              <tr>
                <td>交接時</td>
                <td>靠「換掉實例」的副作用隱含清空，讀程式碼看不出來</td>
                <td>明確呼叫 <code className={styles.code}>selection.clear()</code></td>
                <td>整個實例換掉(<code className={styles.code}>handedOver ? live : simulated</code>)，新實例初值就是 null，沒有 <code className={styles.code}>clear</code></td>
              </tr>
              <tr>
                <td>替換來源但保留現況</td>
                <td><strong>做不到</strong></td>
                <td>不呼叫 clear 就好</td>
                <td><strong>不支援</strong>——要的話得把選取搬回頁面</td>
              </tr>
              <tr>
                <td>來源狀態怎麼切換</td>
                <td>實例當 state 存快照</td>
                <td>實例當 state 存快照，靠兩個 effect 在 stops 變動時同步(漏同步就是「真實推論沒有地圖點」那次 bug)</td>
                <td>兩個 hook 都無條件呼叫，用 <code className={styles.code}>handedOver</code> 擇一，沒有快照也沒有同步 effect</td>
              </tr>
              <tr>
                <td>與登入後的關係</td>
                <td>各寫各的</td>
                <td>登入後用 <code className={styles.code}>usePlanStopsState</code>(自己持有選取)，/ai-plan 用另一條路</td>
                <td>推論態與登入後是<strong>同一個 hook</strong>，差別只剩 /ai-plan 前面多一個模擬態實例</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>三個頁面的持久化差異</h2>
          <p className={styles.lead}>
            <code className={styles.code}>commitTimeline</code> 不是同一個東西——
            只有正式頁多包了 resync / save 那一層。
          </p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>頁面</th>
                <th>store</th>
                <th>commitTimeline</th>
                <th>重新整理後</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>登入後手機／桌面(<code className={styles.code}>LivePlanLayer</code> → <code className={styles.code}>TripPlanPage</code>)</td>
                <td>localStorage</td>
                <td>包 resync + save，寫磁碟成功才更新 state</td>
                <td>內容保留</td>
              </tr>
              <tr>
                <td><code className={styles.code}>/ai-plan</code> 模擬層</td>
                <td><strong>無</strong></td>
                <td>裸 <code className={styles.code}>useSyncedState</code></td>
                <td>清空(刻意：展示不該污染真實行程)</td>
              </tr>
              <tr>
                <td><code className={styles.code}>/ai-plan</code> 推論態(交接後 <code className={styles.code}>LivePlanLayer</code>)</td>
                <td>localStorage 或 draft(「新行程」按鈕開新草稿)</td>
                <td>同 TripPlanPage(內部就是它)</td>
                <td>內容保留</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>一次異動的完整流程</h2>
          <p className={styles.lead}>
            以「首頁展示往回捲清除當天」為例——這個功能沒有碰到任何 UI 元件，是分層有效的直接證據。
          </p>
          <ol className={styles.flowList}>
            <li>使用者往回捲 → <code className={styles.code}>ScrollPlanDemo.handleScroll</code> 算出捲動進度</li>
            <li>呼叫 <code className={styles.code}>advanceTo(index)</code></li>
            <li><code className={styles.code}>demoScrollSource</code> 判斷跨出當天 → <code className={styles.code}>emit({"{ type: 'reset_day', day }"})</code></li>
            <li><code className={styles.code}>usePlanSimSocket.onMessage</code> 收到 → <code className={styles.code}>setTimeline(prev =&gt; removeDay(prev, day))</code></li>
            <li><code className={styles.code}>commitTimeline</code> 寫入 state 與 ref</li>
            <li>站點檢視實例的 <code className={styles.code}>stops</code> 更新：時間軸卡片消失、地圖圓點消失</li>
          </ol>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>四個入口的接法</h2>
          <p className={styles.lead}>
            /ai-plan(手機與桌面共用同一個 <code className={styles.code}>Content</code>)、登入後手機、登入後桌面，
            每個入口都是同一組分層(<code className={styles.code}>Content</code> → <code className={styles.code}>PlanLayout</code> →
            <code className={styles.code}>PlanOverlayLayout</code> → <code className={styles.code}>LivePlanLayer</code> →
            <code className={styles.code}>PlanMap</code>)，同名元件放在 <code className={styles.code}>home/plan-ai-sim/</code>、
            <code className={styles.code}>phone/</code>、<code className={styles.code}>desktop/</code>。/ai-plan 的第 4 層有兩個呼叫端：
            推論態是 <code className={styles.code}>LivePlanLayer</code>，模擬態(交接前)是 <code className={styles.code}>SimPlanLayer</code>；
            行程詳情頁(<code className={styles.code}>itineraries/</code>)也用同一組分層，但沒有第 4 層。
            下表只列跟資料流有關的差異；完整對照見 <code className={styles.code}>public/marker-layers.html</code>。
          </p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>入口</th>
                <th>站點檢視實例</th>
                <th>資料存取層</th>
                <th>store</th>
                <th>站點可見條件</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code className={styles.code}>/ai-plan</code> 模擬態</td>
                <td><code className={styles.code}>useSimulatedStopsView</code></td>
                <td>假資料(時間軸)、訪客版(詢問頁)</td>
                <td><strong>無</strong></td>
                <td>恆為 true</td>
              </tr>
              <tr>
                <td><code className={styles.code}>/ai-plan</code> 推論態</td>
                <td><code className={styles.code}>usePlanStopsState</code></td>
                <td>訪客版(固定)</td>
                <td>localStorage 或 draft</td>
                <td>恆為 true(規劃面板不收起)</td>
              </tr>
              <tr>
                <td>登入後手機</td>
                <td><code className={styles.code}>usePlanStopsState</code></td>
                <td>登入版</td>
                <td>localStorage</td>
                <td><code className={styles.code}>chatSheetOpen</code>，收起時傳空檢視</td>
              </tr>
              <tr>
                <td>登入後桌面</td>
                <td><code className={styles.code}>usePlanStopsState</code></td>
                <td>登入版</td>
                <td>localStorage</td>
                <td><code className={styles.code}>chatPopoverVisible</code>，關閉時傳空檢視</td>
              </tr>
            </tbody>
          </table>
          <p className={styles.caption}>
            「不該畫就傳空檢視」是四個入口同一條路徑(<code className={styles.code}>maskPlanStopsView</code>)，
            差別只在可見條件各自對應面板的開關狀態。首站自動平移(<code className={styles.code}>useFirstStopAutoPan</code>)
            只有手機入口有；桌面（/ai-plan wide 與登入後）的鏡頭統一只由點選圖卡移動(<code className={styles.code}>useDesktopStopPan</code>)，
            平移實作各自注入。
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>已知的例外與缺口</h2>
          <div className={styles.note}>
            <span className={styles.noteTitle}>
              地圖層繞過介面讀 children（2026-10 已修正）
            </span>
            原本 <code className={styles.code}>mapMarkerPointsKey</code> 直接讀
            <code className={styles.code}>timelineRef.current.nodes.get(id)</code> 拿主題點的子景點，
            而且只在來源是模擬時讀——交接到真實層之後
            timeline 住在 <code className={styles.code}>TripPlanPage</code> 內部、外層讀不到，主題點的展開能力整個消失。
            現已改為 <code className={styles.code}>PlanStopMarker</code> 帶
            <code className={styles.code}>children</code>，由模擬態與推論態的站點檢視實例各自填好，地圖那側不再需要分支。
            2026-10-24 起節點本身不再存子景點快照(只存 <code className={styles.code}>attractions</code> / <code className={styles.code}>places</code> 識別碼)，
            <code className={styles.code}>children</code> 與旅館點(<code className={styles.code}>lodging</code> 旗標)都是 <code className={styles.code}>resolveMapChildren</code>、
            <code className={styles.code}>lodgingMapMarkers</code> 用查回的結果算出來的。
          </div>
          <div className={styles.note}>
            <span className={styles.noteTitle}>兩條路徑的中間層完全分開</span>
            模擬層不接持久化，真實層不接 <code className={styles.code}>PlanSimSource</code>。
            兩者在領域層才匯流。目前沒問題，但若要做「展示的行程存下來繼續編輯」，
            把 noop store 換成 draft 實作即可——介面已經備好。
          </div>
          <div className={styles.note}>
            <span className={styles.noteTitle}>三個 Content 沒有整合測試</span>
            <code className={styles.code}>home/plan-ai-sim/Content.tsx</code>、<code className={styles.code}>phone/Content.tsx</code>、
            <code className={styles.code}>desktop/Content.tsx</code> 是各入口的狀態擁有者，交接、首站平移、目前位置、站點遮蔽的接線
            只靠子層的單元測試守住(例如 <code className={styles.code}>PlanPhoneView.mapWiring.test.tsx</code>)。
            這一層是這次重構最容易靜默回歸的地方。
          </div>
          <div className={styles.note}>
            <span className={styles.noteTitle}>noopPlanTimelineStore 零消費端</span>
            <code className={styles.code}>noopPlanTimelineStore</code> 只在測試裡用，
            正式程式碼沒有任何地方引用——展示頁不是「用 noop store」，是<strong>完全沒有 store</strong>。
            兩者行為相同，但結構不同。
          </div>
          <div className={styles.note}>
            <span className={styles.noteTitle}>usePlanTimelineCore 零消費端</span>
            <code className={styles.code}>plan-core/usePlanTimelineCore.ts</code> 沒有任何地方使用，
            功能已被 <code className={styles.code}>PlanTimelineStore</code> + 各頁自己的實作取代。
            它存在會讓「資料操作統一在哪」變模糊，因為它看起來也像個入口。
          </div>
        </div>
      </div>
    </div>
  )
}
