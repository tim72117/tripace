import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
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
import { haversineMeters, walkMinutesEstimate } from './geo-planning/geoDistance'
import { attractionToInfoContent } from './geo-planning/geoInfoContent'
import { reduceCategoryTagsState, initialCategoryTagsState } from './geo-planning/geoCategoryTagsState'
import type { GeoAttraction } from './api'
import { type ContentProps } from './AppCommon'
import { type PanelMode, isPanelMode, DEBUG_PANEL_ENABLED, PANEL_REGISTRY } from './DesktopShared'
import { DemoPanelContent } from './demo/DemoPanelContent'
import { RouteEditor } from './demo/RouteEditor'
import { DesktopRail } from './DesktopRail'
import { DesktopLayoutShell } from './DesktopLayoutShell'
import { DesktopMain } from './DesktopMain'
import { FloatingPanel } from './components/FloatingPanel'
import { PanelHead } from './components/PanelHead'
import { DesktopTripList } from './trip/DesktopTripList'
import { SettingsDialog } from './user/SettingsDialog'
import { TripManageModal } from './trip/TripManageModal'
import type { Trip } from './trip/types'
import styles from './DesktopLayout.module.css'

// DesktopLayout:桌面版(寬度 >= 768px)專屬佈局元件——左側邊欄(旅程列表 +
// 使用者選單)+ 右側 ChatScreen 主要區塊,類似 Slack/Discord 的旅程側欄
// 模式。PanelMode/DemoPanelContent/LangSelect/TokenDisplay/useTripsState
// 這些「桌面/手機共用」的部分不在這裡,分別在 DesktopShared.tsx/
// AppCommon.tsx——避免這裡跟手機版檔案(PhoneContent.tsx/PhoneNavDrawer.tsx/
// PhoneScreens.tsx)互相 import 對方造成循環依賴。

