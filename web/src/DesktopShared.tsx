import './styles-desktop.css'

// DesktopShared:桌面版與手機版都會用到的 UI 小塊,從 App.tsx 拆出來獨立成
// 檔案——這些東西不屬於「純桌面版佈局」(見 DesktopLayout.tsx),因為手機版
// 的 PhoneNavDrawer/SettingsScreen(見 PhoneNavDrawer.tsx/PhoneScreens.tsx)
// 也需要引用它們;若整批併入 DesktopLayout.tsx,會讓手機版檔案跟
// DesktopLayout.tsx 互相 import 對方,形成循環依賴。獨立成第三份檔案,
// 兩邊都單向 import 這裡,不互相依賴。

// PanelMode:桌面版 side panel 目前顯示的內容;null 代表收合(主區全寬)。
// 'demo-cards'/'demo-row':試做用的推薦景點呈現方式(假資料,見
// RecommendedPlaces.tsx)。'demo-onagent':「LLM 呼叫前端 tool」走 onagent
// 平台的試做(見 clienttools/OnagentBridgeDemo.tsx 的說明;原本另有一條走
// tripace 自家 want 框架的 ClientToolsBridge/clienttools_ws.go 路徑,隨
// want 對話系統整套移除已一併刪除)。這幾個模式各自由獨立的 DEMO_*_ENABLED
// 編譯時 feature flag 控制是否出現(見下方說明),不是綁在同一個開關底下。
// (原本還有 'demo-map'——推薦景點地圖試做,見 RecommendedPlacesMap.tsx——
// 已整個移除,含入口與實作。)
// 'trips'/'timeline'/'pace'/'geo-outline':正式導覽項目,所有使用者都能在
// rail 上看到(依各自的 *_ENABLED flag),渲染邏輯直接使用 DesktopTripList/
// MultiTrackTimeline/PaceChart+PaceRouteMap、GeoCandidateSidebar/
// GeoOutlinePanel,見 DesktopLayout.tsx / PhoneContent.tsx /
// PhoneNavDrawer.tsx,不屬於這組共用的 demo 面板(DemoPanelContent)。
// 'demo-route-editor':旅程分享/路徑編輯器試做(見 docs/ 同一輪討論的
// 雜誌式編輯介面構想與 artifact mockup)——目前只做右側雜誌內容編輯區
// (純前端假資料,不呼叫任何 API,見 RouteEditor.tsx 開頭的說明),左側
// 常駐地圖與後端 schema 都尚未設計,故歸在 demo-* 這組試做面板底下
// (DEMO_ROUTE_EDITOR_ENABLED,見下方),不是正式導覽項目——等資料結構
// 定案、真的接上後端,才會比照 pace/geo-outline 升級成正式功能。
export type PanelMode =
  | 'trips' | 'timeline' | 'pace' | 'geo-outline'
  | 'demo-cards' | 'demo-row' | 'demo-onagent' | 'demo-route-editor'
  | null

// GEO_OUTLINE_ENABLED:地理輪廓底圖(規劃分頁)功能開關——目前是唯一
// 預設開啟的正式功能(未設定部署環境變數 VITE_FEATURE_GEO_OUTLINE 時,
// 一律視為開啟),只有明確設為字串 "false" 才關閉。開啟時 DesktopRail
// 渲染「規劃」按鈕(見該元件),isPanelMode 承認 'geo-outline' 是合法值;
// 關閉時兩者都會擋下,即使手動打 /app/geo-outline 網址也會 fallback 回
// 'trips'(對齊 DesktopContent 對不合法 panelMode 字串的既有 fallback
// 行為,見該處說明)——整套關閉是「進不去這個功能」而不只是「rail 上看
// 不到按鈕」。
export const GEO_OUTLINE_ENABLED = import.meta.env.VITE_FEATURE_GEO_OUTLINE !== 'false'

