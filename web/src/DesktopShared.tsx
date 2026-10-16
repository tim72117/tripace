// DesktopShared:桌面版與手機版都會用到的 UI 小塊,從 App.tsx 拆出來獨立成
// 檔案——這些東西不屬於「純桌面版佈局」(見 DesktopLayout.tsx),因為手機版
// 的 PhoneNavDrawer/SettingsScreen(見 PhoneNavDrawer.tsx/PhoneScreens.tsx)
// 也需要引用它們;若整批併入 DesktopLayout.tsx,會讓手機版檔案跟
// DesktopLayout.tsx 互相 import 對方,形成循環依賴。獨立成第三份檔案,
// 兩邊都單向 import 這裡,不互相依賴。

// PanelMode:桌面版 side panel 目前顯示的內容;null 代表收合(主區全寬)。
// (原本還有 'demo-onagent'——「LLM 呼叫前端 tool」走 onagent 平台的
// 試做,見 clienttools/OnagentBridgeDemo.tsx——與 'demo-cards'——推薦
// 景點卡片試做,見 RecommendedPlacesList——與 'demo-map'——推薦景點
// 地圖試做,見 RecommendedPlacesMap.tsx——與 'demo-row'——推薦景點
// 橫滑試做,見 RecommendedPlacesRow——都已整個移除,含入口與實作。)
// 'trips'/'timeline'/'pace'/'geo-outline':正式導覽項目,所有
// 使用者都能在 rail 上看到(依各自的 *_ENABLED flag),渲染邏輯直接使用
// DesktopTripList/MultiTrackTimeline/PaceChart+PaceRouteMap、
// GeoCandidateSidebar/GeoOutlinePanel,見
// DesktopLayout.tsx / PhoneContent.tsx / PhoneNavDrawer.tsx,不屬於這組
// 共用的 demo 面板。
// 'blog':2026-10 新增,左側功能列「部落格」按鈕對應的面板(見下方
// BLOG_ENABLED 的完整說明)——渲染 blog/PhotoManagerPage.tsx 拆出的
// PhotoManagerContent(我的文章列表+圖片管理+部落格身份設定),slot 用
// main-replace(整頁內容,不是疊在地圖上的小卡片,同 demo-chat 的版面
// 需求)。這是受 flag 控制但非 demo 性質的功能,命名不帶 demo- 前綴,
// 維持跟 trips/timeline/pace 等正式項目同一組命名空間——flag 只是
// 控制「要不要在導覽列曝光」,不代表這是試做內容。
// 'blog-editor':2026-10 新增,文章編輯畫面(見下方 BLOG_EDITOR_ENABLED
// 的完整說明)——渲染 blog/ArticleEditor.tsx(2026-10 從
// demo/RouteEditor.tsx 整個搬過來重用的雜誌式編輯介面,純前端假資料,
// 不呼叫任何 API)。跟 'blog' 不同的是,這個面板沒有對應的 rail 按鈕
// (見 DesktopRail.tsx 的說明)——只能從「我的文章列表」(blog 面板裡
// 的 BlogArticleList)點進一篇文章才會切換過來,不是左側常駐可見的
// 獨立入口;原本 demo-route-editor 掛在 rail 上的按鈕已整個移除。
// 'demo-chat':舊版對話框試做,見下方 DEMO_CHAT_ENABLED 的完整說明,
// 歸在 demo-* 這組試做面板底下。
export type PanelMode =
  | 'trips' | 'timeline' | 'pace' | 'geo-outline' | 'blog' | 'blog-editor'
  | 'demo-chat'
  | null

// 規劃地圖(geo-outline)已不再有獨立的 feature flag——使用者明確要求
// 「規劃不需要 feature flag 了」,它現在是核心功能(手機版的預設起始
// 畫面,見 PhoneContent.tsx 的 drawerMode 說明),不該再能被部署環境變數
// 關閉。原本的 GEO_OUTLINE_ENABLED/VITE_FEATURE_GEO_OUTLINE 已移除,
// PANEL_REGISTRY 的 'geo-outline' 項目改成固定 enabled: true(見下方)。

