import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { ApiCall, WsEvent } from './api'
import { onApiCall, onWsEvent, fetchGeoPlaceDetails, fetchGeoPlacePhotoAssets } from './api'
import { ChatScreen } from './chat/ChatScreen'
import { MultiTrackTimeline } from './timeline/Timeline'
import { PaceChart } from './pace/PaceChart'
import { DemoPanel } from './demo/DemoPanel'
import { GeoHotelSidebar } from './geo-planning/GeoHotelSidebar'
import { PlacePanel } from './geo-planning/PlacePanel'
import { AttractionInfoPanel } from './geo-planning/AttractionInfoPanel'
import { DESKTOP_INFO_CARD_BASE_RIGHT_PX, stackedInfoCardRightPx } from './geo-planning/DesktopInfoCard'
import { useInfoCardStackSync } from './geo-planning/useInfoCardStack'
import { useThemeAttractionSelection } from './geo-planning/useThemeAttractionSelection'
import { GeoCandidateSidebar, type GeoCandidate } from './geo-planning/GeoCandidateSidebar'
import { createEntryFromCandidate } from './geo-planning/geoCandidateHelpers'
import { ExploreMap } from './geo-planning/ExploreMap'
import { useGeoOutlineMapState } from './geo-planning/useGeoOutlineMapState'
import { useTripEntriesMirror } from './hooks/useTripEntriesMirror'
import outlineMapStyles from './geo-planning/GeoOutlinePanel.module.css'
import { useGeoPlanningState } from './geo-planning/useGeoPlanningState'
import { computeNearbyAttractions } from './geo-planning/geoNearbyAttractions'
import { attractionToInfoContent, poiInfoContent } from './geo-planning/geoInfoContent'
import { reduceCategoryTagsState, initialCategoryTagsState } from './geo-planning/geoCategoryTagsState'
import { curatedCategoryOf } from './geo-planning/geoCuratedCategoryStub'
import type { GeoAttraction, GeoPlaceDetails } from './api'
import { type ContentProps } from './AppCommon'
import { type PanelMode, isPanelMode, DEBUG_PANEL_ENABLED, PANEL_REGISTRY } from './DesktopShared'
import { RouteEditor } from './demo/RouteEditor'
// TripPlanPage:「AI 規劃」正式功能頁面(見該檔案開頭的完整說明)——lazy
// 載入,理由同 App.tsx 對其餘整頁級路由的既有做法:這個頁面串接 onagent
// AgentBridge、地圖、markdown 渲染等較重的依賴,不是每個使用者都會點進
// 這個 panelMode,不該拖累 /app 主 bundle 的初始載入體積。
const TripPlanPage = lazy(() => import('./trip-plan/TripPlanPage').then((m) => ({ default: m.TripPlanPage })))
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
// 模式。PanelMode/LangSelect/TokenDisplay/useTripsState
// 這些「桌面/手機共用」的部分不在這裡,分別在 DesktopShared.tsx/
// AppCommon.tsx——避免這裡跟手機版檔案(PhoneContent.tsx/PhoneNavDrawer.tsx/
// PhoneScreens.tsx)互相 import 對方造成循環依賴。

// NEARBY_ATTRACTION_LIMIT:AttractionInfoPanel「附近景點」清單最多顯示
// 幾筆——2026-09 使用者明確要求清單不設數量上限,改成完整列出這個主題
// 底下所有精選點,跟地圖上 revealedAttractionNames 揭露的集合一致(見
// 下方 revealedAttractionNames 的完整說明:兩者原本刻意允許不一致,清單
// 只取前 N 筆、地圖全部顯示,但使用者體感上會覺得「地圖上明明看得到,
// 清單卻沒列出來」,故改成兩者一致,不再各自有不同的裁切規則)。傳
// Infinity 給 computeNearbyAttractions 的 limit 參數(見該函式與
// geoNearbyAttractions.test.ts 已有的「不限制筆數」測試案例),等同不做
// slice 裁切,只保留距離排序。
const NEARBY_ATTRACTION_LIMIT = Infinity

