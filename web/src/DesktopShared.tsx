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
// 'demo-route-editor':旅程分享/路徑編輯器試做(見 docs/ 同一輪討論的
// 雜誌式編輯介面構想與 artifact mockup)——目前只做右側雜誌內容編輯區
// (純前端假資料,不呼叫任何 API,見 RouteEditor.tsx 開頭的說明),左側
// 常駐地圖與後端 schema 都尚未設計,故歸在 demo-* 這組試做面板底下
// (DEMO_ROUTE_EDITOR_ENABLED,見下方),不是正式導覽項目——等資料結構
// 定案、真的接上後端,才會比照 pace/geo-outline 升級成正式功能。
export type PanelMode =
  | 'trips' | 'timeline' | 'pace' | 'geo-outline'
  | 'demo-route-editor' | 'demo-chat'
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
// DEMO_ROUTE_EDITOR_ENABLED:路徑編輯器試做的開關,同上面幾個 DEMO_*
// 一套機制——預設關閉,只在明確設為字串 "true" 時才啟用。
export const DEMO_ROUTE_EDITOR_ENABLED = import.meta.env.VITE_FEATURE_DEMO_ROUTE_EDITOR === 'true'

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
// (預設關閉的 demo-route-editor/demo-chat 試做功能用這個 slot)。
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
  'demo-route-editor': { enabled: DEMO_ROUTE_EDITOR_ENABLED, slot: 'main-replace' },
  // demo-chat 用 main-replace(而非 float):ChatScreen 是一整個完整的
  // 對話畫面(訊息流+輸入框+批次表格),不是疊在地圖上的小卡片,版面
  // 需求跟 demo-route-editor 同一類。
  'demo-chat': { enabled: DEMO_CHAT_ENABLED, slot: 'main-replace' },
}

// isPanelMode/PANEL_MODES(驗證 URL 路徑參數 /app/:panelMode 是否合法)
// 2026-10 隨這段路徑參數本身一併移除——使用者明確要求「展開側欄不需要
// 變更路由」,panelMode 改回純本地 UI state(見 DesktopLayout.tsx 的完整
// 說明),不再有網址輸入需要驗證,這兩個輔助定義失去存在理由,一併刪除
// 而非留著當死碼。

// DrawerMode:手機版分頁列(PhoneTabBar.tsx 底部常駐 + PhoneSideTools.tsx
// 右側小圖示)/主顯示區可切換到的模式——即 PanelMode 扣掉 null 與
// demo-route-editor(該模式只有桌面版路徑編輯器試做才有實作,見
// DEMO_ROUTE_EDITOR_ENABLED 的說明,手機版故意不支援)。原本定義在
// PhoneNavDrawer.tsx,搬到這裡與 PanelMode 收斂在同一份檔案,避免兩份
// 值域各自維護、日後新增/移除模式時漏改其中一處。
// （2026-10 補註:桌面版 panelMode 已改回純本地 state,不再有
// /app/:panelMode 路徑參數可供「網址落在某個模式時 fallback」這件事,
// 這段排除邏輯本身只跟手機版分頁列實際支援哪些模式有關,與路由無涉。）
// demo-chat 同樣排除:它是桌面版專屬的試做分頁(見 DEMO_CHAT_ENABLED 的
// 完整說明),手機版的對話入口是底部分頁列開啟的疊加層,不走 drawer 的
// 分頁切換機制,理由同 demo-route-editor。
export type DrawerMode = Exclude<PanelMode, 'demo-route-editor' | 'demo-chat' | null>

// LangSelect/TokenDisplay 已移到 user/LangSelect.tsx、user/TokenDisplay.tsx
// ——兩者都是設定畫面(SettingsDialog 桌面版/SettingsScreen 手機版)專用的
// UI 小塊,不是桌面/手機共用的正式邏輯,理由同 RouteEditor 移到 demo/ 目錄。
