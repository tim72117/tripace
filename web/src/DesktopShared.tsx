// DesktopShared:桌面版與手機版都會用到的 UI 小塊,從 App.tsx 拆出來獨立成
// 檔案——這些東西不屬於「純桌面版佈局」(見 planning/member/desktop/Content.tsx),因為手機版
// 的 PhoneNavDrawer/SettingsScreen(見 PhoneNavDrawer.tsx/PhoneScreens.tsx)
// 也需要引用它們;若整批併入 planning/member/desktop/Content.tsx,會讓手機版檔案跟
// planning/member/desktop/Content.tsx 互相 import 對方,形成循環依賴。獨立成第三份檔案,
// 兩邊都單向 import 這裡,不互相依賴。

// PanelMode:桌面版 side panel 目前顯示的內容;null 代表收合(主區全寬)。
// (原本還有 'demo-onagent'——「LLM 呼叫前端 tool」走 onagent 平台的
// 試做,原 clienttools/OnagentBridgeDemo.tsx,已移除——與 'demo-cards'——推薦
// 景點卡片試做,見 RecommendedPlacesList——與 'demo-map'——推薦景點
// 地圖試做,見 RecommendedPlacesMap.tsx——與 'demo-row'——推薦景點
// 橫滑試做,見 RecommendedPlacesRow——都已整個移除,含入口與實作。)
// 'trips'/'timeline'/'geo-outline':正式導覽項目,所有
// 使用者都能在 rail 上看到(依各自的 *_ENABLED flag),渲染邏輯直接使用
// trip/desktop/TripList/MultiTrackTimeline、
// planning/place/desktop/CandidateList/PlanMap,見
// planning/member/desktop/Content.tsx / planning/member/phone/Content.tsx / PhoneNavDrawer.tsx,不屬於這組
// 共用的 demo 面板。
// 'blog':2026-10 新增,左側功能列「部落格」按鈕對應的面板(見下方
// BLOG_ENABLED 的完整說明)——渲染 blog/PhotoManagerPage.tsx 拆出的
// PhotoManagerContent(我的文章列表+圖片管理+部落格身份設定),slot 用
// main-replace(整頁內容,不是疊在地圖上的小卡片)。這是受 flag 控制但非 demo 性質的功能,命名不帶 demo- 前綴,
// 維持跟 trips/timeline 等正式項目同一組命名空間——flag 只是
// 控制「要不要在導覽列曝光」,不代表這是試做內容。
// 'blog-editor':2026-10 新增,文章編輯畫面(見下方 BLOG_EDITOR_ENABLED
// 的完整說明)——渲染 blog/ArticleEditor.tsx(2026-10 從
// demo/RouteEditor.tsx 整個搬過來重用的雜誌式編輯介面,已改用 blog/types.ts
// 的 ThemePageBlock 並串接 content_pages 儲存 API)。跟 'blog' 不同的是,
// 這個面板沒有對應的導覽列按鈕(見 desktop/Nav.tsx 的說明)——只能從「我的文章列表」(blog 面板裡
// 的 BlogArticleList)點進一篇文章才會切換過來,不是左側常駐可見的
// 獨立入口;原本 demo-route-editor 掛在 rail 上的按鈕已整個移除。
export type PanelMode =
  | 'trips' | 'timeline' | 'geo-outline' | 'blog' | 'blog-editor'
  | null

// 規劃地圖(geo-outline)已不再有獨立的 feature flag——使用者明確要求
// 「規劃不需要 feature flag 了」,它現在是核心功能(手機版的預設起始
// 畫面,見 planning/member/phone/Content.tsx 的 drawerMode 說明),不該再能被部署環境變數
// 關閉。原本的 GEO_OUTLINE_ENABLED/VITE_FEATURE_GEO_OUTLINE 已移除,
// PANEL_REGISTRY 的 'geo-outline' 項目改成固定 enabled: true(見下方)。

// TIMELINE_ENABLED:「時間軸」rail 按鈕的開關,同 GEO_OUTLINE_ENABLED 的擋法(見上方說明),但預設值相反
// ——預設關閉,只在明確設為字串 "true" 時才啟用。關閉時 rail 不渲染
// 對應按鈕,isPanelMode 也不再承認該字串是合法值,即使手動打 /app/timeline
// 網址也會 fallback 回 'trips',不只是找不到入口。
export const TIMELINE_ENABLED = import.meta.env.VITE_FEATURE_TIMELINE === 'true'