// NEARBY_ATTRACTION_LIMIT:AttractionInfoPanel「附近景點」清單最多顯示
// 幾筆——見 handleSelectNearbyAttraction/nearbyAttractions 的說明,清單
// 只是給使用者一個「順路可以看什麼」的線索,不是完整清單,故取一個畫面上
// 一眼看得完的小數字。
const NEARBY_ATTRACTION_LIMIT = 5

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
  // DesktopLayoutShell 設有 overflow: hidden,side bar 寬度也只有 272px——
  // 若 dialog 渲染在側欄內部,置中/覆蓋全畫面的彈窗會被側欄裁切或擠壓變形。
  // 提升到這裡、和 DesktopLayoutShell 同層,搭配 CSS 的 position: fixed
  // 疊加,才能保證 dialog 蓋住整個桌面版佈局(含側欄)最上層。
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
  // geoAttractions:GeoOutlineMap 目前查到的景點區域完整清單(即時反映
  // 地圖移動/縮放後重新查詢的結果,見 GeoOutlineMap.tsx onAttractionsChange
  // 的說明)——供下方 nearbyAttractions 算「附近景點」用,不是給地圖繪製
  // 本身用(地圖自己另外依 zoom 做知名度分級篩選,見 useAttractionOverlays.ts
  // 的 filteredAttractions,兩者是分開的兩份資料,這裡拿到的是篩選之前的
  // 原始清單)。
  const [geoAttractions, setGeoAttractions] = useState<GeoAttraction[]>([])
  // nearbyAttractions:離目前錨點最近的 NEARBY_ATTRACTION_LIMIT 個「精選
  // 點」,依距離由近到遠排序——資料來源限定在 geoAttractions(地圖已經
  // 查到、不另發 API,見 docs/handoff-radar-map-prototype-2026-08.md
  // 「附近候選來源」的決策)。
  //
  // 主題點/精選點的區分(2026-08,使用者明確要求):暫不新增後端欄位,
  // 先重用既有的 level——level === 1 視為「主題點」(地圖預設就會顯示,
  // 見 useAttractionOverlays.ts 對 level 1 恆通過的規則),其餘(level
  // 2/3/…)一律視為「精選點」,預設不在地圖上顯示,只有使用者點開某個
  // 主題點(錨點本身 level === 1)後,才依附近距離揭露該主題底下的精選點
  // ——這是純粹的距離篩選(方向 C,見 docs/research-curated-attraction-
  // relationships-2026-08.md 的結論:C 該作為底層能力保留),不是存在
  // 資料庫裡的固定父子關聯。
  //
  // 若目前錨點本身不是主題點(level !== 1,例如使用者直接點了一個已被
  // 揭露的精選點卡片),不計算附近清單——精選點不該再遞迴揭露下一層精選
  // 點,「進入主題」這件事只由主題點觸發。
  const nearbyAttractions = useMemo(() => {
    if (!geoAttractionContent || geoAttractionContent.level !== 1) return []
    return geoAttractions
      .filter((a) => a.level !== 1)
      .filter((a) => !(
        a.name === geoAttractionContent.name
        && a.lat === geoAttractionContent.lat
        && a.lng === geoAttractionContent.lng
      ))
      .map((a) => ({ attraction: a, minutes: walkMinutesEstimate(haversineMeters(geoAttractionContent, a)) }))
      .sort((a, b) => a.minutes - b.minutes)
      .slice(0, NEARBY_ATTRACTION_LIMIT)
  }, [geoAttractions, geoAttractionContent])
  // revealedAttractionNames:目前應該在地圖上顯示的精選點名稱集合——
  // nearbyAttractions 只是「附近景點」清單這個 UI 的資料(取 top N、
  // 已排序),地圖上的揭露規則直接用同一批候選(不受 top N 限制,見
  // useAttractionOverlays.ts 對這個 prop 的說明),讓地圖上看得到的點
  // 跟清單顯示的點不需要嚴格一致——清單是「推薦你看這幾個」,地圖是
  // 「這個主題底下有這些精選點存在」,兩者資料來源相同但呈現目的不同。
  const revealedAttractionNames = useMemo(() => {
    if (!geoAttractionContent || geoAttractionContent.level !== 1) return null
    return new Set(geoAttractions.filter((a) => a.level !== 1).map((a) => a.name))
  }, [geoAttractions, geoAttractionContent])
  // openedNearbyAttraction:點擊「附近景點」清單項目後要開啟的精選點——
  // 刻意不重用 geo.selectAttraction/geoSelection(那套是「主題卡/地點卡
  // 互斥,同時只能顯示一張」的既有機制,見 geoSelection.ts 開頭的完整
  // 說明),因為使用者明確要求這張卡片要「開在 attraction 左邊」——跟
  // AttractionInfoPanel(主題卡)同時並存,不是切換掉它。獨立成這個
  // state,搭配下方 nearbyInfoContent 用 attractionToInfoContent 轉成
  // GeoInfoContent,走「地點」卡片(GeoInfoPanel,含加入候選/加入行程)
  // 而非唯讀的 AttractionInfoPanel——理由是精選點(茶屋、店舖這類使用者
  // 真的可能想排進行程的地點)需要跟飯店/推薦地點一樣的「加入行程」操作,
  // attraction 本身唯讀卡片沒有這個入口(見 AttractionInfoPanel.tsx 開頭
  // 的說明)。錨點(geoAttractionContent)換掉或被清空時一併重置,避免
  // 殘留舊主題底下開過的精選點地點卡。
  const [openedNearbyAttraction, setOpenedNearbyAttraction] = useState<GeoAttraction | null>(null)
  useEffect(() => {
    setOpenedNearbyAttraction(null)
  }, [geoAttractionContent])
  // nearbyInfoContent:openedNearbyAttraction 轉成 GeoInfoPanel 需要的
  // GeoInfoContent 形狀——見 geoInfoContent.ts 的 attractionToInfoContent
  // 完整說明(含 candidate 欄位:第一個真正會建構出 kind:'attraction'
  // 候選的入口)。
  const nearbyInfoContent = useMemo(
    () => (openedNearbyAttraction ? attractionToInfoContent(openedNearbyAttraction) : null),
    [openedNearbyAttraction],
  )
  // handleSelectNearbyAttraction:點擊「附近景點」清單項目——開啟上方的
  // 第二張地點卡(不是切換 AttractionInfoPanel 本身)。
  const handleSelectNearbyAttraction = useCallback((attraction: GeoAttraction) => {
    setOpenedNearbyAttraction(attraction)
  }, [])
  // hoveredNearbyAttraction:「附近景點」清單目前滑鼠移入的項目(見
  // AttractionInfoPanel.tsx 的 onHoverNearby)——只驅動地圖上對應精選點
  // 圓點暫時展開成照片(見 GeoOutlineMap.tsx/useAttractionOverlays.ts 的
  // hoveredCuratedName)。跟 handleSelectNearbyAttraction(點擊,直接開啟
  // 介紹卡)是彼此獨立的兩個互動,理由同 AttractionInfoPanel.tsx
  // onHoverNearby 的說明:hover 是「順便看一眼」,click 才是「進一步看」。
  const [hoveredNearbyAttraction, setHoveredNearbyAttraction] = useState<GeoAttraction | null>(null)
  useEffect(() => {
    setHoveredNearbyAttraction(null)
  }, [geoAttractionContent])
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
  // handleScheduleGeoCandidate:GeoInfoPanel 的 onSchedule 共用處理——
  // 從原本內嵌在單一 <GeoInfoPanel> JSX 裡的匿名函式抽出,理由是「附近
  // 景點」點擊後開的第二個 GeoInfoPanel 執行個體(見下方
  // openedNearbyAttraction)需要一模一樣的排程邏輯,抽成具名函式讓兩個
  // 執行個體共用同一份實作,不需要複製貼上兩份容易日後改一邊忘了改
  // 另一邊。
  const handleScheduleGeoCandidate = useCallback((c: GeoCandidate, date: string) => {
    // activeTrip 為空時 geo.handleScheduleCandidate 內部會直接 no-op
    // (見該函式的 tripID guard)——原本使用者點了日期、浮動匡正常關閉,
    // 卻完全沒有任何提示告訴他「因為沒有選旅程所以沒加成功」,是實際發生
    // 過的 bug。改成沒有 activeTrip 時先記住這筆候選+日期(pendingSchedule)
    // 再開啟旅程列表浮動卡(同點 rail「旅程列表」按鈕),使用者選定旅程
    // 後(見下方 DesktopTripList 的 onOpen)自動補寫進去,不需要使用者
    // 回頭重新走一次「加入行程」流程。刻意直接呼叫 navigate,不透過
    // setPanelMode——trips 是 float 面板,可能跟 GeoInfoPanel 同時顯示
    // (例如使用者原本就開著旅程列表、又點了地圖上的地點),此時 panelMode
    // 已經是 'trips',setPanelMode('trips') 的 toggle 邏輯(再點一次同個
    // mode 會收合)反而會把它關掉,是實際發生過的 bug——跟下方 onSchedule
    // 成功寫入分支刻意改用 navigate 而非 setPanelMode 的理由完全相同。
    if (!activeTrip) {
      setPendingSchedule({ candidate: c, date })
      navigate('/app/trips')
      return
    }
    geo.handleScheduleCandidate(c, date, 'DesktopLayout')
    // 加入成功後展開行程欄(GeoCandidateSidebar,見下方 panelSpec.slot
    // === 'float' 的 'geo-outline' 分支)並觸發短暫 highlight,理由同
    // addGeoCandidateAndReveal——使用者選日期加入後應該能立刻看到剛加的
    // 項目,不用自己再點一次 rail「規劃」按鈕才看得到。跟
    // addGeoCandidateAndReveal 不同的是:onSchedule 這條路徑不像複合
    // 按鈕只在 panelMode === 'geo-outline' 時才能被按到,GeoInfoPanel
    // 在任何 panelMode 下都可能顯示,故這裡額外導向 /app/geo-outline
    // 確保行程欄真的有掛載,flashTrigger 才有作用(欄位沒掛載時單純遞增
    // 計數器不會有任何視覺效果)。刻意直接呼叫 navigate,不透過
    // setPanelMode——setPanelMode 對「目前已經是這個 mode」的情況會
    // toggle 收合(見該函式的說明,是給 rail 按鈕「再點一次收合」這個
    // 互動設計的),若使用者本來就開著行程欄再呼叫 setPanelMode('geo-outline')
    // 反而會把它關掉,這是實際發生過的 bug。
    navigate('/app/geo-outline')
    setGeoCandidateFlashTrigger((n) => n + 1)
  }, [activeTrip, geo, navigate])
  // geoSearchCity/geoSearchTrigger:城市搜尋欄的狀態,UI 渲染在
  // GeoOutlineMap.tsx(地圖左上角類別標籤列旁),查詢邏輯留在
  // GeoOutlinePanel.tsx(見該檔案的說明)——兩者是分開掛載的 sibling,
  // 只能靠這層 state 中介。geoSearchTrigger 每次遞增觸發一次查詢(見
  // GeoOutlinePanel 的 searchTrigger prop 說明)。查詢中/錯誤狀態
  // (searching/error)由 GeoOutlinePanel 內部直接轉給 GeoOutlineMap
  // 顯示,不需要再往上層回報,故這裡不持有對應 state。
  const [geoSearchCity, setGeoSearchCity] = useState('')
  const [geoSearchTrigger, setGeoSearchTrigger] = useState(0)
  // categoryTagsState:地圖上方類別標籤列該不該隱藏——跟手機版
  // (GeoOutlinePhoneView.tsx)共用同一個 reduceCategoryTagsState 狀態機
  // (見 geo-planning/geoCategoryTagsState.ts 的完整說明),取代原本桌面版
  // 「searchResults 非空就隱藏」的衍生值判斷。桌面版沒有「清單抽屜關閉」
  // 這個動作(候選籃側欄由 panelMode 導覽控制,不是這個狀態機的訂閱端),
  // 故只會 dispatch search-started/results-arrived,不會 dispatch
  // user-closed——標籤列只在下一次查詢結果為空時才會重新顯示,這是桌面版
  // 目前這套導覽下的合理行為,不是遺漏。
  const [categoryTagsState, dispatchCategoryTags] = useReducer(reduceCategoryTagsState, initialCategoryTagsState)
  // timelineMirror:ChatScreen 透過 desktopChat.onTimelineData 鏡像過來的時間軸資料
  // (entries/updatingEntryIDs/taskPlaceholders/refetchEntries)。ChatScreen 是這份
  // 資料唯一的擁有者(它的 WS 連線即時維護這些 state),這裡只是接住鏡像後轉交給
  // side panel 的 MultiTrackTimeline,不可以自己另外 fetch 或開第二條 WS。
  const [timelineMirror, setTimelineMirror] = useState<DesktopTimelineMirror>(EMPTY_TIMELINE_MIRROR)
  const todayRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement)

  // showDebugPanel/calls/wsEvents:原本 DebugApp.tsx(?debug 獨立工作台)裡的
  // API/WS 狀態面板,併入正式 App 後改成只在 DEBUG_PANEL_ENABLED 開啟時、由
  // rail 上一顆獨立按鈕切換顯示的附加面板(不佔用 panelMode 的三態切換,
  // 因為它要能疊加顯示、不取代 side panel 或 DesktopMain 的內容——見下方
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
  // 一致——GeoInfoPanel/AttractionInfoPanel 都定位在 DesktopMain 右緣
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
  // nearbyInfoPanelRightPx:第二個 GeoInfoPanel(見上方 nearbyInfoContent)
  // 要疊在 AttractionInfoPanel 左側的精確位置——AttractionInfoPanel 目前
  // 實際佔用的 right 值(依 infoPanelShiftBy 是否已經因為飯店側欄/對話
  // 小匡往左推,對應 16/364/368 三種)再加上它自己的寬度(340px)與間隙
  // (12px),讓兩張卡片並排、不重疊,也不會在飯店側欄/對話小匡也同時
  // 開啟時互相疊在一起。用數字常數(而非再擴充 GeoInfoPanel.module.css
  // 的 shiftBy class 矩陣)是因為這個值是三種 infoPanelShiftBy 狀態各自
  // 動態算出來的組合,固定寫成 CSS class 反而要展開成更多字面值,可讀性
  // 更差(見 GeoInfoPanel.tsx style prop 的完整說明)。
  const attractionPanelRightPx = infoPanelShiftBy === 'chat' ? 368 : infoPanelShiftBy === 'hotel' ? 364 : 16
  const nearbyInfoPanelRightPx = attractionPanelRightPx + 340 + 12

  return (
    <>
      <DesktopLayoutShell>
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
        {/* unbounded:main-replace 以外的所有情況固定渲染 GeoOutlinePanel
            (見下方),故拿掉 860px 寬度上限——見 DesktopMain.tsx 對
            unbounded prop 的完整說明。不傳 unboundedScroll——地理規劃
            輪廓底圖用 position:absolute 撐滿容器,不需要接手垂直捲動。 */}
        <DesktopMain unbounded={panelSpec?.slot !== 'main-replace'}>
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
                  //
                  // dispatch search-started 給標籤列狀態機——立刻隱藏
                  // 標籤列,不等結果回來(見 geo-planning/geoCategoryTagsState.ts
                  // 的說明,跟手機版 GeoOutlinePhoneView.tsx 共用同一個
                  // reducer)。
                  geo.clearSelection()
                  setGeoSearchTrigger((n) => n + 1)
                  dispatchCategoryTags({ type: 'search-started' })
                }}
                onSearchStart={() => {
                  // 類別標籤/「搜尋這個區域」按鈕這兩個入口的「查詢開始」
                  // 時機——不經過上面的 onSearch,見 GeoOutlineMap.tsx
                  // onSearchStart 的完整說明。
                  dispatchCategoryTags({ type: 'search-started' })
                }}
                hideCategoryTags={categoryTagsState.hidden}
                onOpenChat={() => setChatPopoverOpen(true)}
                searchTrigger={geoSearchTrigger}
                refetchTripEntriesTrigger={geo.refetchTripEntriesTrigger}
                geocodeCandidates={geo.geocodeCandidates}
                setGeocodeCandidates={geo.setGeocodeCandidates}
                selectedCandidate={geo.selectedCandidate}
                setSelectedCandidate={geo.setSelectedCandidate}
                onSearchResultsChange={(results) => {
                  // 查詢結果回來時(不論筆數)——標籤列依結果是否為空決定
                  // 要不要重新顯示(見 geoCategoryTagsState.ts 的說明)。
                  // geo.searchResults 現在是 geo.geocodeCandidates 衍生出來
                  // 的鏡像(見 useGeoPlanningState.ts 的說明),不需要在這裡
                  // 再手動同步一次。
                  dispatchCategoryTags({ type: 'results-arrived', hasResults: results.length > 0 })
                }}
                externalGeocodeCandidateSelect={geo.searchResultSelect}
                onTripEntriesChange={geo.onTripEntriesChange}
                onAttractionSelect={geo.selectAttraction}
                onAttractionsChange={setGeoAttractions}
                revealedAttractionNames={revealedAttractionNames}
                hoveredCuratedName={hoveredNearbyAttraction?.name ?? null}
                onSearchResultSelect={geo.selectSearchResult}
                onPoiSelect={geo.selectPoi}
                onGeocodeCandidateText={(placeId, text) => geo.patchGeocodeCandidateText(placeId, text)}
                onGeocodeCandidatePhoto={(placeId, photoUrl) => geo.patchGeocodeCandidatePhoto(placeId, photoUrl)}
                selectedKey={geoSelectedKey}
                candidateKeys={geo.candidateKeys}
                hoverKey={geo.hoverKey}
                panTarget={geo.panTarget}
                theme={props.theme}
              />
              <GeoInfoPanel
                content={geoInfoContent}
                onClose={geo.clearSelection}
                onAddCandidate={geo.addCandidate}
                onAddAndReveal={addGeoCandidateAndReveal}
                onSchedule={handleScheduleGeoCandidate}
                scheduledDates={geo.scheduledDates}
                shiftBy={infoPanelShiftBy}
              />
              <AttractionInfoPanel
                attraction={geoAttractionContent}
                onClose={geo.clearSelection}
                nearby={nearbyAttractions}
                onSelectNearby={handleSelectNearbyAttraction}
                onHoverNearby={setHoveredNearbyAttraction}
                shiftBy={infoPanelShiftBy}
              />
              {/* nearbyInfoContent:「附近景點」清單點擊觸發,獨立於
                  geo.infoContent/geo.attractionContent 之外的第二個
                  GeoInfoPanel 執行個體——刻意不重用 geoSelection 那套
                  互斥選取狀態(見 openedNearbyAttraction 的說明),讓這張
                  「地點」卡片能跟 AttractionInfoPanel(主題卡)同時並存,
                  疊在它左側,而不是切換掉它。style 算出的 right 值疊加了
                  infoPanelShiftBy 本身可能已經因為飯店側欄/對話小匡往左推
                  的偏移量,確保三者(飯店側欄/對話小匡、主題卡、這張地點
                  卡)不會互相重疊。 */}
              {nearbyInfoContent && (
                <GeoInfoPanel
                  content={nearbyInfoContent}
                  onClose={() => setOpenedNearbyAttraction(null)}
                  onAddCandidate={geo.addCandidate}
                  onAddAndReveal={addGeoCandidateAndReveal}
                  onSchedule={handleScheduleGeoCandidate}
                  scheduledDates={geo.scheduledDates}
                  style={{ right: nearbyInfoPanelRightPx }}
                />
              )}
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
              可用寬度,改成絕對定位疊在 DesktopMain(已有
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
                // onClose:手動關閉直接清空 geocodeCandidates(searchResults
                // 是它衍生出來的鏡像,見 useGeoPlanningState.ts 的說明,清空
                // 前者後者自然一併變空),不另外加一個 dismissed state——
                // 理由:資料為空清單本來就會讓 geoHotelSidebarVisible 算出
                // false 而隱藏,下一次查詢(按「搜尋這個區域」、點類別標籤、
                // 或城市搜尋)會自然把清單填回來、重新顯示,不需要額外狀態
                // 去追蹤「使用者主動關閉過」,也不會有「关閉後新查詢卻因為
                // dismissed 標記仍是 true 而不顯示」這種容易忘記重置的邊界
                // 情況。改由 GeoHotelSidebar 自己渲染頂部條(含標題文字+
                // 關閉按鈕,見該元件的說明),這裡不再額外疊加一顆單獨浮動
                // 的關閉按鈕。這是桌面版「使用者主動放棄查詢結果」語意對等
                // 的動作點,一併接上清空地圖 marker——理由同手機版
                // GeoOutlinePhoneListDrawer.onClose(見 GeoOutlinePhoneView.tsx
                // 的說明)。
                onClose={() => geo.setGeocodeCandidates([])}
              />
            </FloatingPanel>
          )}
          {/* chat-popover:對話浮動小匡,由地圖右上角城市搜尋框旁的 AI
              按鈕觸發(見 GeoOutlineMap.tsx 的 onOpenChat),疊在搜尋框
              正下方——沒有常駐對話欄,這是使用者存取 ChatScreen 的唯一
              入口(見 chatPopoverOpen 宣告處的說明)。
              FloatingPanel 永遠掛載,只用 .chatPopoverHidden(display:
              none)隱藏——使用者明確要求桌面版也改成常駐掛載,對齊手機版
              PhoneContent.tsx 的 chatElement/chatPortalTarget 同一套「永遠
              掛載、只切換顯示」設計,避免小匡每次開關都讓 ChatScreen 卸載
              重掛、WebSocket 重新連線(原本 {chatPopoverOpen && (...)}
              這種條件渲染,關閉就等於解除掛載)。沒有 activeTrip 時仍掛載
              ChatScreen(trip 不傳,見該元件 trip prop 的說明)——使用者
              不需要先選/建立旅程就能開始對話,不再顯示空狀態擋板。key 用
              activeTrip?.id ?? 'no-trip',確保「無旅程對話」跟「某個旅程
              的對話」是各自獨立的掛載週期(避免沿用前一個旅程殘留的
              WebSocket/訊息 state)。 */}
          <FloatingPanel
            side="right"
            width={340}
            title="對話"
            className={[
              styles.chatPopover,
              geoHotelSidebarVisible ? styles.chatPopoverShifted : '',
              chatPopoverOpen ? '' : styles.chatPopoverHidden,
            ].filter(Boolean).join(' ')}
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
        </DesktopMain>
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
      </DesktopLayoutShell>
      {settingsOpen && (
        <SettingsDialog
          cfg={cfg}
          user={props.user}
          email={props.email}
          theme={props.theme}
          setTheme={props.setTheme}
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