// TIMELINE_ENABLED/PACE_ENABLED:「時間軸」/「路徑」(配速表)rail 按鈕各自
// 獨立的開關,同 GEO_OUTLINE_ENABLED 的擋法(見上方說明),但預設值相反
// ——兩者預設關閉,只在明確設為字串 "true" 時才啟用。關閉時 rail 不渲染
// 對應按鈕,isPanelMode 也不再承認該字串是合法值,即使手動打 /app/timeline
// 或 /app/pace 網址也會 fallback 回 'trips',不只是找不到入口。兩者分開
// 成獨立旗標(而非合併成一個),是因為兩個功能彼此獨立,部署時可能只想開
// 其中一個。
export const TIMELINE_ENABLED = import.meta.env.VITE_FEATURE_TIMELINE === 'true'
export const PACE_ENABLED = import.meta.env.VITE_FEATURE_PACE === 'true'

// TIME_DRAG_ENABLED——時間軸小圓點拖拉調整時間的開關(plan-core/
// PlanTimelineView.tsx anchorDot 的拖拉手勢,見該檔案 DragState 的完整
// 說明)。同 TIMELINE_ENABLED/PACE_ENABLED 一套編譯時 feature flag
// 機制,預設關閉,只在明確設為字串 "true" 時才啟用——使用者明確要求
// 「前端使用 feature flag 控制功能開啟,控制時間拉動功能」,即使這個
// 功能本身已經實作完成、不是試做階段的功能,仍沿用既有慣例的「預設
// 關閉」方向(而非「預設開啟、需要時關閉」),保持所有 feature flag
// 開關方向一致,不需要呼叫端記住「這個特別相反」。
export const TIME_DRAG_ENABLED = import.meta.env.VITE_FEATURE_TIME_DRAG === 'true'

// ROUTE_LINE_ENABLED——「規劃行程」對話小匡標頭列路徑開關的開關(見
// DesktopLayout.tsx 的完整說明:開啟時地圖上依時間軸順序把所有已排入
// 的景點連成一條完整路線)。同 TIME_DRAG_ENABLED 一套編譯時 feature
// flag 機制(使用者明確要求「這個開關加上 feature flag」),預設關閉,
// 只在明確設為字串 "true" 時才啟用——flag 關閉時,標頭列上的路徑開關
// icon 本身就不會渲染,不是「icon 在但點了沒反應」。
export const ROUTE_LINE_ENABLED = import.meta.env.VITE_FEATURE_ROUTE_LINE === 'true'

// DESTINATION_PROMPT_ENABLED——使用者首次進入 /app 時,地圖右上角「規劃
// 行程」小匡下方自動彈出的「想去哪裡?」對話氣泡開關(見
// DestinationPrompt.tsx 的完整說明:先選大地區、再選該地區底下的
// 城市,選定城市後把「我想去○○玩」送進既有的 onagent 對話/時間軸機制,
// 跟使用者自己在輸入框打字送出完全相同效果)。同 TIME_DRAG_ENABLED/
// ROUTE_LINE_ENABLED 一套編譯時 feature flag 機制,預設關閉,只在明確設為
// 字串 "true" 時才啟用——這是一個主動引導使用者的新互動,還沒有實際流量
// 驗證過,先用 flag 包住,可以只在特定環境開啟觀察效果,不需要重新部署
// 就能整個關掉。flag 關閉時這個對話氣泡完全不會掛載,不是掛載了但永遠
// 不觸發——呼叫端(DesktopLayout.tsx)直接用這個常數包住整段渲染。
export const DESTINATION_PROMPT_ENABLED = import.meta.env.VITE_FEATURE_DESTINATION_PROMPT === 'true'

// TRANSIT_MODE_SELECT_ENABLED——點擊時間軸「交通膠囊」彈出交通方式選單
// (步行/公車/捷運/開車)讓使用者改選的開關(2026-10 新增,使用者明確
// 要求「交通時間的膠囊可以選擇交通方式」)。選完後重新呼叫
// fetchPlanAiTransitEstimate(見 api.ts 的完整說明,mode 本來就是這支端點
// 的選填查詢參數,後端早已支援、不需要改動)以使用者指定的 mode 重新
// 查詢這段交通的時間/距離,取代原本「後端依直線距離自動決定」的預設值。
//
// 只有正式頁面(/app、/trip-plan,見 TripPlanPage.tsx)接這個功能——
// /ai-plan 展示頁(AIPlanTimelinePage.tsx)固定接純前端假資料
// (planAiFakeDataSource.transitEstimate),沒有後端可以重新查詢,不接這個
// flag 對應的 callback,PlanTimelineView 在沒收到對應 callback 時膠囊
// 维持原本純展示、不可點擊(見該元件 onTransitModeChange prop 的完整
// 說明),flag 開關本身不影響展示頁的行為。
//
// 同 TIME_DRAG_ENABLED/ROUTE_LINE_ENABLED/DESTINATION_PROMPT_ENABLED 一套
// 編譯時 feature flag 機制,預設關閉,只在明確設為字串 "true" 時才啟用。
export const TRANSIT_MODE_SELECT_ENABLED = import.meta.env.VITE_FEATURE_TRANSIT_MODE_SELECT === 'true'