// TIME_DRAG_ENABLED——時間軸小圓點拖拉調整時間的開關(planning/timeline/
// PlanTimelineView.tsx anchorDot 的拖拉手勢,見該檔案 DragState 的完整
// 說明)。同 TIMELINE_ENABLED 一套編譯時 feature flag
// 機制,預設關閉,只在明確設為字串 "true" 時才啟用——使用者明確要求
// 「前端使用 feature flag 控制功能開啟,控制時間拉動功能」,即使這個
// 功能本身已經實作完成、不是試做階段的功能,仍沿用既有慣例的「預設
// 關閉」方向(而非「預設開啟、需要時關閉」),保持所有 feature flag
// 開關方向一致,不需要呼叫端記住「這個特別相反」。
export const TIME_DRAG_ENABLED = import.meta.env.VITE_FEATURE_TIME_DRAG === 'true'

// ROUTE_LINE_ENABLED——地圖上「整條路線」(依時間軸順序把所有已排入的景點連成一條完整路線)的開關。
// 四個入口(/ai-plan、登入後手機、登入後桌面)全部由這個 flag 控制(2026-10,使用者明確要求「整條路線全都用
// feature flag 控制」;原本只控制登入後桌面標頭列的路徑開關 icon,其餘入口根本不畫):
//   - flag 關閉:四個入口都不畫整條路線;登入後桌面標頭列的路徑開關 icon 也不渲染(不是渲染了但點了沒反應)。
//   - flag 開啟:登入後桌面由使用者點標頭列的 icon 切換(預設不顯示,見 planning/member/desktop/Content.tsx);沒有切換入口的
//     /ai-plan 與登入後手機,有站點時就畫。
// 同 TIME_DRAG_ENABLED 一套編譯時 feature flag 機制(使用者要求「這個開關加上 feature flag」),預設關閉,
// 只在明確設為字串 "true" 時才啟用。
export const ROUTE_LINE_ENABLED = import.meta.env.VITE_FEATURE_ROUTE_LINE === 'true'


// TRANSIT_MODE_SELECT_ENABLED——點擊時間軸「交通膠囊」彈出交通方式選單
// (步行/公車/捷運/開車)讓使用者改選的開關(2026-10 新增,使用者明確
// 要求「交通時間的膠囊可以選擇交通方式」)。選完後重新呼叫
// fetchPlanAiTransitEstimate(見 api.ts 的完整說明,mode 本來就是這支端點
// 的選填查詢參數,後端早已支援、不需要改動)以使用者指定的 mode 重新
// 查詢這段交通的時間/距離,取代原本「後端依直線距離自動決定」的預設值。
//
// 只有正式頁面(登入後 /app,見 planning/panel/TripPlanPage.tsx)接這個功能——
// /ai-plan 展示頁(planning/preview/Content.tsx)固定接純前端假資料
// (planning/data/fake.ts 的 transitEstimate),沒有後端可以重新查詢,不接這個
// flag 對應的 callback,PlanTimelineView 在沒收到對應 callback 時膠囊
// 维持原本純展示、不可點擊(見該元件 onSetStopTransitMode prop 的完整
// 說明),flag 開關本身不影響展示頁的行為。
//
// 同 TIME_DRAG_ENABLED/ROUTE_LINE_ENABLED 一套
// 編譯時 feature flag 機制,預設關閉,只在明確設為字串 "true" 時才啟用。
export const TRANSIT_MODE_SELECT_ENABLED = import.meta.env.VITE_FEATURE_TRANSIT_MODE_SELECT === 'true'

// NEW_TRIP_DRAFT_ENABLED——輸入框旁「新行程」按鈕的開關(2026-10 新增)。範圍:/ai-plan/live 展示頁(舊草稿機制,見
// planning/preview/LivePlanLayer.tsx)與登入後 /app 桌面、手機(前端 Trip,見 planning/trip 與 member/*/LivePlanLayer.tsx):
// 點擊後開始一份全新的空白行程,舊的保留在儲存裡(目前還沒有叫出舊行程的介面)。
//
// 同 TIME_DRAG_ENABLED/ROUTE_LINE_ENABLED/
// TRANSIT_MODE_SELECT_ENABLED 一套編譯時 feature flag 機制,預設關閉,
// 只在明確設為字串 "true" 時才啟用——這是全新功能,資料層(多份行程)
// 還沒有被實際使用驗證過,先用 flag 包住,可以只在特定環境開啟觀察
// 效果。flag 關閉時這顆「新行程」按鈕完全不會渲染,不是渲染了但點了沒反應。
export const NEW_TRIP_DRAFT_ENABLED = import.meta.env.VITE_FEATURE_NEW_TRIP_DRAFT === 'true'