// TIMELINE_ENABLED/PACE_ENABLED:「時間軸」/「路徑」(配速表)rail 按鈕各自
// 獨立的開關,同 GEO_OUTLINE_ENABLED 的擋法(見上方說明),但預設值相反
// ——兩者預設關閉,只在明確設為字串 "true" 時才啟用。關閉時 rail 不渲染
// 對應按鈕,isPanelMode 也不再承認該字串是合法值,即使手動打 /app/timeline
// 或 /app/pace 網址也會 fallback 回 'trips',不只是找不到入口。兩者分開
// 成獨立旗標(而非合併成一個),是因為兩個功能彼此獨立,部署時可能只想開
// 其中一個。
export const TIMELINE_ENABLED = import.meta.env.VITE_FEATURE_TIMELINE === 'true'
export const PACE_ENABLED = import.meta.env.VITE_FEATURE_PACE === 'true'

// DEMO_CARDS_ENABLED/DEMO_ROW_ENABLED/DEMO_ONAGENT_ENABLED/
// DEBUG_PANEL_ENABLED:原本綁在網址參數 ?demo(見 main.tsx 的 isDemo)底下
// 的試做用導覽項目(推薦景點卡片/橫滑兩種呈現方式、onagent 平台的 LLM
// 呼叫前端 tool 資料流試做、API/WS 狀態除錯面板),改成跟
// TIMELINE_ENABLED/PACE_ENABLED 同一種編譯時 feature flag 機制——各自獨立
// 開關而非沿用單一 isDemo 布林值,是因為部署時可能只想開放其中幾項給特定
// 環境驗證,不是全開或全關兩種選擇。同 TIMELINE_ENABLED/PACE_ENABLED,
// 預設關閉,只在明確設為字串 "true" 時才啟用。(原本還有
// DEMO_CLIENTTOOLS_ENABLED——tripace 自家 want 框架 ClientToolsBridge 的
// 試做入口——隨 want 對話系統整套移除已一併刪除。)
export const DEMO_CARDS_ENABLED = import.meta.env.VITE_FEATURE_DEMO_CARDS === 'true'
export const DEMO_ROW_ENABLED = import.meta.env.VITE_FEATURE_DEMO_ROW === 'true'
export const DEMO_ONAGENT_ENABLED = import.meta.env.VITE_FEATURE_DEMO_ONAGENT === 'true'
export const DEBUG_PANEL_ENABLED = import.meta.env.VITE_FEATURE_DEBUG_PANEL === 'true'
// DEMO_ROUTE_EDITOR_ENABLED:路徑編輯器試做的開關,同上面幾個 DEMO_*
// 一套機制——預設關閉,只在明確設為字串 "true" 時才啟用。
export const DEMO_ROUTE_EDITOR_ENABLED = import.meta.env.VITE_FEATURE_DEMO_ROUTE_EDITOR === 'true'

// PanelSlot/PanelSpec/PANEL_REGISTRY:每個 panelMode 的版面行為單一定義處
// ——'float' 表示疊在 .desktop-main(地圖)上方的浮動卡片(不佔 flex 版面
// 空間、不擠壓地圖寬度),'main-replace' 表示整個取代 .desktop-main(僅
// demo-cards/demo-row/demo-onagent/demo-route-editor 這幾個預設關閉的
// 試做功能維持這個舊行為)。width 只有 float 用到,決定浮動卡片寬度
// (見 styles-desktop.css 的 .floating-panel)。requiresTrip 給 rail 按鈕
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
  'geo-outline': { enabled: GEO_OUTLINE_ENABLED, slot: 'float', width: 380 },
  'demo-cards': { enabled: DEMO_CARDS_ENABLED, slot: 'main-replace' },
  'demo-row': { enabled: DEMO_ROW_ENABLED, slot: 'main-replace' },
  'demo-onagent': { enabled: DEMO_ONAGENT_ENABLED, slot: 'main-replace' },
  'demo-route-editor': { enabled: DEMO_ROUTE_EDITOR_ENABLED, slot: 'main-replace' },
}