// NEW_TRIP_DRAFT_ENABLED——/ai-plan 展示頁交接後手機版對話區,composer
// 上方「新行程」按鈕的開關(2026-10 新增,見 home/plan-ai-sim/
// LivePlanLayer.tsx 的完整說明:點擊後把目前草稿歸檔進行程清單、開始
// 一份全新的空白草稿,舊草稿保留在 plan-core/planTimelineDrafts.ts 管理
// 的清單裡,供未來「叫出舊行程清單」UI 使用——這一輪只做「新增」這個
// 動作本身)。
//
// 同 TIME_DRAG_ENABLED/ROUTE_LINE_ENABLED/DESTINATION_PROMPT_ENABLED/
// TRANSIT_MODE_SELECT_ENABLED 一套編譯時 feature flag 機制,預設關閉,
// 只在明確設為字串 "true" 時才啟用——這是全新功能,資料層(多份草稿)
// 還沒有被實際使用驗證過,先用 flag 包住,可以只在特定環境開啟觀察
// 效果,不需要重新部署就能整個關掉。flag 關閉時這顆「新行程」按鈕完全
// 不會渲染,不是渲染了但點了沒反應。
export const NEW_TRIP_DRAFT_ENABLED = import.meta.env.VITE_FEATURE_NEW_TRIP_DRAFT === 'true'

// DEBUG_PANEL_ENABLED:原本綁在網址參數 ?demo(見 main.tsx 的 isDemo)
// 底下的試做用導覽項目(API/WS 狀態除錯面板),改成跟 TIMELINE_ENABLED/
// PACE_ENABLED 同一種編譯時 feature flag 機制——各自獨立開關而非沿用單一
// isDemo 布林值,是因為部署時可能只想開放其中幾項給特定環境驗證,不是全開
// 或全關兩種選擇。同 TIMELINE_ENABLED/PACE_ENABLED,預設關閉,只在明確設為
// 字串 "true" 時才啟用。(原本還有 DEMO_ONAGENT_ENABLED——onagent 平台的
// LLM 呼叫前端 tool 資料流試做——DEMO_CARDS_ENABLED——推薦景點卡片
// 試做——DEMO_ROW_ENABLED——推薦景點橫滑試做——與 DEMO_CLIENTTOOLS_ENABLED
// ——tripace 自家 want 框架 ClientToolsBridge 的試做入口——都已整個移除,
// 含入口與實作。)
export const DEBUG_PANEL_ENABLED = import.meta.env.VITE_FEATURE_DEBUG_PANEL === 'true'

// BLOG_ENABLED — 左側功能列「部落格」按鈕的開關(2026-10 新增,使用者
// 明確要求「將部落格的頁面放到登入後的左側功能列,feature flag 預設
// 關閉,本地先開啟」)。對應 panelMode:'blog'(見上方該值的完整說明),
// main-replace slot 渲染 blog/PhotoManagerPage.tsx 拆出的
// PhotoManagerContent——第一版做法是點擊後 navigate('/blog/photos')
// 整頁導覽,但使用者回報「進去後要保留左邊的功能頁」:/blog/photos
// 是獨立路由,離開了 /app 的畫面結構,DesktopRail 不在那條路由裡會
// 整個消失。改成 panelMode 面板切換後,/app 畫面本身不離開,左側
// rail 持續顯示,跟 timeline/pace 等其餘正式項目的使用體驗一致。
// /blog/photos 這條獨立路由本身並未移除,未登入也能直接打網址到達
// 的既有行為不受影響(PhotoManagerPage 保留完整的登入檢查外殼),
// 兩個進入點(左側面板/直接網址)共用同一份 PhotoManagerContent。
//
// 同其餘 TIME_DRAG_ENABLED/ROUTE_LINE_ENABLED/… 一套編譯時 feature flag
// 機制:預設關閉,只在明確設為字串 "true" 時才啟用——部落格這組頁面
// 還沒有在左側導覽曝光過,先用 flag 包住只在本機開發環境驗證,不需要
// 重新部署就能整個關掉。
export const BLOG_ENABLED = import.meta.env.VITE_FEATURE_BLOG === 'true'

