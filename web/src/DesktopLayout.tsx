import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { ApiCall, WsEvent } from './api'
import { onApiCall, onWsEvent } from './api'
import { ChatScreen } from './chat/ChatScreen'
import type { DesktopTimelineMirror } from './chat/ChatScreen'
import { MultiTrackTimeline, type TaskPlaceholder } from './timeline/Timeline'
import { PaceChart } from './pace/PaceChart'
import { DemoPanel } from './demo/DemoPanel'
import { GeoHotelSidebar } from './geo-planning/GeoHotelSidebar'
import { GeoInfoPanel } from './geo-planning/GeoInfoPanel'
import { AttractionInfoPanel } from './geo-planning/AttractionInfoPanel'
import { GeoCandidateSidebar, type GeoCandidate } from './geo-planning/GeoCandidateSidebar'
import { createEntryFromCandidate } from './geo-planning/geoCandidateHelpers'
import { AddFromCandidateSidebar, dayGroupLabel } from './geo-planning/AddFromCandidateSidebar'
import { GeoOutlinePanel } from './geo-planning/GeoOutlinePanel'
import { useGeoPlanningState } from './geo-planning/useGeoPlanningState'
import { placesQueryRadiusMeters } from './geo-planning/geoAttractionClick'
import type { GeoAttraction } from './api'
import { type ContentProps } from './AppCommon'
import { type PanelMode, isPanelMode, DEBUG_PANEL_ENABLED, PANEL_REGISTRY } from './DesktopShared'
import { DemoPanelContent } from './demo/DemoPanelContent'
import { RouteEditor } from './demo/RouteEditor'
import { DesktopRail } from './DesktopRail'
import { FloatingPanel } from './FloatingPanel'
import { PanelHead } from './PanelHead'
import { DesktopTripList } from './trip/DesktopTripList'
import { SettingsDialog } from './user/SettingsDialog'
import { TripManageModal } from './trip/TripManageModal'
import type { Trip } from './trip/types'
import './desktop-layout-shell.css'
import styles from './DesktopLayout.module.css'

// DesktopLayout:桌面版(寬度 >= 768px)專屬佈局元件——左側邊欄(旅程列表 +
// 使用者選單)+ 右側 ChatScreen 主要區塊,類似 Slack/Discord 的旅程側欄
// 模式。PanelMode/DemoPanelContent/LangSelect/TokenDisplay/useTripsState
// 這些「桌面/手機共用」的部分不在這裡,分別在 DesktopShared.tsx/
// AppCommon.tsx——避免這裡跟手機版檔案(PhoneContent.tsx/PhoneNavDrawer.tsx/
// PhoneScreens.tsx)互相 import 對方造成循環依賴。

// 時間軸鏡像資料的初始值(尚未收到 ChatScreen 鏡像前,或未選擇旅程時使用)。
const EMPTY_TIMELINE_MIRROR: DesktopTimelineMirror = {
  entries: [],
  updatingEntryIDs: new Set<string>(),
  taskPlaceholders: [] as TaskPlaceholder[],
  refetchEntries: () => {},
}

// hotelInfoContent/placeInfoContent/poiInfoContent/candidateInfoContent/
// geocodeCandidateInfoContent 已抽到 geo-planning/geoInfoContent.ts,
// 桌面版/手機版共用同一份。