// PANEL_MODES:PanelMode 扣掉 null 之後的合法字串值列表——給 isPanelMode()
// 在執行期驗證用(型別系統只在編譯期擋得住,URL 路徑參數是使用者可任意
// 輸入的字串,需要執行期白名單檢查)。從 PANEL_REGISTRY 衍生,不再手動
// 條列——新增/移除模式只需要改上面那張表。
const PANEL_MODES = (Object.keys(PANEL_REGISTRY) as Exclude<PanelMode, null>[])
  .filter((m) => PANEL_REGISTRY[m].enabled)

// isPanelMode:驗證 URL 路徑參數(/app/:panelMode,見 App.tsx)是不是合法的
// PanelMode 字串。使用者可能手動輸入或分享一個帶著錯字/過期參數的網址
// (例如改名前的 'demo-pace' 或亂打的字串),這種不合法輸入不能直接當作
// PanelMode 使用,否則後面 panelMode === 'xxx' 的判斷全部落空、side panel
// 卡在一個「看起來選了某個 rail 按鈕、實際上什麼都不顯示」的中間態。
export function isPanelMode(v: string | undefined): v is Exclude<PanelMode, null> {
  return v != null && (PANEL_MODES as readonly string[]).includes(v)
}

// DemoPanelMode:PanelMode 扣掉 trips/timeline/pace/geo-outline/
// demo-route-editor/null 之後只剩的 3 種 demo 面板——正式功能
// (trips/timeline/pace/geo-outline)在桌面版是 side panel 的正式功能,
// 手機版則是 PhoneNavDrawer(見該檔案)裡對應的分頁,兩邊各自處理,不算
// 在這組共用的 demo 面板裡。demo-route-editor 雖然也是 demo-* 系列旗標
// (見 DEMO_ROUTE_EDITOR_ENABLED),但只做桌面版(見路徑編輯器介面構想
// 討論——手機先只做瀏覽別人的路徑,不做編輯),不透過這組手機/桌面共用
// 的 DemoPanelContent 渲染,改在 DesktopLayout.tsx 的 <main> 分支裡直接
// 特殊處理(同 pace/geo-outline 的作法),PhoneNavDrawer 不提供對應分頁。
export type DemoPanelMode = Exclude<PanelMode, 'trips' | 'timeline' | 'pace' | 'geo-outline' | 'demo-route-editor' | null>

// DrawerMode:手機版分頁列(PhoneTabBar.tsx 底部常駐 + PhoneSideTools.tsx
// 右側小圖示)/主顯示區可切換到的模式——即 PanelMode 扣掉 null 與
// demo-route-editor(該模式只有桌面版路徑編輯器試做才有實作,見
// DEMO_ROUTE_EDITOR_ENABLED 的說明,手機版故意不支援,網址落在
// /app/demo-route-editor 時 fallback 回 'geo-outline')。原本定義在
// PhoneNavDrawer.tsx,搬到這裡與 PanelMode 收斂在同一份檔案,避免兩份
// 值域各自維護、日後新增/移除模式時漏改其中一處。
export type DrawerMode = Exclude<PanelMode, 'demo-route-editor' | null>

// DemoPanelContent 函式本體已移到 demo/DemoPanelContent.tsx——三種模式
// (demo-cards/demo-row/demo-onagent)都是預設關閉的試做功能,不算正式
// 桌面/手機共用邏輯,理由同 RouteEditor.tsx 移到 demo/ 目錄。這裡的
// DemoPanelMode 型別維持不動(從 PanelMode 衍生,被 PANEL_REGISTRY/
// isPanelMode 等正式邏輯依賴)。

// LangSelect/TokenDisplay 已移到 user/LangSelect.tsx、user/TokenDisplay.tsx
// ——兩者都是設定畫面(SettingsDialog 桌面版/SettingsScreen 手機版)專用的
// UI 小塊,不是桌面/手機共用的正式邏輯,理由同 DemoPanelContent/
// RouteEditor 移到 demo/ 目錄。