// DEBUG_PANEL_ENABLED:原本綁在網址參數 ?demo(見 main.tsx 的 isDemo)
// 底下的試做用導覽項目(API/WS 狀態除錯面板),改成跟 TIMELINE_ENABLED
// 同一種編譯時 feature flag 機制——各自獨立開關而非沿用單一
// isDemo 布林值,是因為部署時可能只想開放其中幾項給特定環境驗證,不是全開
// 或全關兩種選擇。同 TIMELINE_ENABLED,預設關閉,只在明確設為
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
// 是獨立路由,離開了 /app 的畫面結構,左側導覽列(desktop/Nav)不在那條路由裡會
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
// flag 就同時控制列表跟編輯器兩個面板)——理由同 TIMELINE_ENABLED
// 等分開成獨立旗標的既有慣例:兩個功能的完成度/驗證階段
// 不同,部署時可能只想開放其中一個(例如先開放看「我的文章列表」,
// 編輯器還在打通流程階段不想曝光)。
//
// 原本的 demo-route-editor/DEMO_ROUTE_EDITOR_ENABLED
// (VITE_FEATURE_DEMO_ROUTE_EDITOR)已整個移除(含左側 rail 按鈕跟
// 這個 flag 本身,見 desktop/Nav.tsx 的說明)——使用者明確要求
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

// PanelSlot/PanelSpec/PANEL_REGISTRY:每個 panelMode 的版面行為單一定義處
// ——'float' 表示疊在 .desktop-main(地圖)上方的浮動卡片(不佔 flex 版面
// 空間、不擠壓地圖寬度),'main-replace' 表示整個取代 .desktop-main
// (預設關閉的 blog-editor 編輯類功能用這個 slot)。
// width 只有 float 用到,決定浮動卡片寬度
// (見 FloatingPanel.tsx)。requiresTrip 給 rail 按鈕
// 的 disabled 判斷用(見 desktop/Nav.tsx)。
//
// 這張表存在的理由:先前 panelMode 的行為判斷散落在至少 5 個地方
// (這裡的白名單、side panel 是否展開的判斷式、.wide 樣式字串拼接、side
// panel 內容 ternary、main 區 ternary),新增一種模式要同步改 5 處,曾經
// 因為漏改其中一處出過 bug。現在只需要改這張表跟 planning/member/desktop/Content.tsx 的
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
  'geo-outline': { enabled: true, slot: 'float', width: 380 },
  // blog/blog-editor 同樣用 main-replace:PhotoManagerContent(我的
  // 文章列表+圖片網格+部落格身份設定表單)、ArticleEditor(雜誌式文章
  // 編輯畫面)都是一整頁內容,不是疊在地圖上的小卡片。
  blog: { enabled: BLOG_ENABLED, slot: 'main-replace' },
  'blog-editor': { enabled: BLOG_EDITOR_ENABLED, slot: 'main-replace' },
}

// isPanelMode/PANEL_MODES(驗證 URL 路徑參數 /app/:panelMode 是否合法)
// 2026-10 隨這段路徑參數本身一併移除——使用者明確要求「展開側欄不需要
// 變更路由」,panelMode 改回純本地 UI state(見 planning/member/desktop/Content.tsx 的完整
// 說明),不再有網址輸入需要驗證,這兩個輔助定義失去存在理由,一併刪除
// 而非留著當死碼。

// DrawerMode:手機版分頁列(phone/Nav.tsx 底部常駐 + PhoneSideTools.tsx
// 右側小圖示)/主顯示區可切換到的模式——即 PanelMode 扣掉 null 與
// blog-editor(該模式只有桌面版文章編輯器才有實作,見
// BLOG_EDITOR_ENABLED 的說明,手機版故意不支援)。原本定義在
// PhoneNavDrawer.tsx,搬到這裡與 PanelMode 收斂在同一份檔案,避免兩份
// 值域各自維護、日後新增/移除模式時漏改其中一處。
// （2026-10 補註:桌面版 panelMode 已改回純本地 state,不再有
// /app/:panelMode 路徑參數可供「網址落在某個模式時 fallback」這件事,
// 這段排除邏輯本身只跟手機版分頁列實際支援哪些模式有關,與路由無涉。）
// 手機版分頁列不支援 blog-editor(該模式只有桌面版文章編輯器才有實作)。
export type DrawerMode = Exclude<PanelMode, 'blog-editor' | null>

// LangSelect/TokenDisplay 已移到 user/LangSelect.tsx、user/TokenDisplay.tsx
// ——兩者都是設定畫面(SettingsDialog 桌面版/SettingsScreen 手機版)專用的
// UI 小塊,不是桌面/手機共用的正式邏輯,理由同當初 RouteEditor(已於部落格文章編輯器上線時移除)放在 demo/ 目錄。