// BLOG_EDITOR_ENABLED — 文章編輯畫面的開關(2026-10 新增,使用者明確
// 要求「先把左邊文章編輯器加進來,不用管對接有沒有正確」)。對應
// panelMode:'blog-editor'(見上方該值的完整說明),main-replace slot
// 渲染 blog/ArticleEditor.tsx(2026-10 從 demo/RouteEditor.tsx 整個
// 搬過來重用的雜誌式編輯介面)。
//
// 這個 flag 刻意獨立於 BLOG_ENABLED 之外(不是「部落格功能」這一個
// flag 就同時控制列表跟編輯器兩個面板)——理由同 TIMELINE_ENABLED/
// PACE_ENABLED 分開成獨立旗標的既有慣例:兩個功能的完成度/驗證階段
// 不同,部署時可能只想開放其中一個(例如先開放看「我的文章列表」,
// 編輯器還在打通流程階段不想曝光)。
//
// 原本的 demo-route-editor/DEMO_ROUTE_EDITOR_ENABLED
// (VITE_FEATURE_DEMO_ROUTE_EDITOR)已整個移除(含左側 rail 按鈕跟
// 這個 flag 本身,見 DesktopRail.tsx 的完整說明)——使用者明確要求
// 「移除掉 VITE_FEATURE_DEMO_ROUTE_EDITOR 參數及相關控制」,搬過來
// 重用的這份編輯器畫面改用這個全新的 flag 控制,不是沿用舊的那個
// (舊 flag 連同它控制的「左側常駐 rail 按鈕」這個語意一起退役;新
// flag 控制的是「blog-editor 這個 panelMode 本身能不能被進入」,
// 語意已經不同——這個畫面現在沒有對應的 rail 按鈕,只能從「我的
// 文章列表」點進一篇文章才會切換過來,見 BlogArticleList.tsx 的
// 完整說明)。
//
// 同其餘 TIME_DRAG_ENABLED/ROUTE_LINE_ENABLED/… 一套編譯時 feature
// flag 機制:預設關閉,只在明確設為字串 "true" 時才啟用。
export const BLOG_EDITOR_ENABLED = import.meta.env.VITE_FEATURE_BLOG_EDITOR === 'true'

// DEMO_CHAT_ENABLED — 舊版對話框(chat/ChatScreen.tsx,走 tripace onagent
// app 的 trip_entry_* 工具、以批次表格呈現結果)的試做分頁開關。
//
// 2026-10:地圖規劃的對話視窗改成渲染 AI 規劃時間軸
// (trip-plan/TripPlanPage.tsx,走 plan-ai-timeline app)之後,舊的
// ChatScreen 失去原本的入口——使用者明確要求「舊的對話框移動到 demo
// 分頁」,不是刪除:那套 trip_entry_* 工具鏈(新增/查詢/更新/刪除行程
// 條目、批次表格 UI)是另一種仍有參考價值的互動模式,保留成試做分頁
// 讓它仍可被開啟驗證,但不佔用正式導覽項目。
//
// 同其餘 DEMO_*/TIMELINE_*/PACE_* flag 的既有慣例:預設關閉,只在明確
// 設為字串 "true" 時才啟用。
export const DEMO_CHAT_ENABLED = import.meta.env.VITE_FEATURE_DEMO_CHAT === 'true'