// CHAT_POPOVER_WIDTH:對話浮動小匡的寬度。
//
// 2026-10 從 340 加寬到 440:這張小匡的內容已經從 ChatScreen(純訊息流,
// 窄版完全夠用)換成 TripPlanPage(AI 規劃時間軸,見該檔案的完整說明),
// 而時間軸的版面有一批不隨容器縮放的固定成本——左側時間欄(「10:00」)、
// 軸線與圓點、站點卡片左側 64px 圓形縮圖、各層間距——在 340px 下把卡片
// 右側的文字區擠到只剩幾十 px,實測站點名稱被壓成一字一行的直書
// (「林」「百」「貨」),卡片右緣還會超出小匡被裁掉。
//
// 這個數值刻意不再跟 GeoHotelSidebar/地點介紹卡/搜尋框那組「統一 340px」
// 對齊(見 DesktopLayout.module.css .chatPopover/.chatPopoverShifted 的
// 完整說明:那組寬度是為了讓這幾張浮動卡片視覺上成一套)——那套統一是
// 建立在「它們裝的都是同一類輕量資訊」這個前提上,時間軸不屬於那一類。
// 用一致的寬度換取內容可讀性不成立,故這裡接受視覺上不再等寬。
//
// 這只是緩解不是根治:固定成本的擠壓在更窄的視窗下依然會發生,真正的
// 解法是讓 PlanTimelineView 依「容器寬度」(container query,而非目前
// 那個看視窗寬度、在小匡裡永遠不會觸發的 767px media query)切換成
// 窄版版型。先加寬驗證其餘功能,之後再處理。
const CHAT_POPOVER_WIDTH = 440

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
  // planStops/selectedPlanStopId/hoverPlanStopId:對話小匡裡 AI 規劃時間軸
  // 已安排的站點(2026-10 新增,使用者明確要求「開啟對話若是有安排景點,
  // 地圖上出現小圓點」)。時間軸資料住在 TripPlanPage 裡,而地圖是它的
  // 兄弟節點,故由 TripPlanPage 透過三個回調上報到這一層,再往下傳給
  // ExploreMap。
  //
  // selectedPlanStopId 是其中的例外:它不只是鏡射,而是地圖與時間軸共用的
  // 唯一事實來源(TripPlanPage 收它當受控 prop)——先前兩邊各存一份、只有
  // 子→父單向同步,製造出「點地圖圓點改父層、再點同一張卡片卻回不去」的
  // 死結,見 TripPlanPage 對這個 prop 的完整說明。
  //
  // 三個 setter 直接當回調傳下去——TripPlanPage 內部已用 useStableCallback
  // 隔離,回調的 identity 不進任何依賴陣列,傳什麼都安全(同檔案
  // onPanToStop 傳的就是 inline 箭頭函式)。這裡直接傳 setter 只是剛好
  // 夠用,不是必要條件。
  //
  // 小匡「關閉」時 TripPlanPage 並沒有卸載——FloatingPanel 是常駐掛載、
  // 只用 display:none 隱藏(見下方該元件的完整說明,為的是不要每次開關
  // 都重建 WebSocket 連線)。所以這三個 state 在小匡隱藏期間仍會持續
  // 更新,而且 hover 還收不到「滑鼠離開」事件(被 display:none 隱藏的
  // 元素不產生 onMouseLeave),值會一直停在最後懸停的那一站。
  //
  // 因此下方傳給 ExploreMap 時一律用 chatPopoverVisible 遮蔽(使用者確認
  // 「只在小匡開啟時顯示」),而不是加清除 effect:那樣會讓「關閉小匡」
  // 多出一次不必要的 state 寫入與重渲染,重新開啟時還要等 TripPlanPage
  // 重新回報才會出現圓點,中間有一瞬間的空窗。
  const [planStops, setPlanStops] = useState<{ id: string; lat: number; lng: number; name?: string }[]>([])
  const [selectedPlanStopId, setSelectedPlanStopId] = useState<string | null>(null)
  // hoverPlanStopId:滑鼠正懸停在哪一張站點卡上(2026-10 新增,使用者
  // 明確要求「滑鼠移動到介紹卡時,地圖圓加強顯示」)。命名用 hover* 而非
  // hovered*,對齊 ExploreMap 既有的 hoverKey。
  //
  // 跟 selectedPlanStopId 分開存而不是合併成單一「強調中的 id」:兩者的
  // 生命週期不同(hover 移出就消失,選取會留著),合併會讓「滑過另一張卡
  // 再移開」把先前點選的高亮一併清掉。地圖那側也不把兩者收斂成同一種
  // 視覺——selected 與 hover 的強調樣式刻意有差異(外環墨濃度、光暈大小),
  // 見 planStopMarkerContent 對 state 參數的完整說明。
  const [hoverPlanStopId, setHoverPlanStopId] = useState<string | null>(null)
  // pendingSchedule:使用者在還沒選定旅程時,對某個候選按了日期選擇(見
  // PlacePanel 的 onSchedule)——原本這個情境下 geo.handleScheduleCandidate
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
  // geoHotelSidebarVisible:跟下方 GeoHotelSidebar 實際渲染的條件完全
  // 一致——提前到這裡定義(原本在更下方,搬移理由見下方 infoCardStack
  // 那組 effect 需要用到這個值),供 infoCardStack 判斷搜尋結果側欄是否
  // 顯示中,以及後面 infoPanelShiftBy 判斷右緣避讓使用。不再檢查
  // panelMode === 'geo-outline'——地圖(ExploreMap)上的類別標籤(飯店/
  // 景點/餐廳)不論目前是哪個 panelMode 都可以按到(地圖是主顯示區固定
  // 內容),先前這裡多檢查 panelMode 會導致「在其他 panelMode 下按類別
  // 標籤查詢,geoHotels/geoPlaces 明明已經有資料,清單卻不會跳出來」的
  // bug(使用者需要先手動切到「規劃」panelMode 才看得到剛查到的結果)。
  // 查詢本身要不要顯示只看有沒有內容,跟目前主顯示區在哪個 panelMode
  // 無關。
  const geoHotelSidebarVisible = geo.searchResults.length > 0
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
  // geoAttractions:ExploreMap 目前查到的景點區域完整清單(即時反映
  // 地圖移動/縮放後重新查詢的結果,見 ExploreMap.tsx onAttractionsChange
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
  // 主題點/精選點的區分:isTheme===true 視為「主題點」(地圖預設就會
  // 顯示,見 useAttractionOverlays.ts 對 isTheme 恆顯示的規則),其餘一律
  // 視為「精選點」,預設不在地圖上顯示,只有使用者點開某個主題點(錨點
  // 本身 isTheme===true)後,才依附近距離揭露該主題底下的精選點——這是
  // 純粹的距離篩選(方向 C,見 docs/research-curated-attraction-
  // relationships-2026-08.md 的結論:C 該作為底層能力保留),不是存在
  // 資料庫裡的固定父子關聯。原本這個分級直接借用 level===1 表達(暫不
  // 新增後端欄位),現已改用獨立的 isTheme 欄位(見 model.Attraction.IsTheme
  // 的完整說明),不再依賴 level 數字。
  //
  // 若目前錨點本身不是主題點(isTheme!==true,例如使用者直接點了一個
  // 已被揭露的精選點卡片),不計算附近清單——精選點不該再遞迴揭露下一層
  // 精選點,「進入主題」這件事只由主題點觸發。
  const nearbyAttractions = useMemo(() => {
    if (!geoAttractionContent || !geoAttractionContent.isTheme) return []
    return computeNearbyAttractions(
      geoAttractionContent,
      geoAttractions.filter((a) => !a.isTheme),
      NEARBY_ATTRACTION_LIMIT,
    )
  }, [geoAttractions, geoAttractionContent])
  // revealedAttractionNames:目前應該在地圖上顯示的精選點名稱集合——
  // nearbyAttractions 是「附近景點」清單這個 UI 的資料(已排序),地圖上
  // 的揭露規則直接用同一批候選(見 useAttractionOverlays.ts 對這個 prop
  // 的說明)。2026-09 以前這裡曾經是「清單只取前 N 筆、地圖全部顯示」的
  // 刻意不一致設計(清單是「推薦你看這幾個」,地圖是「這個主題底下有
  // 這些精選點存在」),但使用者體感上會覺得「地圖上明明看得到,清單卻
  // 沒列出來」,故拿掉 NEARBY_ATTRACTION_LIMIT 的上限(見該常數的完整
  // 說明),兩者現在資料來源相同、呈現內容也一致,只是排序方式各自獨立
  // (清單依距離排序,地圖揭露不排序)。
  // useThemeAttractionSelection:主題卡開著時跟它並存/附掛的一組狀態
  // (poiContent/hoveredAttraction/categoryFilter)與對應的 reset/
  // infoCardStack('attraction'/'nearbyPlace' 兩筆)登記邏輯,抽成跟
  // InteractiveExploreMap.tsx 共用的 hook(見該檔案的完整說明)——原本這裡是
  // 四份各自獨立手寫的 state(nearbyInfoContent/hoveredNearbyAttraction/
  // activeNearbyCategoryFilter + 三個 reset effect),兩邊容易各自漏寫
  // 其中一個 reset(2026-09 實測踩過:展示頁漏了 hover/分類篩選的
  // reset),抽出來後不可能再各自漏掉。themeKey 直接傳
  // geoAttractionContent 這個物件本身(不是 .name 字串,見該 hook 開頭
  // 對 themeKey 的完整說明)——geoSelection reducer 每次 SELECT_ATTRACTION
  // 都會 dispatch 新物件,用物件參照當依賴值才能保留「重複點擊同一個
  // 主題點地標,也要清空並存卡」的原本行為,並避免兩個不同地點同名被
  // 誤判成同一個主題(只當唯讀輸入,不把 geoSelection 這個互斥狀態機的
  // setter 收進 hook)。fetchPlaceDetails 傳
  // (placeId) => fetchGeoPlaceDetails(cfg, placeId)(登入版端點,對稱
  // 展示頁改用免登入版的差異)。
  const {
    poiContent: nearbyInfoContent,
    setPoiContent: setNearbyInfoContent,
    openPoiContent: openNearbyPoiContent,
    hoveredAttraction: hoveredNearbyAttraction,
    setHoveredAttraction: setHoveredNearbyAttraction,
    categoryFilter: activeNearbyCategoryFilter,
    setCategoryFilter: setActiveNearbyCategoryFilter,
    infoCardStack,
  } = useThemeAttractionSelection(
    geoAttractionContent,
    useCallback((placeId: string) => fetchGeoPlaceDetails(cfg, placeId), [cfg]),
    useCallback((placeId: string) => fetchGeoPlacePhotoAssets(cfg, placeId), [cfg]),
    // extraAttractionPresent:geoInfoContent(PlacePanel)是同一個
    // geoSelection 互斥狀態機的另一個分支(見下方 geoSelectionCardPresent
    // 的完整說明,已搬到這裡與呼叫參數一併說明)——geoAttractionContent/
    // geoInfoContent 渲染的是同一個「主題卡這個位置」,只是這支 hook
    // 只認得 themeKey(對應 geoAttractionContent)這一個分支,故額外把
    // geoInfoContent 的存在與否傳進來,讓 'attraction' order 0 只有這裡
    // 一處登記,不需要呼叫端自己再呼叫一次 useInfoCardStackSync 補登記
    // (見該 hook 對這個參數的完整說明)。
    !!geoInfoContent,
    // onAttractionPresent:'attraction' 這個位置從不存在→存在時,額外
    // 清掉搜尋候選(geo.setGeocodeCandidates([]))——理由同下方
    // 'searchResults' 登記的 onExclusivePresent=geo.clearSelection 對稱:
    // 兩張卡片互斥,誰後出現就把另一張的實際內容 state 也真的清空,不只是
    // 從登記簿移除。
    useCallback(() => geo.setGeocodeCandidates([]), [geo]),
  )
  const revealedAttractionNames = useMemo(() => {
    if (!geoAttractionContent || !geoAttractionContent.isTheme) return null
    const nearbyPool = geoAttractions.filter((a) => !a.isTheme)
    if (!activeNearbyCategoryFilter) return new Set(nearbyPool.map((a) => a.name))
    return new Set(
      nearbyPool
        .filter((a) => curatedCategoryOf(a.category) === activeNearbyCategoryFilter)
        .map((a) => a.name),
    )
  }, [geoAttractions, geoAttractionContent, activeNearbyCategoryFilter])
  // infoCardStack 額外登記:'searchResults'(搜尋結果側欄)——展示頁沒有
  // 搜尋框,不在 useThemeAttractionSelection 認識的範圍內,由這裡呼叫端
  // 自行補登記(見該 hook 開頭對 infoCardStack 範圍的完整說明)。
  //
  // 搜尋結果側欄額外帶 onExclusivePresent=geo.clearSelection——登記簿
  // 被清空不會自動連動 geoAttractionContent 這個實際 state(它是
  // geoSelection 管理的),搜尋結果一出現時除了登記進 infoCardStack,
  // 還要額外呼叫 geo.clearSelection() 把主題卡真的關閉(連帶因
  // useThemeAttractionSelection 內部依 themeKey 的 reset effect 自動清空
  // 並存卡,不需要重複呼叫 setNearbyInfoContent(null))——使用者明確
  // 要求搜尋結果出現時要真的關閉主題卡/地點卡(互斥),不是原本「往左推、
  // 並存顯示」的行為。
  // geoAttractionContent(AttractionInfoPanel)與 geoInfoContent
  // (PlacePanel,見下方 JSX 該元件的 content prop)是同一個 geoSelection
  // 互斥狀態機的兩個分支(見 geoSelection.ts 開頭說明,一次只可能有一個
  // 非空)——兩者渲染的是「主題卡這個位置」上的不同元件,不是各自獨立的
  // 兩張卡片。'attraction' order 0 的登記(含涵蓋 geoInfoContent 分支的
  // extraAttractionPresent、與 onAttractionPresent 清空搜尋候選)已經在
  // 上面呼叫 useThemeAttractionSelection 時一併傳入,這裡不再重複登記
  // 同一個 id(見該 hook 對這兩個參數的完整說明:同一個 id 只能有一個
  // 登記來源,不該讓兩處各自呼叫 useInfoCardStackSync、靠呼叫順序決定
  // 誰的登記「贏」)。
  useInfoCardStackSync(infoCardStack, 'searchResults', 0, 'exclusive', geoHotelSidebarVisible, geo.clearSelection)
  // handleSelectNearbyAttraction:點擊「附近景點」清單項目——開啟上方的
  // 第二張地點卡(不是切換 AttractionInfoPanel 本身),直接重用
  // useThemeAttractionSelection 回傳的 openNearbyPoiContent(理由同該
  // hook 開頭對 openPoiContent 的完整說明)。
  const handleSelectNearbyAttraction = openNearbyPoiContent
  // handleAttractionOpenPlaceDetails:點擊地圖上 level 4/5 地標圖示,或
  // 點擊 Google 原生 POI 圖標(見 ExploreMap.tsx 的
  // onAttractionOpenPlaceDetails 完整說明)——使用者明確要求「點地圖上的
  // place 或小的 attraction 都不要關閉已開啟的 attraction」,
  // AttractionInfoPanel(主題卡)永遠置右最優先。
  //
  // 只有 geoAttractionContent(主題卡)已經開著時,才走 nearbyInfoContent
  // 並存路徑(疊在主題卡左側,見該 state 的完整說明);沒有主題卡開著時,
  // 這就是使用者這次點擊唯一想看的內容,改走 geo.selectPoi 的原本互斥
  // 路徑,貼齊右緣顯示(理由:nearbyInfoContent 的定位公式
  // nearbyInfoPanelRightPx = attractionPanelRightPx + 340 + 12 假設
  // 左側一定有主題卡可疊靠,沒有主題卡時這個位移量沒有意義,卡片會顯示在
  // 錯誤的偏移位置而不是貼右緣)。
  const handleAttractionOpenPlaceDetails = useCallback((details: GeoPlaceDetails, attraction?: GeoAttraction) => {
    if (geoAttractionContent) {
      const content = poiInfoContent(details)
      if (attraction) content.attractionSummary = attraction.summary
      setNearbyInfoContent(content)
    } else {
      geo.selectPoi(details, attraction)
    }
  }, [geoAttractionContent, geo])
  // handleAttractionOpenPlaceWithoutGoogle:接住 ExploreMap.tsx 的
  // onAttractionOpenPlaceWithoutGoogle(非主題點地標沒有 placeId、或查詢
  // Google Place Details 失敗時觸發)——使用者明確要求非主題點點擊一律
  // 開地點卡,不再有退回開 attraction 自己介紹卡的例外。直接用
  // attractionToInfoContent 組地點卡內容(不查 Google,理由同該函式的
  // 完整說明),並存/貼右緣的判斷邏輯跟 handleAttractionOpenPlaceDetails
  // 完全一致(見該函式的完整說明)。
  const handleAttractionOpenPlaceWithoutGoogle = useCallback((attraction: GeoAttraction) => {
    const content = attractionToInfoContent(attraction)
    if (geoAttractionContent) {
      setNearbyInfoContent(content)
    } else {
      geo.selectPlaceContent(content)
    }
  }, [geoAttractionContent, geo])
  // geoCandidateFlashTrigger:候選籃浮動卡片(GeoCandidateSidebar,見下方
  // panelSpec.slot === 'float' 的 'geo-outline' 分支)「剛加入東西了」的
  // 視覺提示觸發器——每次遞增觸發一次短暫的 highlight 動畫(見
  // GeoCandidateSidebar.module.css 的 .panelFlash)。之所以需要這個,而不是
  // 直接「展開/收合」卡片:PlacePanel 複合按鈕只在 panelMode ===
  // 'geo-outline' 底下能被按到,而 GeoCandidateSidebar 在同一個條件下已經
  // 展開顯示,沒有獨立的「收合/展開」開關能在這個情境下額外觸發——用
  // 遞增計數器(而非 boolean)是因為使用者可能連續加入好幾個候選,即使
  // 卡片的 flash 動畫還沒播完,遞增值仍能保證每次都是新的 useEffect
  // 依賴值、重新觸發一次動畫(boolean 在連續兩次都設成 true 時不會變動,
  // 不會重新觸發)。這是桌面版專屬的視覺提示,不在 useGeoPlanningState
  // 共用範圍內(手機版加入候選後改成直接打開候選籃抽屜,見
  // GeoOutlinePhoneView.tsx 的 handleAddCandidate)。
  const [geoCandidateFlashTrigger, setGeoCandidateFlashTrigger] = useState(0)
  // addGeoCandidateAndReveal:PlacePanel 複合按鈕右半邊(PanelLeft icon)
  // 觸發——跟左半邊 geo.addCandidate 一樣單純加入候選籃(同一份去重邏輯,
  // 不涉及日期選擇),額外多做的事只有讓候選籃側欄短暫 highlight 一下,
  // 提示使用者「加進去了,去左邊看」(側欄本身在這個情境下必然已經展開,
  // 詳見 geoCandidateFlashTrigger 的說明)。
  const addGeoCandidateAndReveal = useCallback((c: GeoCandidate) => {
    geo.addCandidate(c)
    setGeoCandidateFlashTrigger((n) => n + 1)
  }, [geo])
  // handleScheduleGeoCandidate:PlacePanel 的 onSchedule 共用處理——
  // 從原本內嵌在單一 <PlacePanel> JSX 裡的匿名函式抽出,理由是「附近
  // 景點」點擊後開的第二個 PlacePanel 執行個體(見下方
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
    // setPanelMode——trips 是 float 面板,可能跟 PlacePanel 同時顯示
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
    // 按鈕只在 panelMode === 'geo-outline' 時才能被按到,PlacePanel
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
  // ExploreMap.tsx(地圖左上角類別標籤列旁),查詢邏輯留在
  // GeoOutlinePanel.tsx(見該檔案的說明)——兩者是分開掛載的 sibling,
  // 只能靠這層 state 中介。geoSearchTrigger 每次遞增觸發一次查詢(見
  // GeoOutlinePanel 的 searchTrigger prop 說明)。查詢中/錯誤狀態
  // (searching/error)由 GeoOutlinePanel 內部直接轉給 ExploreMap
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
  // outlineMapState:原本 GeoOutlinePanel.tsx 內部持有的城市搜尋/旅程座標
  // 查詢邏輯,已拆成 useGeoOutlineMapState(見該檔案的完整說明)——這個
  // 元件退役後,DesktopLayout.tsx 直接呼叫 <ExploreMap>,不再需要一層
  // 只做轉傳的包裝元件,「把卡片用 children 掛入 ExploreMap」也不必再
  // 穿透這層包裝。
  const outlineMapState = useGeoOutlineMapState({
    cfg,
    tripID: activeTrip?.id ?? null,
    city: geoSearchCity,
    onSearchResultSelect: geo.selectSearchResult,
    onSearchResultsChange: (results) => {
      // 查詢結果回來時(不論筆數)——標籤列依結果是否為空決定要不要重新
      // 顯示(見 geoCategoryTagsState.ts 的說明)。geo.searchResults 現在
      // 是 geo.geocodeCandidates 衍生出來的鏡像(見 useGeoPlanningState.ts
      // 的說明),不需要在這裡再手動同步一次。
      dispatchCategoryTags({ type: 'results-arrived', hasResults: results.length > 0 })
    },
    onGeocodeCandidateText: (placeId, text) => geo.patchGeocodeCandidateText(placeId, text),
    onGeocodeCandidatePhoto: (placeId, photoUrl) => geo.patchGeocodeCandidatePhoto(placeId, photoUrl),
    onTripEntriesChange: geo.onTripEntriesChange,
    externalGeocodeCandidateSelect: geo.searchResultSelect,
    panTarget: geo.panTarget,
    searchTrigger: geoSearchTrigger,
    refetchTripEntriesTrigger: geo.refetchTripEntriesTrigger,
    geocodeCandidates: geo.geocodeCandidates,
    setGeocodeCandidates: geo.setGeocodeCandidates,
    selectedCandidate: geo.selectedCandidate,
    setSelectedCandidate: geo.setSelectedCandidate,
  })
  // timelineMirror:時間軸側欄(panelMode === 'timeline' 的 MultiTrackTimeline)
  // 需要的行程條目資料。
  //
  // 2026-10:改用 useTripEntriesMirror 自己撈(見該 hook 的完整說明)——
  // 原本這份資料是 ChatScreen 透過 desktopChat.onTimelineData 鏡像過來的,
  // 但對話小匡的內容已經換成 TripPlanPage(AI 規劃時間軸),ChatScreen 不
  // 再常駐掛載,側欄不能再依賴「對話剛好有掛載且剛好撈過」這件事。使用者
  // 確認「讓它自己撈資料,不再依賴對話」。
  //
  // isOwner 判斷沿用搬移前 ChatScreen 內 load() 的既有條件(非擁有者
  // api.fetchEntries 會失敗,不如一開始就不打)。
  const timelineMirror = useTripEntriesMirror(
    cfg,
    activeTrip?.id ?? null,
    activeTrip ? activeTrip.ownerID === props.user.id : false,
  )
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

  // desktopMainRef:2026-10 新增——TripPlanPage 全頁版(/app/plan-ai)的
  // 「回到最新」機制(自動捲到底/跟隨捲動判斷/按鈕顯示,見該元件
  // scrollContainerRef prop 的完整說明)需要抓到真正接手捲動的那個
  // DOM 節點(DesktopMain 的 <main>,見該元件 unboundedScroll 的說明)。
  // 原本用 scrollRef.current?.closest('main') 從內部往上爬著找,這只
  // 對「捲動容器就是某個 <main> 祖先」的情境成立——地圖規劃對話小匡
  // (compact 模式)的捲動容器是小匡內部的 .compactScroll,DOM 樹裡
  // 完全沒有 <main> 祖先(DesktopLayout.tsx/FloatingPanel.tsx 都沒有
  // 這個標籤),closest('main') 永遠回傳 null,導致小匡版「回到最新」
  // 整套機制(自動捲到底、跟隨判斷、按鈕顯示)完全失效,使用者從頭到
  // 尾看不到這顆按鈕(code review 時發現的實際 bug,不是臆測)。
  // 改成由呼叫端明確傳入「真正的捲動容器」ref,不再靠 closest 猜——
  // 全頁版傳這個 mainRef(見下方掛到 <DesktopMain ref={desktopMainRef}>
  // 的用法),小匡版不傳,元件內部 fallback 用 .compactScroll 自己的
  // scrollRef,兩條路徑各自對應自己真正的捲動容器。
  const desktopMainRef = useRef<HTMLElement>(null)

  // chatPopoverVisible:對話小匡此刻實際上看不看得見。小匡本身的
  // display:none 判斷與「地圖上的規劃站點小圓點要不要顯示」共用這一個
  // 變數——兩者必須永遠一致(圓點是小匡內容的延伸,小匡看不見時圓點就是
  // 孤兒),各自寫一次判斷遲早會漂移。
  //
  // 單看 chatPopoverOpen 不夠:切到 main-replace 的分頁(plan-ai/
  // demo-route-editor)時小匡會被隱藏,但 chatPopoverOpen 本身維持 true
  // ——那是刻意的(見下方 FloatingPanel 的完整說明:常駐掛載、不重建
  // WebSocket 連線),所以「開啟」與「看得見」在這裡不是同一件事。
  const chatPopoverVisible = chatPopoverOpen && panelSpec?.slot !== 'main-replace'

  // 2026-10 squash rebase 修正:這裡原本還有兩段死碼——
  // (1) onTimelineData/desktopChat(useCallback+useMemo 包的
  //     { onTimelineData } 物件,原本傳給 ChatScreen 讓它鏡像時間軸
  //     資料回來,搭配一個已不存在的 setTimelineMirror setter)——
  //     timelineMirror 現在改用 useTripEntriesMirror 自己撈(見上方
  //     該 hook 呼叫處的完整說明,使用者確認「讓它自己撈資料,不再依賴
  //     對話」),ChatScreen 也不再常駐掛載,這整套鏡像機制已經失效,
  //     下方渲染 ChatScreen 處也已經不再傳 desktopChat prop。
  // (2) 一段「離開規劃分頁或切換旅程時收起第二側欄」的 effect(呼叫
  //     geo.setPickingDayKey(null))——候選籃候選中清單/候選匡整套
  //     機制已經移除(見 useGeoPlanningState.ts 的完整說明),
  //     pickingDayKey/setPickingDayKey 已不存在,這段邏輯連帶失效。
  // 兩段都是直接刪除,不是遺漏。

  // infoPanelShiftBy:PlacePanel/AttractionInfoPanel 右緣需要避開的東西
  // ——原本還包含 GeoHotelSidebar(飯店清單)這個分支('hotel'),但搜尋
  // 結果出現時現在會真正關閉主題卡/地點卡(見上方 infoCardStack 那組
  // effect 的完整說明,兩者改成互斥而非並存推擠),GeoHotelSidebar 存在
  // 時主題卡/地點卡不可能同時存在,'hotel' 這個分支因此變成永遠不會被
  // 觸發的死代碼,已移除——只剩對話浮動小匡(chatPopoverOpen)這個仍然是
  // 「並存推擠」而非互斥的情境。'none' 代表右緣沒有東西需要避開,維持
  // 貼齊 16px。'hotel' 仍保留在 shiftBy 的型別定義裡(DesktopInfoCard.tsx/
  // AttractionInfoPanel.tsx/PlacePanel.tsx),因為那是這幾個元件對外公開
  // 介面的一部分,這裡只是不再產生這個值,不代表其餘呼叫端不能使用。
  const infoPanelShiftBy: 'none' | 'hotel' | 'chat' = chatPopoverOpen ? 'chat' : 'none'
  // attractionPanelRightPx:AttractionInfoPanel(主題卡)整組並存疊放的
  // 起始 right 基準——依 infoPanelShiftBy 是否已經因為對話小匡往左推,
  // 對應 16/368 兩種(理由見上方 infoPanelShiftBy 的說明)。
  const attractionPanelRightPx = infoPanelShiftBy === 'chat' ? 368 : DESKTOP_INFO_CARD_BASE_RIGHT_PX
  // nearbyInfoPanelRightPx:改用 stackedInfoCardRightPx(見
  // DesktopInfoCard.tsx 的完整說明)搭配上方 infoCardStack 的
  // presentOrders,取代原本「nearbyInfoPanelRightPx =
  // attractionPanelRightPx + 340 + 12」這條假設主題卡一定已開的固定
  // 公式——並存地點卡固定順位 1(見 infoCardStack 那組 effect 的 push
  // 呼叫),渲染時只看「目前實際有沒有出現」(presentOrders 直接來自
  // infoCardStack,不在這裡另外重算一次同樣的存在性判斷),缺席時後面
  // 的卡片會自動往右滑補位,不再有「並存卡浮在主題卡假設位置、但左邊
  // 其實沒有主題卡」這種只靠人工遵守、沒有 runtime 防呆的隱性契約。
  const nearbyInfoPanelRightPx = stackedInfoCardRightPx(
    1,
    infoCardStack.presentOrders,
    attractionPanelRightPx,
  )

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
            輪廓底圖用 position:absolute 撐滿容器,不需要接手垂直捲動。
            plan-ai 也加進 unbounded/unboundedScroll:使用者實際回報
            「捲軸的樣式跟位置,要貼在視窗」——先前讓 plan-ai 維持
            860px 置中的預設(不 unbounded)時,捲動容器(.scroll)本身
            被限制在內層 860px 容器裡,捲軸貼在內容區右緣、離視窗邊界
            還有一段距離,不是貼齊視窗。改成外層(.main)撐滿視窗寬度、
            接手捲動權(理由/寫法同 pace/PaceRouteMap 用 unboundedScroll
            的既有作法),TripPlanPage 內部的 header/時間軸內容各自加了
            一層 860px 置中容器維持視覺不變,只有捲動這件事發生在撐滿
            視窗的外層。 */}
        <DesktopMain ref={desktopMainRef} unbounded={panelSpec?.slot !== 'main-replace' || panelMode === 'plan-ai'} unboundedScroll={panelMode === 'plan-ai'}>
          {panelSpec?.slot === 'main-replace' ? (
            panelMode === 'demo-route-editor' ? (
              // demo-route-editor 只做桌面版(手機版 PhoneNavDrawer 不
              // 提供對應分頁),直接在這裡渲染。main-replace slot 目前
              // 有這個試做功能、下面的 demo-chat 與 plan-ai 三種模式
              // (原本還有 demo-onagent,經 DemoPanelContent 共用邏輯
              // 渲染,已整個移除,含入口與實作)。
              <RouteEditor />
            ) : panelMode === 'demo-chat' ? (
              // demo-chat:舊版對話框(走 tripace app 的 trip_entry_*
              // 工具)——地圖規劃的對話視窗 2026-10 改成渲染 AI 規劃
              // 時間軸之後,這套保留成試做分頁,見 DesktopShared.tsx
              // DEMO_CHAT_ENABLED 的完整說明。
              //
              // 這裡不再傳 desktopChat:時間軸側欄的資料來源已經改成
              // useTripEntriesMirror 自己撈(見該 hook 的完整說明),
              // 不再依賴 ChatScreen 鏡像過來,兩者脫鉤。
              <ChatScreen
                key={activeTrip?.id ?? 'no-trip'}
                cfg={cfg}
                trip={activeTrip ?? undefined}
                user={props.user}
                onBack={() => setActiveTrip(null)}
              />
            ) : (
              // plan-ai(AI 規劃,見 trip-plan/TripPlanPage.tsx 的完整
              // 說明),正式功能,直接在這裡渲染,理由同 demo-route-editor/
              // pace/geo-outline 的既有作法。不依附特定旅程(使用者明確
              // 要求「plan ai 不需要 trip id」),不接收 tripID,PANEL_REGISTRY
              // 也已拿掉 requiresTrip——不需要先選旅程就能使用這個功能。
              <TripPlanPage cfg={cfg} scrollContainerRef={desktopMainRef} />
            )
          ) : (
            // main-replace 以外的所有情況(含 panelMode === null、'trips'/
            // 'timeline'/'pace'/'geo-outline'):主顯示固定是規劃地圖——
            // 這四種正式功能現在改成浮動卡片疊加在地圖上(見下方
            // DesktopLayout.module.css 的 .panel),不再取代主顯示,故這裡不需要再檢查
            // activeTrip/panelMode 的組合,地圖永遠掛載。
            <>
              {/* GeoOutlinePanel 這個包裝元件已退役(見 useGeoOutlineMapState.ts
                  的完整說明)——原本它只做兩件事:持有城市搜尋/旅程座標
                  查詢邏輯(已抽成上方 outlineMapState),以及包一層
                  .wrap/.mapArea 撐開版面尺寸鏈給 ExploreMap 的 width:100%/
                  height:100% 生效(這層 CSS 不是裝飾性外框,ExploreMap.module.css
                  的 .wrap 沒有明確尺寸,得靠這兩層 class 把 DesktopMain 的
                  flex 彈性容器轉成絕對定位滿版矩形,見 GeoOutlinePanel.module.css
                  的完整說明)——退役後這層外框由這裡直接補上,不能省略。
                  AttractionInfoPanel(主題卡)改用 children 掛入
                  ExploreMap(見該檔案 children prop 的完整說明)——原本是
                  跟地圖平行的兄弟元件,只是巧合渲染在同一個父容器裡,跟
                  地圖建立方式無關;改成 children 插槽後,語意上更清楚
                  表達「這是掛在地圖上的東西」。PlacePanel(地點卡)這次
                  刻意不動,維持兄弟元件——只針對主題卡做這個改動。 */}
              <div className={outlineMapStyles.wrap}>
                <div className={outlineMapStyles.mapArea}>
                  <ExploreMap
                    cfg={cfg}
                    initialCenter={outlineMapState.initialCenter}
                    currentPosition={outlineMapState.currentPosition}
                    tripEntries={outlineMapState.tripEntries}
                    // planStops:只在對話小匡開啟時才傳(使用者確認「只在
                    // 小匡開啟時顯示」)——小匡關閉時傳空陣列,圖層自己會
                    // 把 marker 清掉,不需要額外的清除邏輯。
                    // onPlanStopClick 讓點地圖圓點回頭選中對應的時間軸卡片
                    // (selectedPlanStopId 是兩邊共用的唯一事實來源,見上方
                    // 該 state 的說明),跟「點卡片 → 地圖移動過去」互為
                    // 反向操作。
                    planStops={chatPopoverVisible ? planStops : []}
                    // selected/hover 同樣遮蔽:小匡隱藏時 TripPlanPage 仍然
                    // 掛載、state 不會歸零,hover 更是連「移出」事件都收不到
                    // (被 display:none 隱藏的元素不產生 onMouseLeave),值會
                    // 停在最後懸停的那一站。目前 planStops 為空時圖層本來就
                    // 沒有 marker 可套用,這兩行是明確表達意圖、不依賴那個
                    // 間接保證。
                    selectedPlanStopId={chatPopoverVisible ? selectedPlanStopId : null}
                    hoverPlanStopId={chatPopoverVisible ? hoverPlanStopId : null}
                    onPlanStopClick={setSelectedPlanStopId}
                    city={geoSearchCity}
                    onCityChange={setGeoSearchCity}
                    onSearch={() => {
                      // 重新搜尋時清空目前選取的地點,關閉正在顯示的地點
                      // 介紹卡——使用者發起新的城市搜尋通常代表要換一個
                      // 地方看,舊的資訊卡若繼續顯示,容易讓人誤以為卡片
                      // 內容跟這次新搜尋結果有關聯。geo.clearSelection 一次
                      // 涵蓋 selectedKey/infoContent/attractionContent 三者
                      // (見 geo-planning/geoSelection.ts 的說明)——這裡
                      // 曾經只清其中一個 state、資訊卡沒有跟著真的關閉,
                      // 改成單一 reducer 後不會再有「清一半」的中間態。
                      //
                      // dispatch search-started 給標籤列狀態機——立刻隱藏
                      // 標籤列,不等結果回來(見 geo-planning/geoCategoryTagsState.ts
                      // 的說明,跟手機版 GeoOutlinePhoneView.tsx 共用同一個
                      // reducer)。
                      geo.clearSelection()
                      setGeoSearchTrigger((n) => n + 1)
                      dispatchCategoryTags({ type: 'search-started' })
                    }}
                    searching={outlineMapState.searching}
                    searchError={outlineMapState.searchError}
                    onSearchStart={() => {
                      // 類別標籤/「搜尋這個區域」按鈕這兩個入口的「查詢
                      // 開始」時機——不經過上面的 onSearch,見 ExploreMap.tsx
                      // onSearchStart 的完整說明。
                      dispatchCategoryTags({ type: 'search-started' })
                    }}
                    hideCategoryTags={categoryTagsState.hidden}
                    onOpenChat={() => setChatPopoverOpen(true)}
                    onGeocodeCandidatesChange={outlineMapState.onGeocodeCandidatesChange}
                    onAttractionSelect={geo.selectAttraction}
                    onAttractionsChange={setGeoAttractions}
                    revealedAttractionNames={revealedAttractionNames}
                    hoveredCuratedId={hoveredNearbyAttraction?.id ?? null}
                    onSearchResultSelect={outlineMapState.onSearchResultSelect}
                    onPoiSelect={geo.selectPoi}
                    onAttractionOpenPlaceDetails={handleAttractionOpenPlaceDetails}
                    onAttractionOpenPlaceWithoutGoogle={handleAttractionOpenPlaceWithoutGoogle}
                    onCenterChange={outlineMapState.onCenterChange}
                    panTarget={outlineMapState.panTarget}
                    selectedKey={geoSelectedKey}
                    candidateKeys={geo.candidateKeys}
                    hoverKey={geo.hoverKey}
                    geocodeCandidates={outlineMapState.geocodeCandidates}
                    theme={props.theme}
                  >
                    <AttractionInfoPanel
                      attraction={geoAttractionContent}
                      cfg={cfg}
                      onClose={geo.clearSelection}
                      nearby={nearbyAttractions}
                      onSelectNearby={handleSelectNearbyAttraction}
                      onHoverNearby={setHoveredNearbyAttraction}
                      onCategoryFilterChange={setActiveNearbyCategoryFilter}
                      shiftBy={infoPanelShiftBy}
                    />
                    <PlacePanel
                      content={geoInfoContent}
                      onClose={geo.clearSelection}
                      onAddCandidate={geo.addCandidate}
                      onAddAndReveal={addGeoCandidateAndReveal}
                      onSchedule={handleScheduleGeoCandidate}
                      scheduledDates={geo.scheduledDates}
                      shiftBy={infoPanelShiftBy}
                    />
                    {/* nearbyInfoContent:「附近景點」清單點擊/地圖上
                        level 4/5 地標點擊 共用觸發,獨立於
                        geo.infoContent/geo.attractionContent 之外的第二個
                        PlacePanel 執行個體——刻意不重用 geoSelection 那套
                        互斥選取狀態(見上方 nearbyInfoContent state 的
                        完整說明),讓這張「地點」卡片能跟
                        AttractionInfoPanel(主題卡)同時並存,疊在它左側,
                        而不是切換掉它。style 算出的 right 值疊加了
                        infoPanelShiftBy 本身可能已經因為飯店側欄/對話
                        小匡往左推的偏移量,確保三者(飯店側欄/對話小匡、
                        主題卡、這張地點卡)不會互相重疊。 */}
                    {nearbyInfoContent && (
                      <PlacePanel
                        content={nearbyInfoContent}
                        onClose={() => setNearbyInfoContent(null)}
                        onAddCandidate={geo.addCandidate}
                        onAddAndReveal={addGeoCandidateAndReveal}
                        onSchedule={handleScheduleGeoCandidate}
                        scheduledDates={geo.scheduledDates}
                        style={{ right: nearbyInfoPanelRightPx }}
                      />
                    )}
                  </ExploreMap>
                </div>
              </div>
            </>
          )}
          {/* panelMode 浮動卡片:trips/timeline/pace/geo-outline 這四種正式
              功能的內容(見 PANEL_REGISTRY 的 slot: 'float'),疊在地圖左緣
              上方,不佔用 flex 版面空間、不推擠地圖——沿用跟
              GeoHotelSidebar 一致的 FloatingPanel 外殼。不傳 title——四種
              內容元件(DesktopTripList/MultiTrackTimeline/PaceChart/
              GeoCandidateSidebar)各自 header 排版不同,不逐一加專屬標題,
              FloatingPanel 只在右上角疊加共用的關閉按鈕,導回 /app 收起
              卡片(同再點一次 rail 圖示的行為)。
              候選籃候選中清單與候選匡流程已整個移除,不會再有第二張卡片
              並排顯示在這張卡片右側的情況。 */}
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
                        onEntryUpdated={timelineMirror.refetch}
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
                  draggingCandidate={geo.draggingCandidate}
                  onDraggingCandidateChange={geo.setDraggingCandidate}
                  flashTrigger={geoCandidateFlashTrigger}
                />
              ) : null}
            </FloatingPanel>
          )}
          {/* GeoHotelSidebar(飯店/景點/餐廳合併清單)只在使用者實際觸發過
              查詢後才顯示——geo.searchResults(見 onSearchResultsChange
              的說明)只有按下「搜尋這個區域」、點類別標籤、或點地標才會有
              內容(ExploreMap.tsx 的 queryTrigger === 0 guard,地圖掛載/
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
          {/* panelSpec?.slot !== 'main-replace'——main-replace(目前
              plan-ai/demo-route-editor)取代整個主顯示區,
              底下沒有地圖可以讓這張清單疊在上面;不是重新引入上面註解
              提到「已修復」的 panelMode === 'geo-outline' 那個 bug(那個
              bug 是「只認一個特定 mode」,這裡排除的是「一整類完全沒有
              地圖的 slot」,語意不同,geoHotelSidebarVisible 本身仍是唯一
              的顯示條件來源)。用 fable 對 trip-plan/TripPlanPage.tsx 做
              視覺審閱時發現:這張清單原本會疊在新頁面右側,變成孤兒
              overlay。 */}
          {geoHotelSidebarVisible && panelSpec?.slot !== 'main-replace' && (
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
              按鈕觸發(見 ExploreMap.tsx 的 onOpenChat),疊在搜尋框
              正下方——沒有常駐對話欄,這是使用者存取對話的唯一入口
              (見 chatPopoverOpen 宣告處的說明)。
              FloatingPanel 永遠掛載,只用 .chatPopoverHidden(display:
              none)隱藏——使用者明確要求桌面版也改成常駐掛載,對齊手機版
              PhoneContent.tsx 的 chatElement/chatPortalTarget 同一套「永遠
              掛載、只切換顯示」設計,避免小匡每次開關都讓內容卸載重掛、
              WebSocket 重新連線(原本 {chatPopoverOpen && (...)} 這種
              條件渲染,關閉就等於解除掛載)。

              2026-10:內容從 ChatScreen(走 tripace app 的 trip_entry_*
              工具、批次表格 UI)換成 TripPlanPage(AI 規劃時間軸,走
              plan-ai-timeline app)——使用者明確要求「將 ai plan 的規劃
              時間軸功能加到地圖規劃的對話功能內」「對話內的工具不需要
              了,直接使用 ai plan 的 app 及工具」。舊的 ChatScreen 不是
              刪除,搬到 demo-chat 試做分頁保留(見 DesktopShared.tsx
              DEMO_CHAT_ENABLED 的完整說明)。

              TripPlanPage 不需要 trip(使用者明確要求「plan ai 不需要
              trip id」),也不需要 key={activeTrip?.id}——它的時間軸是
              跨行程的單一份資料,存在 localStorage(見
              plan-core/planTimelineStorage.ts 的完整說明:使用者確認
              「不要跟 trip 有關聯」「共用同一份,兩處看到一樣的內容」),
              切換旅程不該讓它重新掛載、清掉正在進行的規劃。這也表示
              /app/plan-ai 與這張小匡看到的是同一條時間軸。 */}
          <FloatingPanel
            side="right"
            width={CHAT_POPOVER_WIDTH}
            title="對話"
            className={[
              styles.chatPopover,
              geoHotelSidebarVisible ? styles.chatPopoverShifted : '',
              // main-replace slot(目前只有 plan-ai/demo-route-editor)
              // 取代整個主顯示區,底下沒有地圖可以讓
              // 這張對話小匡疊在上面——理由同 geo-outline 模式才有意義
              // 的 geoHotelSidebarVisible。用 fable 對 trip-plan/TripPlanPage.tsx
              // 做視覺審閱時發現:這個 popover 原本只靠 chatPopoverOpen
              // 決定顯示,不會因為切到 plan-ai 而自動隱藏,變成孤兒疊在
              // 新頁面右側——加上這個判斷,不改動 chatPopoverOpen 本身
              // (維持常駐掛載、不重建 WebSocket 連線的既有設計)。
              chatPopoverVisible ? '' : styles.chatPopoverHidden,
            ].filter(Boolean).join(' ')}
            onClose={() => setChatPopoverOpen(false)}
          >
            {/* 局部 Suspense:TripPlanPage 是 lazy 載入的(見上方宣告),
                而這張小匡「永遠掛載、只用 display:none 隱藏」(見
                .chatPopoverHidden 的說明)——代表它的 chunk 會在進
                /app 的當下就開始載入。若只靠 App.tsx 最外層那個包住整個
                <Routes> 的 Suspense,整個 /app 畫面(含地圖)會被這個
                chunk 擋住、等它載完才渲染,是明顯的體驗回歸(原本
                TripPlanPage 只有切到 /app/plan-ai 時才載入)。包一層
                自己的 Suspense 讓它的載入只影響這張小匡內部。
                fallback 給 null:小匡預設是關閉(display:none)狀態,
                載入期間使用者看不到任何東西,不需要骨架畫面。 */}
            <Suspense fallback={null}>
              {/* compact:這張小匡沒有任何祖先在管捲動,且 FloatingPanel
                  的 .panel 是 overflow:hidden——必須讓 TripPlanPage 自己
                  變成固定高度容器、由時間軸區塊接手捲動,否則內容會被
                  裁掉且完全捲不動。見該元件 compact prop 的完整說明。 */}
              {/* onPanToStop:點擊時間軸的站點卡,把地圖平移到該站。
                  走既有的 geo.setPanTarget(宣告式 panTarget prop,見
                  ExploreMap.tsx 該 prop 的完整說明),跟搜尋框查到城市、
                  側欄點擊飯店/景點走的是同一條路徑,不另外開一套地圖
                  操作介面。

                  不帶 level/radiusMeters——那兩個是「移動並調整縮放到
                  足以顯示某個範圍」用的(搜尋城市、點景點區域),這裡
                  是單一座標點,純平移即可,不該在使用者已經調好的縮放
                  層級上再自作主張改變它。

                  不帶 onlyIfOutOfView——使用者明確點了這張卡,就是要把
                  地圖對準這一站,即使它已經在可視範圍內也應該置中,不是
                  「剛好看得到就不動」。

                  不帶 suppressQuery——不是漏掉:走 geo.setPanTarget 這條
                  路徑的目標在 useGeoOutlineMapState 轉成 panRequest 時
                  一律被設成 suppressQuery: true(見該處 externalPanTarget
                  的 effect),呼叫端帶不帶都一樣。而點時間軸卡片本來就
                  屬於「對齊看清楚一個已知項目」(見 ExploreMap.tsx 該參數
                  的完整說明),抑制查詢正是想要的行為。

                  帶 nonce——消費端的 effect 依賴是拆開的純量,少了它的話
                  「點卡片 A → 手動拖曳地圖 → 再點卡片 A」會因為座標沒變
                  而完全不觸發,地圖不動(見 GeoPanTarget 對這個欄位的
                  完整說明)。點卡片是明確的使用者動作,每次都該有反應。 */}
              <TripPlanPage
                cfg={cfg}
                compact
                // visible:這張小匡是常駐掛載、用 display:none 隱藏的,
                // 元件不會因為關閉而卸載。傳入可見狀態讓它在重新顯示時
                // 把 /app/plan-ai 全頁版這期間寫入的規劃內容讀回來——
                // 兩份實例共用同一份 localStorage,見 TripPlanPage 對這個
                // prop 與 revRef 的完整說明。
                visible={chatPopoverVisible}
                onPanToStop={(stop) => geo.setPanTarget({ lat: stop.lat, lng: stop.lng, nonce: Date.now() })}
                onStopsChange={setPlanStops}
                // selectedStopId 受控:這一份是地圖與時間軸共用的唯一事實
                // 來源(見 TripPlanPage 對這兩個 prop 的完整說明),點卡片
                // 與點地圖圓點都寫同一個 state,不可能出現兩邊各自高亮
                // 不同站的情形。
                selectedStopId={selectedPlanStopId}
                onSelectedStopChange={setSelectedPlanStopId}
                onHoverStopChange={setHoverPlanStopId}
              />
            </Suspense>
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