export function DesktopContent(props: ContentProps) {
  const { cfg, activeTrip, setActiveTrip } = props
  // settingsOpen 獨立於 DesktopUserMenu 內部的 popover 開關狀態:選單裡點「設定」
  // 時會同時關閉 popover(DesktopUserMenu 內部 state)並開啟這裡的 dialog。
  // dialog 提升到這一層(而非渲染在 DesktopUserMenu/側欄內部)渲染,是因為
  // .desktop-layout 設有 overflow: hidden,side bar 寬度也只有 272px——
  // 若 dialog 渲染在側欄內部,置中/覆蓋全畫面的彈窗會被側欄裁切或擠壓變形。
  // 提升到這裡、和 .desktop-layout 同層,搭配 CSS 的 position: fixed 疊加,
  // 才能保證 dialog 蓋住整個桌面版佈局(含側欄)最上層。
  const [settingsOpen, setSettingsOpen] = useState(false)
  // manageTrip:旅程管理彈窗(分享連結/成員/開啟時自動進入,見
  // TripManageModal.tsx)——原本分成 shareTrip/membersTrip 兩個獨立彈窗,
  // 現在合併成一個彈窗、一個觸發來源(旅程列表每一筆項目的「管理」按鈕,
  // 見 DesktopTripList.tsx 的 onManage)。存「哪個旅程」而非布林值,因為
  // 觸發來源是清單裡任一筆,不一定是 activeTrip。跟 settingsOpen 一樣
  // 提升到這一層渲染(理由同上方 settingsOpen 的說明:避免被 272px 寬的
  // 浮動卡片裁切)。
  const [manageTrip, setManageTrip] = useState<Trip | null>(null)
  // panelMode:rail/side panel 的狀態改由網址驅動(/app/:panelMode,見 App.tsx),
  // 不再是這一層自己的 useState——這樣瀏覽器上一頁/下一頁、重新整理、分享連結
  // 都能還原到對應的 side panel/main 畫面。navigate 的部分見下方 setPanelMode。
  //
  // 「收合」(panelMode === null)現在直接對應 /app 無參數本身,不再需要
  // 獨立的路徑片段(先前用過 /app/none)——側欄收合時主顯示區改直接呈現
  // 規劃地圖(見下方 activeTrip 分支的說明),不再是空畫面,所以「一進 App
  // 預設落地的網址」跟「側欄收合」可以是同一個狀態,不需要分開表示法。
  // 網址帶了不合法的 panelMode 字串(不在 PanelMode 列表)時,同樣視為
  // 收合——理由同上,收合狀態本身已經有明確畫面可看(地圖),不需要再
  // fallback 到旅程列表當「看得懂的畫面」。
  const { panelMode: panelModeParam } = useParams<{ panelMode?: string }>()
  const panelMode: PanelMode =
    panelModeParam == null ? null : isPanelMode(panelModeParam) ? panelModeParam : null
  const navigate = useNavigate()
  // setPanelMode:取代原本的 useState setter,改成 navigate 到對應路徑。
  // 再點一次目前啟用中的圖示會收合 panel,導向 /app(無參數,見上方
  // panelMode 的說明)。
  const setPanelMode = useCallback((mode: Exclude<PanelMode, null>) => {
    navigate(panelMode === mode ? '/app' : `/app/${mode}`)
  }, [navigate, panelMode])
  // chatPopoverOpen:地圖右上角城市搜尋框旁 AI 按鈕觸發的對話浮動小匡
  // 開關——沒有常駐對話欄,ChatScreen 只在這個小匡開啟時才掛載(見下方
  // render 邏輯),這是使用者存取對話功能的唯一入口。
  const [chatPopoverOpen, setChatPopoverOpen] = useState(false)
  // pendingSchedule:使用者在還沒選定旅程時,對某個候選按了日期選擇(見
  // GeoInfoPanel 的 onSchedule)——原本這個情境下 geo.handleScheduleCandidate
  // 內部的 tripID guard 會直接靜默 no-op,浮動匡正常關閉卻完全沒有任何
  // 提示告訴使用者「因為沒有選旅程所以沒加成功」,是實際發生過的 bug。
  // 改成先記住這筆候選+選定的日期,導向旅程列表浮動卡(見下方
  // onSchedule 的說明),使用者選定旅程後(DesktopTripList 的 onOpen)
  // 自動把這筆候選補寫進剛選的旅程,不需要使用者回頭重新走一次「加入
  // 旅程」流程。 */
  const [pendingSchedule, setPendingSchedule] = useState<{ candidate: GeoCandidate; date: string } | null>(null)
  // geo:地理規劃地圖的共用狀態/互動邏輯——選取卡片、地圖移動目標、
  // 候選籃、城市搜尋候選清單、第二側欄相關中介 state 等,見
  // geo-planning/useGeoPlanningState.ts 的完整說明。桌面版/手機版
  // (GeoOutlinePhoneView.tsx)呼叫同一個 hook,不再各自實作一份形狀
  // 相似但容易跑出不一致的版本。
  const geo = useGeoPlanningState({ cfg, tripID: activeTrip?.id })
  const geoSelectedKey = geo.selectedKey
  const geoInfoContent = geo.infoContent
  const geoAttractionContent = geo.attractionContent
  // pendingSchedule 補寫效果:activeTrip 剛被設定(DesktopTripList 的
  // onOpen)且有一筆待補的候選+日期時,直接呼叫 createEntryFromCandidate
  // 寫入剛選定的旅程——不透過 geo.handleScheduleCandidate(該函式的
  // tripID 是從這個元件呼叫 useGeoPlanningState 時傳入的 activeTrip?.id
  // 閉包值,setActiveTrip(t) 剛執行完的同一輪渲染裡還沒有更新到新值,
  // 直接呼叫在同一個 event handler 裡會拿到 stale tripID,見
  // useGeoPlanningState.ts 對這類 stale closure 風險的既有說明),改用
  // useEffect 依賴 activeTrip?.id 本身,保證真的等到新旅程生效後才補寫。
  // 成功後清空 pendingSchedule(避免重複補寫)並觸發 refetchTripEntriesTrigger
  // 讓候選籃/時間軸即時反映這筆新 entry(理由同 handleScheduleCandidate
  // 既有的收尾動作)。寫入失敗只印 console,不清空 pendingSchedule 之外
  // 也不彈錯誤訊息——理由同這個檔案其餘候選寫入失敗的既有慣例(見
  // handleScheduleCandidate 的說明),使用者可以在候選籃裡看到這筆候選
  // 仍停留在「候選中」,自行重試。
  useEffect(() => {
    if (!pendingSchedule || !activeTrip?.id) return
    const { candidate, date } = pendingSchedule
    setPendingSchedule(null)
    createEntryFromCandidate(cfg, activeTrip.id, candidate, date)
      .then(() => {
        geo.setRefetchTripEntriesTrigger((n) => n + 1)
        // 補寫成功後短暫 highlight 行程欄(理由同 onSchedule 已選旅程
        // 分支的既有收尾動作)——onOpen 已經導向 /app/geo-outline(見該
        // 處說明),行程欄這時已經掛載,flashTrigger 才有作用。
        setGeoCandidateFlashTrigger((n) => n + 1)
      })
      .catch((err) => {
        console.error('[DesktopLayout] 選定旅程後補寫候選失敗:', err)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrip?.id])
  // handleExploreAttraction:AttractionInfoPanel「探索周邊」按鈕觸發——
  // 複用 GeoOutlineMap.tsx handleAttractionClick 已有的
  // placesQueryRadiusMeters 決策邏輯算出縮放半徑(優先用該景點區域自己的
  // radiusMeters,單點地標退回 PLACES_QUERY_DEFAULT_RADIUS_METERS),透過
  // geo.panTarget 中介讓地圖 fitBounds 到這個範圍(見 GeoOutlineMap.tsx
  // panTarget.radiusMeters 分支的說明)。跟直接點地圖上的地標
  // (handleAttractionClick)不同的是這裡固定走 fit-bounds,不區分
  // pan-and-zoom——「探索周邊」的使用者意圖本來就是「讓我看看這一整個
  // 區域多大」,即使是沒有 radiusMeters 的單點地標,用預設查詢半徑框出的
  // 範圍也已經是合理的「周邊」大小,不需要再依 level 判斷是否要動 zoom。
  const handleExploreAttraction = useCallback((attraction: GeoAttraction) => {
    geo.setPanTarget({
      lat: attraction.lat,
      lng: attraction.lng,
      radiusMeters: placesQueryRadiusMeters(attraction),
    })
  }, [geo])
  // geoCandidateFlashTrigger:候選籃浮動卡片(GeoCandidateSidebar,見下方
  // panelSpec.slot === 'float' 的 'geo-outline' 分支)「剛加入東西了」的
  // 視覺提示觸發器——每次遞增觸發一次短暫的 highlight 動畫(見
  // GeoCandidateSidebar.module.css 的 .panelFlash)。之所以需要這個,而不是
  // 直接「展開/收合」卡片:GeoInfoPanel 複合按鈕只在 panelMode ===
  // 'geo-outline' 底下能被按到,而 GeoCandidateSidebar 在同一個條件下已經
  // 展開顯示,沒有獨立的「收合/展開」開關能在這個情境下額外觸發——用
  // 遞增計數器(而非 boolean)是因為使用者可能連續加入好幾個候選,即使
  // 卡片的 flash 動畫還沒播完,遞增值仍能保證每次都是新的 useEffect
  // 依賴值、重新觸發一次動畫(boolean 在連續兩次都設成 true 時不會變動,
  // 不會重新觸發)。這是桌面版專屬的視覺提示,不在 useGeoPlanningState
  // 共用範圍內(手機版加入候選後改成直接打開候選籃抽屜,見
  // GeoOutlinePhoneView.tsx 的 handleAddCandidate)。
  const [geoCandidateFlashTrigger, setGeoCandidateFlashTrigger] = useState(0)
  // addGeoCandidateAndReveal:GeoInfoPanel 複合按鈕右半邊(PanelLeft icon)
  // 觸發——跟左半邊 geo.addCandidate 一樣單純加入候選籃(同一份去重邏輯,
  // 不涉及日期選擇),額外多做的事只有讓候選籃側欄短暫 highlight 一下,
  // 提示使用者「加進去了,去左邊看」(側欄本身在這個情境下必然已經展開,
  // 詳見 geoCandidateFlashTrigger 的說明)。
  const addGeoCandidateAndReveal = useCallback((c: GeoCandidate) => {
    geo.addCandidate(c)
    setGeoCandidateFlashTrigger((n) => n + 1)
  }, [geo])
  // geoSearchCity/geoSearchTrigger:城市搜尋欄的狀態,UI 渲染在
  // GeoOutlineMap.tsx(地圖左上角類別標籤列旁),查詢邏輯留在
  // GeoOutlinePanel.tsx(見該檔案的說明)——兩者是分開掛載的 sibling,
  // 只能靠這層 state 中介。geoSearchTrigger 每次遞增觸發一次查詢(見
  // GeoOutlinePanel 的 searchTrigger prop 說明)。查詢中/錯誤狀態
  // (searching/error)由 GeoOutlinePanel 內部直接轉給 GeoOutlineMap
  // 顯示,不需要再往上層回報,故這裡不持有對應 state。
  const [geoSearchCity, setGeoSearchCity] = useState('')
  const [geoSearchTrigger, setGeoSearchTrigger] = useState(0)
  // timelineMirror:ChatScreen 透過 desktopChat.onTimelineData 鏡像過來的時間軸資料
  // (entries/updatingEntryIDs/taskPlaceholders/refetchEntries)。ChatScreen 是這份
  // 資料唯一的擁有者(它的 WS 連線即時維護這些 state),這裡只是接住鏡像後轉交給
  // side panel 的 MultiTrackTimeline,不可以自己另外 fetch 或開第二條 WS。
  const [timelineMirror, setTimelineMirror] = useState<DesktopTimelineMirror>(EMPTY_TIMELINE_MIRROR)
  const todayRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement)

  // showDebugPanel/calls/wsEvents:原本 DebugApp.tsx(?debug 獨立工作台)裡的
  // API/WS 狀態面板,併入正式 App 後改成只在 DEBUG_PANEL_ENABLED 開啟時、由
  // rail 上一顆獨立按鈕切換顯示的附加面板(不佔用 panelMode 的三態切換,
  // 因為它要能疊加顯示、不取代 side panel 或 .desktop-main 的內容——見下方
  // 渲染邏輯)。
  // onApiCall/onWsEvent 訂閱本身沒有開銷(見 api.ts),即使面板收合也持續
  // 累積,收合後重新展開不會漏掉收合期間發生的紀錄。
  const [showDebugPanel, setShowDebugPanel] = useState(false)
  const [debugCalls, setDebugCalls] = useState<ApiCall[]>([])
  const [debugWsEvents, setDebugWsEvents] = useState<WsEvent[]>([])
  useEffect(() => onApiCall((c) => setDebugCalls((prev) => [c, ...prev].slice(0, 100))), [])
  useEffect(() => onWsEvent((e) => setDebugWsEvents((prev) => [e, ...prev].slice(0, 100))), [])
  // panelSpec:目前 panelMode 對應的版面設定(見 DesktopShared.tsx 的
  // PANEL_REGISTRY)——null(收合)或 undefined(理論上不會發生,panelMode
  // 已經過 isPanelMode 驗證)時視為沒有 spec。這裡集中算一次,下方 rail/
  // main 區/浮動卡片渲染都從這個值分支,不再各自重複 panelMode === 'x'
  // 字串比對。
  const panelSpec = panelMode ? PANEL_REGISTRY[panelMode] : undefined

  // 切換旅程時,先清空鏡像資料,避免新旅程的 ChatScreen 還沒送出第一次鏡像前,
  // side panel 短暫顯示上一個旅程的時間軸內容。
  useEffect(() => {
    setTimelineMirror(EMPTY_TIMELINE_MIRROR)
  }, [activeTrip?.id])

  // 離開規劃分頁或切換旅程時收起第二側欄——pickingDayKey 記的是「已排入
  // 行程」某一天的日期字串,離開 geo-outline 或換了旅程後,這個日期分組
  // 可能已經不存在(或屬於別的旅程),繼續開著會讓使用者選到的候選建立
  // 到一個已經看不到脈絡的日期,故一併清空。
  useEffect(() => {
    geo.setPickingDayKey(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelMode, activeTrip?.id])

  const onTimelineData = useCallback((data: DesktopTimelineMirror) => {
    setTimelineMirror(data)
  }, [])
  // desktopChat:傳給 ChatScreen 的物件必須記憶化(useMemo),不能直接在 JSX
  // 寫 desktopChat={{ onTimelineData }} 物件字面量——那樣每次 DesktopContent
  // 重新渲染都會建立一個新參照,即使 onTimelineData 本身(已用 useCallback
  // 包過)沒變。ChatScreen 內鏡像時間軸資料的 useEffect 依賴陣列裡有整個
  // desktopChat 物件,參照每次都不同會讓該 effect 每次渲染都重新執行 →
  // 呼叫 onTimelineData → setTimelineMirror → 觸發本元件重新渲染 → 產生新的
  // desktopChat 物件 → 無窮迴圈(實測會直接跳出 React 的
  // "Maximum update depth exceeded" 警告)。用 useMemo 讓這個物件只在
  // onTimelineData 真的變動時才換參照,打斷這個迴圈。
  const desktopChat = useMemo(() => ({ onTimelineData }), [onTimelineData])

  // geoHotelSidebarVisible:跟下方 GeoHotelSidebar 實際渲染的條件完全
  // 一致——GeoInfoPanel/AttractionInfoPanel 都定位在 .desktop-main 右緣
  // (見 GeoInfoPanel.module.css/AttractionInfoPanel.module.css 的
  // .panel),GeoHotelSidebar 有內容時會漂浮在同一個位置(見
  // DesktopLayout.module.css 的 .right),兩張卡片需要知道
  // 要不要往左避讓(見兩者的 shiftBy prop 說明)。抽成一個變數,避免
  // 下方兩處 JSX 各自重複同一段條件判斷式、之後改其中一處忘了同步另一處。
  //
  // 不再檢查 panelMode === 'geo-outline'——地圖(GeoOutlineMap)上的類別
  // 標籤(飯店/景點/餐廳)不論目前是哪個 panelMode 都可以按到(地圖是
  // 主顯示區固定內容),先前這裡多檢查 panelMode 會導致「在其他 panelMode
  // 下按類別標籤查詢,geoHotels/geoPlaces 明明已經有資料,清單卻不會跳
  // 出來」的 bug(使用者需要先手動切到「規劃」panelMode 才看得到剛查到
  // 的結果)。查詢本身要不要顯示只看有沒有內容,跟目前主顯示區在哪個
  // panelMode 無關。
  const geoHotelSidebarVisible = geo.searchResults.length > 0
  // infoPanelShiftBy:GeoInfoPanel/AttractionInfoPanel 右緣可能同時要
  // 避開兩種東西——GeoHotelSidebar(飯店清單,.right)
  // 與對話浮動小匡(styles.chatPopover,見 chatPopoverOpen)。兩者寬度
  // 已統一為 340px(見 FloatingPanel/GeoInfoPanel.module.css 的說明),
  // 但起始 right 偏移不同(GeoHotelSidebar 12px、對話小匡 16px),換算
  // 出來對話小匡佔用範圍略往左多 4px,兩者都存在時優先避開較寬的那個,
  // 不是疊加兩者的偏移量——資訊卡只需要跟「當下右緣實際佔用最多寬度的
  // 東西」錯開,不需要真的把兩個偏移量加總(那樣會把卡片推到不必要的
  // 更左邊)。'none' 代表右緣沒有東西需要避開,維持貼齊 16px。
  const infoPanelShiftBy: 'none' | 'hotel' | 'chat' =
    chatPopoverOpen ? 'chat' : geoHotelSidebarVisible ? 'hotel' : 'none'

  return (
    <>
      <div className="desktop-layout">
        <DesktopRail
          panelMode={panelMode}
          onSelect={setPanelMode}
          activeTrip={!!activeTrip}
          user={props.user}
          isGuest={props.isGuest}
          cfg={cfg}
          onAuthed={props.onAuthed}
          onLogout={props.onLogout}
          onOpenSettings={() => setSettingsOpen(true)}
          showDebugPanel={showDebugPanel}
          onToggleDebugPanel={() => setShowDebugPanel((v) => !v)}
        />
        <main className="desktop-main">
          {geo.pickingDayKey && (
            // side="left" 只是借用左緣的 top/z-index/陰影等視覺語言,實際
            // 水平位置用 style.left 覆蓋——使用者明確要求候選卡並排顯示
            // 在行程欄(GeoCandidateSidebar,geo-outline 模式寬度固定
            // 380px,見 PANEL_REGISTRY)右側,不是取代它。12(行程欄左緣
            // 間距)+ 380(行程欄寬度)+ 12(兩卡之間的間距)= 404px。
            // pickingDayKey 只在 panelMode === 'geo-outline' 時才可能有值
            // (見 handlePickFromCandidate 的觸發來源),故這裡不需要依
            // panelMode 動態換算寬度,直接寫死對應這個模式的寬度即可。
            <FloatingPanel side="left" width={272} style={{ left: 404 }}>
              <AddFromCandidateSidebar
                dayLabel={dayGroupLabel(geo.pickingDayKey)}
                candidates={geo.onlyCandidates}
                onRemove={(c) => geo.handleRemoveCandidate(c, 'AddFromCandidateSidebar')}
                onPick={geo.handlePickFromCandidate}
                onHover={geo.setHoverKey}
                onDragStart={geo.setDraggingCandidate}
                onDragEnd={() => geo.setDraggingCandidate(null)}
                onClose={() => geo.setPickingDayKey(null)}
              />
            </FloatingPanel>
          )}
          {panelSpec?.slot === 'main-replace' ? (
            panelMode === 'demo-route-editor' ? (
              // demo-route-editor 不透過 DemoPanelContent(見該常數在
              // DesktopShared.tsx 的說明——只做桌面版,手機版 PhoneNavDrawer
              // 不提供對應分頁),直接在這裡渲染。
              <RouteEditor />
            ) : (
              <DemoPanelContent mode={panelMode as Exclude<PanelMode, 'trips' | 'timeline' | 'pace' | 'geo-outline' | 'demo-route-editor' | null>} />
            )
          ) : (
            // main-replace 以外的所有情況(含 panelMode === null、'trips'/
            // 'timeline'/'pace'/'geo-outline'):主顯示固定是規劃地圖——
            // 這四種正式功能現在改成浮動卡片疊加在地圖上(見下方
            // DesktopLayout.module.css 的 .panel),不再取代主顯示,故這裡不需要再檢查
            // activeTrip/panelMode 的組合,地圖永遠掛載。
            <>
              <GeoOutlinePanel
                cfg={cfg}
                tripID={activeTrip?.id ?? null}
                city={geoSearchCity}
                onCityChange={setGeoSearchCity}
                onSearch={() => {
                  // 重新搜尋時清空目前選取的地點,關閉正在顯示的地點
                  // 介紹卡——使用者發起新的城市搜尋通常代表要換一個地方
                  // 看,舊的資訊卡若繼續顯示,容易讓人誤以為卡片內容跟這次
                  // 新搜尋結果有關聯。geo.clearSelection 一次涵蓋
                  // selectedKey/infoContent/attractionContent 三者(見
                  // geo-planning/geoSelection.ts 的說明)——這裡曾經只清
                  // 其中一個 state、資訊卡沒有跟著真的關閉,改成單一
                  // reducer 後不會再有「清一半」的中間態。
                  geo.clearSelection()
                  setGeoSearchTrigger((n) => n + 1)
                }}
                onOpenChat={() => setChatPopoverOpen(true)}
                searchTrigger={geoSearchTrigger}
                refetchTripEntriesTrigger={geo.refetchTripEntriesTrigger}
                onSearchResultsChange={geo.setSearchResults}
                externalGeocodeCandidateSelect={geo.searchResultSelect}
                onTripEntriesChange={geo.onTripEntriesChange}
                onAttractionSelect={geo.selectAttraction}
                onSearchResultSelect={geo.selectSearchResult}
                onPoiSelect={geo.selectPoi}
                onGeocodeCandidateText={(_placeId, text) => geo.patchGeocodeCandidateText(text)}
                onGeocodeCandidatePhoto={(_placeId, photoUrl) => geo.patchGeocodeCandidatePhoto(photoUrl)}
                selectedKey={geoSelectedKey}
                candidateKeys={geo.candidateKeys}
                hoverKey={geo.hoverKey}
                panTarget={geo.panTarget}
              />
              <GeoInfoPanel
                content={geoInfoContent}
                onClose={geo.clearSelection}
                onAddCandidate={geo.addCandidate}
                onAddAndReveal={addGeoCandidateAndReveal}
                onSchedule={(c, date) => {
                  // activeTrip 為空時 geo.handleScheduleCandidate 內部會
                  // 直接 no-op(見該函式的 tripID guard)——原本使用者點了
                  // 日期、浮動匡正常關閉,卻完全沒有任何提示告訴他「因為
                  // 沒有選旅程所以沒加成功」,是實際發生過的 bug。改成
                  // 沒有 activeTrip 時先記住這筆候選+日期(pendingSchedule)
                  // 再開啟旅程列表浮動卡(同點 rail「旅程列表」按鈕),
                  // 使用者選定旅程後(見下方 DesktopTripList 的 onOpen)
                  // 自動補寫進去,不需要使用者回頭重新走一次「加入行程」
                  // 流程。刻意直接呼叫 navigate,不透過 setPanelMode——
                  // trips 是 float 面板,可能跟 GeoInfoPanel 同時顯示
                  // (例如使用者原本就開著旅程列表、又點了地圖上的地點),
                  // 此時 panelMode 已經是 'trips',setPanelMode('trips')
                  // 的 toggle 邏輯(再點一次同個 mode 會收合)反而會把它
                  // 關掉,是實際發生過的 bug——跟下方 onSchedule 成功寫入
                  // 分支刻意改用 navigate 而非 setPanelMode 的理由完全
                  // 相同。
                  if (!activeTrip) {
                    setPendingSchedule({ candidate: c, date })
                    navigate('/app/trips')
                    return
                  }
                  geo.handleScheduleCandidate(c, date, 'DesktopLayout')
                  // 加入成功後展開行程欄(GeoCandidateSidebar,見下方
                  // panelSpec.slot === 'float' 的 'geo-outline' 分支)並
                  // 觸發短暫 highlight,理由同 addGeoCandidateAndReveal——
                  // 使用者選日期加入後應該能立刻看到剛加的項目,不用自己
                  // 再點一次 rail「規劃」按鈕才看得到。跟 addGeoCandidateAndReveal
                  // 不同的是:onSchedule 這條路徑不像複合按鈕只在
                  // panelMode === 'geo-outline' 時才能被按到,GeoInfoPanel
                  // 在任何 panelMode 下都可能顯示,故這裡額外導向
                  // /app/geo-outline 確保行程欄真的有掛載,flashTrigger
                  // 才有作用(欄位沒掛載時單純遞增計數器不會有任何視覺
                  // 效果)。刻意直接呼叫 navigate,不透過 setPanelMode——
                  // setPanelMode 對「目前已經是這個 mode」的情況會 toggle
                  // 收合(見該函式的說明,是給 rail 按鈕「再點一次收合」
                  // 這個互動設計的),若使用者本來就開著行程欄再呼叫
                  // setPanelMode('geo-outline') 反而會把它關掉,這是實際
                  // 發生過的 bug。 */
                  navigate('/app/geo-outline')
                  setGeoCandidateFlashTrigger((n) => n + 1)
                }}
                scheduledDates={geo.scheduledDates}
                shiftBy={infoPanelShiftBy}
              />
              <AttractionInfoPanel
                attraction={geoAttractionContent}
                onClose={geo.clearSelection}
                onExplore={handleExploreAttraction}
                shiftBy={infoPanelShiftBy}
              />
            </>
          )}
          {/* panelMode 浮動卡片:trips/timeline/pace/geo-outline 這四種正式
              功能的內容(見 PANEL_REGISTRY 的 slot: 'float'),疊在地圖左緣
              上方,不佔用 flex 版面空間、不推擠地圖——沿用跟
              AddFromCandidateSidebar/GeoHotelSidebar 一致的 FloatingPanel
              外殼。不傳 title——四種內容元件(DesktopTripList/
              MultiTrackTimeline/PaceChart/GeoCandidateSidebar)各自 header
              排版不同,不逐一加專屬標題,FloatingPanel 只在右上角疊加共用
              的關閉按鈕,導回 /app 收起卡片(同再點一次 rail 圖示的行為)。
              pickingDayKey 有值時,AddFromCandidateSidebar(見下方)改成
              並排顯示在這張卡片右側,不再互斥——使用者明確要求「候選要
              出現在行程右邊,不是替換」,兩張卡同時可見,不需要先關掉
              候選卡才能看到行程欄剩餘內容。 */}
          {panelSpec?.slot === 'float' && (
            <FloatingPanel side="left" width={panelSpec.width ?? 380} onClose={() => navigate('/app')}>
              {panelMode === 'trips' ? (
                <DesktopTripList
                  cfg={cfg}
                  activeTripID={activeTrip?.id ?? null}
                  onOpen={(t) => {
                    setActiveTrip(t)
                    // pendingSchedule 有值代表使用者是因為選日期加入行程、
                    // 但當時還沒選定旅程才被導來這裡(見 onSchedule 的
                    // 說明)——選定後應該直接展開「行程」欄
                    // (geo-outline,GeoCandidateSidebar)讓使用者立刻看到
                    // 補寫進去的那筆候選,不能沿用一般選旅程時「收起浮動
                    // 卡回到預設畫面」的行為,否則使用者選完旅程後畫面
                    // 直接收合,完全看不到剛才那筆候選有沒有加成功。
                    // pendingSchedule 補寫本身由下方 useEffect 依賴
                    // activeTrip?.id 觸發,這裡只負責導覽,不重複寫入。
                    navigate(pendingSchedule ? '/app/geo-outline' : '/app')
                  }}
                  onManage={setManageTrip}
                />
              ) : panelMode === 'timeline' ? (
                <div className={styles.timelinePanel}>
                  <PanelHead title="時間軸" />
                  <div className={styles.timelineScroll}>
                    {!activeTrip ? (
                      <div className="empty">選擇一趟旅程後顯示時間軸。</div>
                    ) : timelineMirror.entries.length === 0 ? (
                      <div className="empty">尚無行程內容。</div>
                    ) : (
                      <MultiTrackTimeline
                        entries={timelineMirror.entries}
                        todayRef={todayRef}
                        updatingIDs={timelineMirror.updatingEntryIDs}
                        taskPlaceholders={timelineMirror.taskPlaceholders}
                        cfg={activeTrip.ownerID === props.user.id ? cfg : undefined}
                        onEntryUpdated={timelineMirror.refetchEntries}
                      />
                    )}
                  </div>
                </div>
              ) : panelMode === 'pace' ? (
                <div className={styles.pacePanel}>
                  <PaceChart cfg={cfg} tripID={activeTrip?.id} />
                </div>
              ) : panelMode === 'geo-outline' ? (
                <GeoCandidateSidebar
                  cfg={cfg}
                  tripID={activeTrip?.id}
                  candidates={geo.candidates}
                  onRemove={(c) => geo.handleRemoveCandidate(c, 'GeoCandidateSidebar')}
                  onSelect={geo.selectCandidateFromBasket}
                  onHover={geo.setHoverKey}
                  onDatesAssigned={() => geo.setRefetchTripEntriesTrigger((n) => n + 1)}
                  onReturnToCandidate={(c) => geo.handleReturnToCandidate(c, 'GeoCandidateSidebar')}
                  draggingCandidate={geo.draggingCandidate}
                  onDraggingCandidateChange={geo.setDraggingCandidate}
                  onPickFromCandidate={geo.setPickingDayKey}
                  flashTrigger={geoCandidateFlashTrigger}
                />
              ) : null}
            </FloatingPanel>
          )}
          {/* GeoHotelSidebar(飯店/景點/餐廳合併清單)只在使用者實際觸發過
              查詢後才顯示——geo.searchResults(見 onSearchResultsChange
              的說明)只有按下「搜尋這個區域」、點類別標籤、或點地標才會有
              內容(GeoOutlineMap.tsx 的 queryTrigger === 0 guard,地圖掛載/
              拖曳本身不會查);還是空的代表使用者進到規劃分頁
              後還沒做過任何查詢動作,這時不顯示。不再檢查
              panelMode === 'geo-outline'(見上方 geoHotelSidebarVisible
              的說明,同一個 bug 修復)。使用者明確要求不要壓縮主顯示的
              可用寬度,改成絕對定位疊在 .desktop-main(已有
              position: relative)右緣之上,不佔用 flex 版面空間——理由/
              寫法同左緣的 left side(見 FloatingPanel.tsx)。不傳
              title/onClose——GeoHotelSidebar 自己渲染頂部條(含標題文字+
              關閉按鈕,見該元件的說明),FloatingPanel 這裡只負責定位/
              陰影外殼。 */}
          {geoHotelSidebarVisible && (
            <FloatingPanel side="right" width={340} height="info">
              <GeoHotelSidebar
                cfg={cfg}
                tripID={activeTrip?.id}
                results={geo.searchResults}
                selectedKey={geoSelectedKey}
                onHover={geo.setHoverKey}
                onSelect={(r) => {
                  // 三種來源(飯店/地點/搜尋候選)既然合併成同一份清單,
                  // 點擊行為一律走 selectSearchResultFromList,讓
                  // GeoOutlinePanel 內部呼叫它自己的
                  // handleGeocodeCandidateSelect(含正確的
                  // suppressQuery:false、onlyIfOutOfView 移動地圖、選取
                  // 樣式、開資訊卡),不在這裡重新實作一份簡化版邏輯——
                  // 使用者要求「同一份清單、同一套邏輯」,不再區分
                  // hotel/place 走 onlyIfOutOfView panTarget、geocode 走
                  // 中介 state 兩條不同路徑。
                  geo.selectSearchResultFromList(r)
                }}
                onAddCandidate={geo.addCandidate}
                onCandidateCreated={() => geo.setRefetchTripEntriesTrigger((n) => n + 1)}
                // onClose:手動關閉直接清空 searchResults,不另外加一個
                // dismissed state——理由:資料為空清單本來就會讓
                // geoHotelSidebarVisible 算出 false 而隱藏,下一次查詢
                // (按「搜尋這個區域」、點類別標籤、或城市搜尋)會自然把清單
                // 填回來、重新顯示,不需要額外狀態去追蹤「使用者主動關閉
                // 過」,也不會有「关閉後新查詢卻因為 dismissed 標記仍是 true
                // 而不顯示」這種容易忘記重置的邊界情況。改由 GeoHotelSidebar
                // 自己渲染頂部條(含標題文字+關閉按鈕,見該元件的說明),
                // 這裡不再額外疊加一顆單獨浮動的關閉按鈕。
                onClose={() => geo.setSearchResults([])}
              />
            </FloatingPanel>
          )}
          {/* chat-popover:對話浮動小匡,由地圖右上角城市搜尋框旁的 AI
              按鈕觸發(見 GeoOutlineMap.tsx 的 onOpenChat),疊在搜尋框
              正下方——沒有常駐對話欄,這是使用者存取 ChatScreen 的唯一
              入口(見 chatPopoverOpen 宣告處的說明)。沒有 activeTrip 時
              仍掛載 ChatScreen(trip 不傳,見該元件 trip prop 的說明)——
              使用者不需要先選/建立旅程就能開始對話,不再顯示空狀態擋板。
              key 用 activeTrip?.id ?? 'no-trip',確保「無旅程對話」跟
              「某個旅程的對話」是各自獨立的掛載週期(避免沿用前一個旅程
              殘留的 WebSocket/訊息 state)。 */}
          {chatPopoverOpen && (
            <FloatingPanel
              side="right"
              width={340}
              className={geoHotelSidebarVisible ? `${styles.chatPopover} ${styles.chatPopoverShifted}` : styles.chatPopover}
              onClose={() => setChatPopoverOpen(false)}
            >
              <ChatScreen
                key={activeTrip?.id ?? 'no-trip'}
                cfg={cfg}
                trip={activeTrip ?? undefined}
                user={props.user}
                onBack={() => setActiveTrip(null)}
                desktopChat={desktopChat}
              />
            </FloatingPanel>
          )}
        </main>
        {DEBUG_PANEL_ENABLED && showDebugPanel && (
          <DemoPanel
            calls={debugCalls}
            onClear={() => setDebugCalls([])}
            wsEvents={debugWsEvents}
            onClearWsEvents={() => setDebugWsEvents([])}
            cfg={cfg}
            trip={activeTrip}
            style={{ flex: '0 0 360px', height: '100%' }}
          />
        )}
      </div>
      {settingsOpen && (
        <SettingsDialog
          cfg={cfg}
          user={props.user}
          email={props.email}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {/* manageTrip:旅程管理彈窗(分享連結/成員/開啟時自動進入),原本掛在
          ChatScreen navbar 的三個分散入口(TripMenu/分享按鈕/成員按鈕)
          合併成這一個,搬到旅程列表觸發——用 base-ui.css 既有的
          .rp-modal*(置中卡片彈窗骨架,跟 SettingsDialog 同一套)包住,
          TripManageModal 本身用 .rp-modal-head/.rp-modal-body 渲染內容
          (見該檔案的說明)。提升到這一層渲染,理由同上方 settingsOpen
          的說明。 */}
      {manageTrip && (
        <div className="rp-modal-backdrop" onClick={() => setManageTrip(null)}>
          <div className="rp-modal" onClick={(e) => e.stopPropagation()}>
            <TripManageModal
              cfg={cfg}
              trip={manageTrip}
              isOwner={manageTrip.ownerID === props.user.id}
              onClose={() => setManageTrip(null)}
            />
          </div>
        </div>
      )}
    </>
  )
}