// PanelSlot/PanelSpec/PANEL_REGISTRY:每個 panelMode 的版面行為單一定義處
// ——'float' 表示疊在 .desktop-main(地圖)上方的浮動卡片(不佔 flex 版面
// 空間、不擠壓地圖寬度),'main-replace' 表示整個取代 .desktop-main
// (預設關閉的 blog-editor/demo-chat 試做/編輯類功能用這個 slot)。
// width 只有 float 用到,決定浮動卡片寬度
// (見 FloatingPanel.tsx)。requiresTrip 給 rail 按鈕
// 的 disabled 判斷用(見 DesktopRail.tsx)。
//
// 這張表存在的理由:先前 panelMode 的行為判斷散落在至少 5 個地方
// (這裡的白名單、side panel 是否展開的判斷式、.wide 樣式字串拼接、side
// panel 內容 ternary、main 區 ternary),新增一種模式要同步改 5 處,曾經
// 因為漏改其中一處出過 bug。現在只需要改這張表跟 DesktopLayout.tsx 的
// render 分支各一次,其餘地方(PANEL_MODES 白名單、isPanelMode())都是
// 從這張表衍生,不會漏改。
export type PanelSlot = 'float' | 'main-replace'

export interface PanelSpec {
  enabled: boolean
  slot: PanelSlot
  width?: number
  requiresTrip?: boolean
}

export const PANEL_REGISTRY: Record<Exclude<PanelMode, null>, PanelSpec> = {
  trips: { enabled: true, slot: 'float', width: 272 },
  timeline: { enabled: TIMELINE_ENABLED, slot: 'float', width: 380, requiresTrip: true },
  pace: { enabled: PACE_ENABLED, slot: 'float', width: 380 },
  'geo-outline': { enabled: true, slot: 'float', width: 380 },
  // demo-chat 用 main-replace(而非 float):ChatScreen 是一整個完整的
  // 對話畫面(訊息流+輸入框+批次表格),不是疊在地圖上的小卡片。
  'demo-chat': { enabled: DEMO_CHAT_ENABLED, slot: 'main-replace' },
  // blog/blog-editor 同樣用 main-replace:PhotoManagerContent(我的
  // 文章列表+圖片網格+部落格身份設定表單)、ArticleEditor(雜誌式文章
  // 編輯畫面)都是一整頁內容,不是疊在地圖上的小卡片。
  blog: { enabled: BLOG_ENABLED, slot: 'main-replace' },
  'blog-editor': { enabled: BLOG_EDITOR_ENABLED, slot: 'main-replace' },
}

// isPanelMode/PANEL_MODES(驗證 URL 路徑參數 /app/:panelMode 是否合法)
// 2026-10 隨這段路徑參數本身一併移除——使用者明確要求「展開側欄不需要
// 變更路由」,panelMode 改回純本地 UI state(見 DesktopLayout.tsx 的完整
// 說明),不再有網址輸入需要驗證,這兩個輔助定義失去存在理由,一併刪除
// 而非留著當死碼。

// DrawerMode:手機版分頁列(PhoneTabBar.tsx 底部常駐 + PhoneSideTools.tsx
// 右側小圖示)/主顯示區可切換到的模式——即 PanelMode 扣掉 null 與
// blog-editor(該模式只有桌面版文章編輯器才有實作,見
// BLOG_EDITOR_ENABLED 的說明,手機版故意不支援)。原本定義在
// PhoneNavDrawer.tsx,搬到這裡與 PanelMode 收斂在同一份檔案,避免兩份
// 值域各自維護、日後新增/移除模式時漏改其中一處。
// （2026-10 補註:桌面版 panelMode 已改回純本地 state,不再有
// /app/:panelMode 路徑參數可供「網址落在某個模式時 fallback」這件事,
// 這段排除邏輯本身只跟手機版分頁列實際支援哪些模式有關,與路由無涉。）
// demo-chat 同樣排除:它是桌面版專屬的試做分頁(見 DEMO_CHAT_ENABLED 的
// 完整說明),手機版的對話入口是底部分頁列開啟的疊加層,不走 drawer 的
// 分頁切換機制,理由同 blog-editor。
export type DrawerMode = Exclude<PanelMode, 'blog-editor' | 'demo-chat' | null>

// LangSelect/TokenDisplay 已移到 user/LangSelect.tsx、user/TokenDisplay.tsx
// ——兩者都是設定畫面(SettingsDialog 桌面版/SettingsScreen 手機版)專用的
// UI 小塊,不是桌面/手機共用的正式邏輯,理由同 RouteEditor 移到 demo/ 目錄。
